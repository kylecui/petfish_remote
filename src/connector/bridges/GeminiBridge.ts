import type {
  AgentBridge,
  AgentType,
  OutputCallback,
  CompleteCallback,
  FailCallback,
  QuestionCallback,
  PermissionCallback,
} from './AgentBridge.js';
import { JsonRpcTransport } from './JsonRpcTransport.js';

export interface GeminiBridgeConfig {
  geminiBin?: string;
  cwd: string;
  apiKey?: string;
}

interface PendingTurn {
  taskId: string;
  onOutput: OutputCallback;
  onComplete: CompleteCallback;
  onFail: FailCallback;
  stdout: string;
  startedAt: string;
}

export class GeminiBridge implements AgentBridge {
  public readonly agentType: AgentType = 'gemini';

  private readonly bin: string;
  private readonly cwd: string;
  private readonly apiKey: string | undefined;
  private transport: JsonRpcTransport | undefined;
  private sessionId: string | undefined;
  private activeTurn: PendingTurn | undefined;
  private onPermission: PermissionCallback | undefined;
  private lastActiveTaskId: string | undefined;
  private permissionIdCounter = 0;
  private readonly pendingPermissions = new Map<string, { rpcId: number | string }>();
  private initPromise: Promise<void> | undefined;

  public constructor(config: GeminiBridgeConfig) {
    this.bin = config.geminiBin ?? 'gemini';
    this.cwd = config.cwd;
    this.apiKey = config.apiKey ?? process.env['GEMINI_API_KEY'];
  }

  public async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.transport = new JsonRpcTransport({ requestTimeoutMs: 30_000 });
    this.transport.spawn(this.bin, ['--acp']);

    this.transport.on('notification', (method: string, params: unknown) => {
      this.handleNotification(method, params);
    });

    this.transport.on('request', (id: number | string, method: string, params: unknown) => {
      this.handleServerRequest(id, method, params);
    });

    this.transport.on('close', () => {
      if (this.activeTurn) {
        this.activeTurn.onFail(this.activeTurn.taskId, 'Gemini process exited unexpectedly');
        this.activeTurn = undefined;
      }
      this.sessionId = undefined;
      this.initPromise = undefined;
    });

    await this.transport.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      clientInfo: { name: 'petfish-remote', version: '1.0.0' },
    });

    if (this.apiKey) {
      await this.transport.request('authenticate', {
        methodId: 'use_gemini',
        _meta: { 'api-key': this.apiKey },
      });
    }

    const result = await this.transport.request<{ sessionId: string }>('session/new', {
      cwd: this.cwd,
      mcpServers: [],
    });

    this.sessionId = result.sessionId;
  }

  public stop(): void {
    if (this.transport) {
      if (this.sessionId) {
        this.transport.notify('session/cancel', { sessionId: this.sessionId });
      }
      this.transport.kill();
      this.transport = undefined;
    }
    this.sessionId = undefined;
    this.activeTurn = undefined;
    this.initPromise = undefined;
  }

  public prompt(
    taskId: string,
    instruction: string,
    onOutput: OutputCallback,
    onComplete: CompleteCallback,
    onFail: FailCallback,
  ): boolean {
    if (!this.transport?.isAlive || !this.sessionId) {
      onFail(taskId, 'Gemini ACP session not initialized');
      return false;
    }

    if (this.activeTurn) {
      onFail(taskId, 'A turn is already in progress');
      return false;
    }

    this.lastActiveTaskId = taskId;
    const turn: PendingTurn = {
      taskId,
      onOutput,
      onComplete,
      onFail,
      stdout: '',
      startedAt: new Date().toISOString(),
    };
    this.activeTurn = turn;

    this.transport.request<{ stopReason: string }>('session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text: instruction }],
    }).then((result) => {
      if (this.activeTurn === turn) {
        this.activeTurn = undefined;
        const finishedAt = new Date().toISOString();
        const exitCode = result.stopReason === 'end_turn' ? 0 : 1;
        onComplete(taskId, exitCode, turn.stdout, '', turn.startedAt, finishedAt);
      }
    }).catch((err: unknown) => {
      if (this.activeTurn === turn) {
        this.activeTurn = undefined;
        const msg = err instanceof Error ? err.message : String(err);
        onFail(taskId, msg);
      }
    });

    return true;
  }

  public cancel(taskId: string): void {
    if (this.activeTurn?.taskId === taskId && this.transport?.isAlive && this.sessionId) {
      this.transport.notify('session/cancel', { sessionId: this.sessionId });
    }
  }

  public async requestNewSession(): Promise<void> {
    this.stop();
    await this.init();
  }

  public async listSessions(): Promise<import('./AgentBridge.js').SessionInfo[]> {
    return [];
  }

  public async switchSession(_sessionId: string): Promise<void> {
    throw new Error('Session switching not supported for Gemini');
  }

  public setQuestionCallback(_cb: QuestionCallback): void {
    // Gemini ACP has no question mechanism (ask_user disabled in ACP mode)
  }

  public setPermissionCallback(cb: PermissionCallback): void {
    this.onPermission = cb;
  }

  public answerQuestion(_questionId: string, _answers: string[][]): void {
    // Gemini ACP has no question mechanism (ask_user disabled in ACP mode)
  }

  public answerPermission(permissionId: string, allowed: boolean): void {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending || !this.transport?.isAlive) return;
    this.pendingPermissions.delete(permissionId);

    if (allowed) {
      this.transport.respond(pending.rpcId, {
        outcome: { outcome: 'selected', optionId: 'proceed_once' },
      });
    } else {
      this.transport.respond(pending.rpcId, {
        outcome: { outcome: 'cancelled' },
      });
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method !== 'session/update' || !this.activeTurn) return;

    const p = params as { update?: { sessionUpdate?: string; [key: string]: unknown } } | undefined;
    const update = p?.update;
    if (!update) return;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const content = update.content as { type?: string; text?: string } | undefined;
        if (content?.text) {
          this.activeTurn.stdout += content.text;
          this.activeTurn.onOutput(this.activeTurn.taskId, 'stdout', content.text);
        }
        break;
      }
      case 'tool_call': {
        const title = update.title as string | undefined;
        const kind = update.kind as string | undefined;
        if (title) {
          const prefix = kind ? `🔧 [${kind}] ` : '🔧 ';
          this.activeTurn.onOutput(this.activeTurn.taskId, 'stdout', `\n${prefix}${title}\n`);
        }
        break;
      }
      case 'tool_call_update': {
        const status = update.status as string | undefined;
        const title = update.title as string | undefined;
        if (status === 'completed' && title) {
          this.activeTurn.onOutput(this.activeTurn.taskId, 'stdout', `  ✓ ${title}\n`);
        }
        break;
      }
      default:
        break;
    }
  }

  private handleServerRequest(id: number | string, method: string, params: unknown): void {
    if (method === 'permission/request') {
      this.handlePermissionRequest(id, params);
    } else {
      this.transport?.respondError(id, -32601, `Method not supported: ${method}`);
    }
  }

  private handlePermissionRequest(rpcId: number | string, params: unknown): void {
    const p = params as {
      sessionId?: string;
      options?: Array<{ optionId: string; name: string; kind: string }>;
      toolCall?: { toolCallId?: string; title?: string; kind?: string; content?: unknown[] };
    } | undefined;

    if (!p) {
      this.transport?.respond(rpcId, { outcome: { outcome: 'cancelled' } });
      return;
    }

    const permissionId = `gemini_perm_${++this.permissionIdCounter}`;
    this.pendingPermissions.set(permissionId, { rpcId });

    const taskId = this.activeTurn?.taskId ?? this.lastActiveTaskId ?? `permission_${permissionId}`;
    const tool = p.toolCall?.title ?? p.toolCall?.kind ?? 'unknown';
    const input: Record<string, unknown> = {};
    if (p.toolCall?.content && Array.isArray(p.toolCall.content)) {
      for (const item of p.toolCall.content) {
        const c = item as { type?: string; path?: string; oldText?: string; newText?: string } | undefined;
        if (c?.type === 'diff') {
          input['path'] = c.path;
          input['diff'] = `- ${(c.oldText ?? '').slice(0, 200)}\n+ ${(c.newText ?? '').slice(0, 200)}`;
        }
      }
    }

    if (this.onPermission) {
      this.onPermission(taskId, {
        taskId,
        permissionId,
        sessionId: this.sessionId ?? '',
        tool,
        input,
      });
    } else {
      this.transport?.respond(rpcId, {
        outcome: { outcome: 'selected', optionId: 'proceed_once' },
      });
      this.pendingPermissions.delete(permissionId);
    }
  }
}
