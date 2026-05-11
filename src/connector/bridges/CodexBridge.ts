import type {
  AgentBridge,
  AgentType,
  OutputCallback,
  CompleteCallback,
  FailCallback,
  QuestionCallback,
  PermissionCallback,
  PromptOptions,
} from './AgentBridge.js';
import { JsonRpcTransport } from './JsonRpcTransport.js';

export interface CodexBridgeConfig {
  codexBin?: string;
  cwd: string;
}

interface PendingTurn {
  taskId: string;
  threadId: string;
  turnId: string | undefined;
  onOutput: OutputCallback;
  onComplete: CompleteCallback;
  onFail: FailCallback;
  stdout: string;
  startedAt: string;
}

export class CodexBridge implements AgentBridge {
  public readonly agentType: AgentType = 'codex';

  private readonly bin: string;
  private readonly cwd: string;
  private transport: JsonRpcTransport | undefined;
  private threadId: string | undefined;
  private activeTurn: PendingTurn | undefined;
  private onPermission: PermissionCallback | undefined;
  private lastActiveTaskId: string | undefined;
  private readonly pendingApprovals = new Map<string, { rpcId: number | string }>();
  private approvalIdCounter = 0;
  private initPromise: Promise<void> | undefined;

  public constructor(config: CodexBridgeConfig) {
    this.bin = config.codexBin ?? 'codex';
    this.cwd = config.cwd;
  }

  public async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.transport = new JsonRpcTransport({ requestTimeoutMs: 30_000 });
    this.transport.spawn(this.bin, ['app-server']);

    this.transport.on('notification', (method: string, params: unknown) => {
      this.handleNotification(method, params);
    });

    this.transport.on('request', (id: number | string, method: string, params: unknown) => {
      this.handleServerRequest(id, method, params);
    });

    this.transport.on('close', () => {
      if (this.activeTurn) {
        this.activeTurn.onFail(this.activeTurn.taskId, 'Codex process exited unexpectedly');
        this.activeTurn = undefined;
      }
      this.threadId = undefined;
      this.initPromise = undefined;
    });

    await this.transport.request('initialize', {
      clientInfo: { name: 'petfish-remote', version: '1.0.0' },
      capabilities: {},
    });

    const result = await this.transport.request<{ thread: { id: string } }>('thread/start', {
      cwd: this.cwd,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      ephemeral: true,
    });

    this.threadId = result.thread.id;
  }

  public stop(): void {
    if (this.transport) {
      if (this.activeTurn && this.threadId && this.activeTurn.turnId) {
        this.transport.request('turn/interrupt', {
          threadId: this.threadId,
          turnId: this.activeTurn.turnId,
        }).catch(() => {});
      }
      this.transport.kill();
      this.transport = undefined;
    }
    this.threadId = undefined;
    this.activeTurn = undefined;
    this.initPromise = undefined;
  }

  public prompt(
    taskId: string,
    instruction: string,
    onOutput: OutputCallback,
    onComplete: CompleteCallback,
    onFail: FailCallback,
    options?: PromptOptions,
  ): boolean {
    void options;
    if (!this.transport?.isAlive || !this.threadId) {
      onFail(taskId, 'Codex app-server not initialized');
      return false;
    }

    if (this.activeTurn) {
      onFail(taskId, 'A turn is already in progress');
      return false;
    }

    this.lastActiveTaskId = taskId;
    const turn: PendingTurn = {
      taskId,
      threadId: this.threadId,
      turnId: undefined,
      onOutput,
      onComplete,
      onFail,
      stdout: '',
      startedAt: new Date().toISOString(),
    };
    this.activeTurn = turn;

    this.transport.request<{ turn: { id: string } }>('turn/start', {
      threadId: this.threadId,
      input: [{ type: 'text', text: instruction }],
    }).then((result) => {
      if (this.activeTurn === turn) {
        turn.turnId = result.turn.id;
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
    if (this.activeTurn?.taskId === taskId && this.transport?.isAlive && this.threadId && this.activeTurn.turnId) {
      this.transport.request('turn/interrupt', {
        threadId: this.threadId,
        turnId: this.activeTurn.turnId,
      }).catch(() => {});
    }
  }

  public async requestNewSession(): Promise<void> {
    if (!this.transport?.isAlive) {
      this.stop();
      await this.init();
      return;
    }

    const result = await this.transport.request<{ thread: { id: string } }>('thread/start', {
      cwd: this.cwd,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      ephemeral: true,
    });
    this.threadId = result.thread.id;
  }

  public setQuestionCallback(_cb: QuestionCallback): void {
    // Codex app-server doesn't have a general question mechanism in standard flow
  }

  public async listSessions(): Promise<import('./AgentBridge.js').SessionInfo[]> {
    return [];
  }

  public async switchSession(_sessionId: string): Promise<void> {
    throw new Error('Session switching not supported for Codex');
  }

  public setPermissionCallback(cb: PermissionCallback): void {
    this.onPermission = cb;
  }

  public answerQuestion(_questionId: string, _answers: string[][]): void {}

  public answerPermission(permissionId: string, allowed: boolean): void {
    const pending = this.pendingApprovals.get(permissionId);
    if (!pending || !this.transport?.isAlive) return;
    this.pendingApprovals.delete(permissionId);

    this.transport.respond(pending.rpcId, {
      decision: allowed ? 'accept' : 'decline',
    });
  }

  private handleNotification(method: string, params: unknown): void {
    if (!this.activeTurn) return;
    const p = params as Record<string, unknown> | undefined;
    if (!p) return;

    switch (method) {
      case 'item/agentMessage/delta': {
        const delta = p['delta'] as string | undefined;
        if (delta) {
          this.activeTurn.stdout += delta;
          this.activeTurn.onOutput(this.activeTurn.taskId, 'stdout', delta);
        }
        break;
      }
      case 'item/commandExecution/outputDelta': {
        const delta = p['delta'] as string | undefined;
        if (delta) {
          this.activeTurn.stdout += delta;
          this.activeTurn.onOutput(this.activeTurn.taskId, 'stdout', delta);
        }
        break;
      }
      case 'item/started': {
        const item = p['item'] as { type?: string; id?: string } | undefined;
        if (item?.type === 'command_execution') {
          this.activeTurn.onOutput(this.activeTurn.taskId, 'stdout', '\n$ ');
        }
        break;
      }
      case 'turn/completed': {
        const turn = this.activeTurn;
        this.activeTurn = undefined;
        const finishedAt = new Date().toISOString();
        turn.onComplete(turn.taskId, 0, turn.stdout, '', turn.startedAt, finishedAt);
        break;
      }
      case 'error': {
        const error = p['error'] as { message?: string } | undefined;
        const willRetry = p['willRetry'] as boolean | undefined;
        if (!willRetry) {
          const turn = this.activeTurn;
          this.activeTurn = undefined;
          turn.onFail(turn.taskId, error?.message ?? 'Unknown error');
        }
        break;
      }
      default:
        break;
    }
  }

  private handleServerRequest(id: number | string, method: string, params: unknown): void {
    if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
      this.handleApprovalRequest(id, method, params);
    } else {
      this.transport?.respondError(id, -32601, `Method not supported: ${method}`);
    }
  }

  private handleApprovalRequest(rpcId: number | string, method: string, params: unknown): void {
    const p = params as {
      command?: string | string[];
      cwd?: string;
      reason?: string;
      itemId?: string;
      callId?: string;
      threadId?: string;
    } | undefined;

    const approvalId = `codex_appr_${++this.approvalIdCounter}`;
    this.pendingApprovals.set(approvalId, { rpcId });

    const taskId = this.activeTurn?.taskId ?? this.lastActiveTaskId ?? `permission_${approvalId}`;

    let commandStr: string;
    if (Array.isArray(p?.command)) {
      commandStr = p.command.join(' ');
    } else {
      commandStr = p?.command ?? 'unknown command';
    }

    const tool = method === 'execCommandApproval' ? 'exec' : 'command';
    const input: Record<string, unknown> = {
      command: commandStr,
    };
    if (p?.cwd) input['cwd'] = p.cwd;
    if (p?.reason) input['reason'] = p.reason;

    if (this.onPermission) {
      this.onPermission(taskId, {
        taskId,
        permissionId: approvalId,
        sessionId: this.threadId ?? '',
        tool,
        input,
      });
    } else {
      this.transport?.respond(rpcId, { decision: 'accept' });
      this.pendingApprovals.delete(approvalId);
    }
  }
}
