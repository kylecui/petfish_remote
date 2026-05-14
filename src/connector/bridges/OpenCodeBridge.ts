import { exec } from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';

import type {
  AgentBridge,
  AgentType,
  FileChange,
  OutputCallback,
  CompleteCallback,
  FailCallback,
  QuestionCallback,
  PermissionCallback,
  PromptOptions,
} from './AgentBridge.js';
import { createClient, type OpencodeClient } from './OpencodeClient.js';
import { SubAgentTracker } from '../../render/SubAgentTracker.js';
import type { ModelInfo } from '../../protocol/connectorProtocol.js';
import type { SubAgentVerbosity } from '../../types.js';

const execAsync = promisify(exec);

export interface OpenCodeBridgeConfig {
  opencodeBin?: string;
  cwd?: string;
}

interface PendingPrompt {
  taskId: string;
  userMessageId: string;
  assistantMessageId: string | undefined;
  onOutput: OutputCallback;
  onComplete: CompleteCallback;
  onFail: FailCallback;
  startedAt: string;
  stdout: string;
  sentTextLengths: Map<string, number>;
  settled: boolean;
  subAgentVerbosity: SubAgentVerbosity;
}

export class OpenCodeBridge implements AgentBridge {
  public readonly agentType: AgentType = 'opencode';

  private sessionId: string | undefined;
  private opencodePort: string | undefined;
  private client: OpencodeClient | undefined;
  private readonly pending = new Map<string, PendingPrompt>();
  private readonly messageToTask = new Map<string, string>();
  private readonly localQueue: Array<{ taskId: string; instruction: string; onOutput: OutputCallback; onComplete: CompleteCallback; onFail: FailCallback; options?: PromptOptions }> = [];
  private sseRequest: http.ClientRequest | undefined;
  private sseReconnectTimer: NodeJS.Timeout | undefined;
  private idleDrainTimer: NodeJS.Timeout | undefined;
  private readonly settleTimers = new Map<string, NodeJS.Timeout>();
  private readonly settleDeferralCounts = new Map<string, number>();
  private readonly idleConfirmMs = 1500;
  private readonly settleGraceMs = 8_000;
  private readonly maxSettleDeferrals = 6;
  private readonly submitVerifyMs = 5000;
  private readonly maxSubmitRetries = 3;
  private lastCompletedAssistantId: string | undefined;
  private pendingCorrelation: string | undefined;
  private stopped = false;
  private sessionBusy = false;
  private messageCount = 0;
  private depthWarned = false;
  private modelOverride: { providerID: string; modelID: string } | undefined;
  private onQuestion: QuestionCallback | undefined;
  private onPermission: PermissionCallback | undefined;
  private readonly subAgentTracker = new SubAgentTracker();

  private readonly cwd: string | undefined;

  public constructor(config: OpenCodeBridgeConfig) {
    this.cwd = config.cwd;
  }

  public setQuestionCallback(cb: QuestionCallback): void {
    this.onQuestion = cb;
  }

  public setPermissionCallback(cb: PermissionCallback): void {
    this.onPermission = cb;
  }

  public getSubAgentStatus(): string {
    return this.subAgentTracker.getStatus();
  }

  public setModelOverride(model: { providerID: string; modelID: string } | null): void {
    this.modelOverride = model ?? undefined;
  }

  public getModelOverride(): { providerID: string; modelID: string } | undefined {
    return this.modelOverride;
  }

  public async getAvailableModels(): Promise<{ models: ModelInfo[]; current: { providerID: string; modelID: string } | null }> {
    if (!this.client) {
      return { models: [], current: this.modelOverride ?? null };
    }

    const { data, error } = await this.client.provider.list();
    if (error || !data) {
      throw new Error(this.extractErrorMessage(error));
    }

    const connected = new Set(Array.isArray(data.connected) ? data.connected : []);
    const models: ModelInfo[] = [];

    for (const provider of Array.isArray(data.all) ? data.all : []) {
      if (!connected.has(provider.id)) continue;
      for (const model of Object.values(provider.models ?? {})) {
        if (model.tool_call === false) continue;
        models.push({
          providerID: provider.id,
          providerName: provider.name,
          modelID: model.id,
          modelName: model.name,
        });
      }
    }

    models.sort((a, b) => `${a.providerID}/${a.modelID}`.localeCompare(`${b.providerID}/${b.modelID}`));
    return { models, current: this.modelOverride ?? null };
  }

  public async init(): Promise<void> {
    this.opencodePort = await this.discoverPort();
    if (!this.opencodePort) {
      throw new Error('Cannot discover opencode port. No running opencode instance found.');
    }
    this.client = createClient(this.opencodePort);

    this.sessionId = await this.discoverSession();
    if (!this.sessionId) {
      throw new Error('Cannot discover active session on opencode.');
    }
    this.lastCompletedAssistantId = await this.discoverLastAssistantMessage();
    this.connectSSE();
    console.log(`OpenCodeBridge: session=${this.sessionId} port=${this.opencodePort} lastAssistant=${this.lastCompletedAssistantId ?? 'none'}`);
  }

  private async rediscover(): Promise<boolean> {
    const oldPort = this.opencodePort;

    this.opencodePort = await this.discoverPort();
    if (!this.opencodePort) {
      console.warn('[OpenCodeBridge] rediscover: cannot find opencode port');
      return false;
    }

    if (this.opencodePort !== oldPort) {
      this.client = createClient(this.opencodePort);
    }

    if (this.sessionId) {
      if (await this.validateSessionExists()) {
        if (this.opencodePort !== oldPort) {
          console.log(`[OpenCodeBridge] rediscovered port=${oldPort}→${this.opencodePort}, session=${this.sessionId} retained`);
          if (this.sseRequest) {
            this.sseRequest.destroy();
            this.sseRequest = undefined;
          }
          this.connectSSE();
        }
        return true;
      }
      console.log(`[OpenCodeBridge] bound session ${this.sessionId} no longer exists, re-binding`);
    }

    this.sessionId = await this.discoverSession();
    if (!this.sessionId) {
      console.warn('[OpenCodeBridge] rediscover: cannot find active session');
      return false;
    }

    console.log(`[OpenCodeBridge] rediscovered: port=${this.opencodePort} session=${this.sessionId}`);
    if (this.sseRequest) {
      this.sseRequest.destroy();
      this.sseRequest = undefined;
    }
    this.connectSSE();
    return true;
  }

  public prompt(taskId: string, instruction: string, onOutput: OutputCallback, onComplete: CompleteCallback, onFail: FailCallback, options?: PromptOptions): boolean {
    this.localQueue.push({ taskId, instruction, onOutput, onComplete, onFail, options });

    if (!this.sessionId || !this.opencodePort || !this.client) {
      void this.rediscover().then((ok) => {
        if (ok) {
          this.scheduleIdleDrain();
        } else {
          const item = this.localQueue.findIndex(q => q.taskId === taskId);
          if (item !== -1) this.localQueue.splice(item, 1);
          onFail(taskId, 'OpenCodeBridge not initialized and rediscovery failed');
        }
      });
      return true;
    }

    if (this.pending.size > 0) {
      console.log(`[OpenCodeBridge] IM task in-flight, queuing ${taskId}`);
      onOutput(taskId, 'stdout', '⏳ opencode is currently busy. Your request is queued and will be processed when idle.\n');
      return true;
    }

    this.scheduleIdleDrain();
    return true;
  }

  private scheduleIdleDrain(): void {
    if (this.idleDrainTimer) return;
    if (this.localQueue.length === 0) return;

    this.idleDrainTimer = setTimeout(() => {
      this.idleDrainTimer = undefined;
      this.confirmAndDrain();
    }, this.idleConfirmMs);
  }

  private cancelIdleDrain(): void {
    if (this.idleDrainTimer) {
      clearTimeout(this.idleDrainTimer);
      this.idleDrainTimer = undefined;
    }
  }

  private confirmAndDrain(): void {
    if (this.localQueue.length === 0) return;
    if (this.pending.size > 0) return;

    if (this.isSessionBusy()) {
      console.log('[OpenCodeBridge] Idle drain aborted — session still busy');
      return;
    }

    const next = this.localQueue.shift()!;
    console.log(`[OpenCodeBridge] Confirmed idle, injecting taskId=${next.taskId} (${this.localQueue.length} remaining)`);
    this.injectPrompt(next.taskId, next.instruction, next.onOutput, next.onComplete, next.onFail, next.options);
  }

  private isSessionBusy(): boolean {
    return this.pending.size > 0 || this.sessionBusy;
  }

  private injectPrompt(taskId: string, instruction: string, onOutput: OutputCallback, onComplete: CompleteCallback, onFail: FailCallback, options?: PromptOptions): void {
    const subAgentVerbosity = options?.subAgentVerbosity ?? 'summary';

    const entry: PendingPrompt = {
      taskId,
      userMessageId: '',
      assistantMessageId: undefined,
      onOutput,
      onComplete,
      onFail,
      startedAt: new Date().toISOString(),
      stdout: '',
      sentTextLengths: new Map(),
      settled: false,
      subAgentVerbosity,
    };

    this.pending.set(taskId, entry);
    this.pendingCorrelation = taskId;
    this.subAgentTracker.reset();
    this.subAgentTracker.setErrorCallback((text) => {
      if (subAgentVerbosity !== 'silent') {
        onOutput(taskId, 'stdout', '\n' + text + '\n');
      }
    });

    const waitForCorrelation = (): Promise<boolean> => {
      return new Promise((resolve) => {
        if (!this.pendingCorrelation) {
          resolve(true);
          return;
        }
        const timer = setTimeout(() => {
          resolve(this.pendingCorrelation !== taskId);
        }, this.submitVerifyMs);
        const check = setInterval(() => {
          if (this.pendingCorrelation !== taskId) {
            clearTimeout(timer);
            clearInterval(check);
            resolve(true);
          }
        }, 200);
      });
    };

    (async () => {
      try {
        if (!this.client || !this.sessionId) {
          this.pendingCorrelation = undefined;
          this.settle(taskId, 'No client or session');
          return;
        }

        for (let attempt = 0; attempt < this.maxSubmitRetries; attempt++) {
          const { error } = await this.client.session.promptAsync({
            path: { id: this.sessionId },
            body: {
              parts: [{ type: 'text', text: instruction }],
              ...(this.lastCompletedAssistantId ? { parentID: this.lastCompletedAssistantId } : {}),
              ...(this.modelOverride ? { model: this.modelOverride } : {}),
            },
          });

          if (error) {
            console.log(`[OpenCodeBridge] promptAsync error: ${JSON.stringify(error)} taskId=${taskId} attempt=${attempt + 1}`);
            if (attempt < this.maxSubmitRetries - 1) {
              await new Promise(r => setTimeout(r, 500));
              continue;
            }
            this.pendingCorrelation = undefined;
            this.settle(taskId, `promptAsync failed after ${this.maxSubmitRetries} attempts`);
            return;
          }

          console.log(`[OpenCodeBridge] promptAsync accepted taskId=${taskId} attempt=${attempt + 1}`);

          const correlated = await waitForCorrelation();
          if (correlated) {
            return;
          }

          console.log(`[OpenCodeBridge] prompt not acknowledged after ${this.submitVerifyMs}ms, retry ${attempt + 2}/${this.maxSubmitRetries} taskId=${taskId}`);
        }

        console.log(`[OpenCodeBridge] prompt failed after ${this.maxSubmitRetries} retries, re-queuing taskId=${taskId}`);
        this.pendingCorrelation = undefined;
        this.pending.delete(taskId);
        this.localQueue.unshift({ taskId, instruction, onOutput, onComplete, onFail });
        this.scheduleIdleDrain();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[OpenCodeBridge] inject failed for taskId=${taskId}: ${errMsg}`);
        this.pendingCorrelation = undefined;
        this.pending.delete(taskId);

        const ok = await this.rediscover();
        if (ok) {
          console.log(`[OpenCodeBridge] rediscovered after failure, re-queuing taskId=${taskId}`);
          this.localQueue.unshift({ taskId, instruction, onOutput, onComplete, onFail });
          this.scheduleIdleDrain();
        } else {
          onFail(taskId, `promptAsync error: ${errMsg} (rediscovery also failed)`);
        }
      }
    })();
  }

  public cancel(taskId: string): void {
    const entry = this.pending.get(taskId);
    if (entry && !entry.settled) {
      entry.settled = true;
      this.cleanup(taskId);
      entry.onComplete(taskId, -1, entry.stdout, 'Cancelled', entry.startedAt, new Date().toISOString(), undefined);
    }
  }

  public async requestNewSession(): Promise<void> {
    if (!this.opencodePort || !this.client) {
      console.warn('[OpenCodeBridge] requestNewSession: no opencode port or client');
      return;
    }

    try {
      const { data: created } = await this.client.session.create();
      const sessionId = (created as { id?: string } | undefined)?.id;
      if (sessionId) {
        const body = JSON.stringify({ sessionID: sessionId });
        await fetch(`http://127.0.0.1:${this.opencodePort}/tui/select-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(5000),
        });
        this.sessionId = sessionId;
        this.lastCompletedAssistantId = undefined;
        this.sessionBusy = false;
        this.messageCount = 0;
        this.depthWarned = false;
      }
      console.log(`[OpenCodeBridge] new session created and bound, session=${this.sessionId}`);
    } catch (err) {
      console.warn(`[OpenCodeBridge] requestNewSession failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public async listSessions(): Promise<import('./AgentBridge.js').SessionInfo[]> {
    if (!this.client) return [];
    try {
      const { data } = await this.client.session.list();
      const sessions = data as Array<{ id: string; slug?: string; title?: string; parentID?: string; time?: { created?: string; updated?: string } }> | undefined;
      if (!sessions) return [];
      return sessions
        .filter((s) => !s.parentID)
        .map((s) => ({
          id: s.id,
          slug: s.slug ?? '',
          title: s.title ?? '(untitled)',
          createdAt: s.time?.created ? new Date(s.time.created).getTime() : 0,
          updatedAt: s.time?.updated ? new Date(s.time.updated).getTime() : 0,
          active: s.id === this.sessionId,
        }));
    } catch (err) {
      console.warn(`[OpenCodeBridge] listSessions failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  public async switchSession(sessionId: string): Promise<void> {
    if (!this.opencodePort) {
      throw new Error('No opencode port available');
    }
    let resolvedId = sessionId;
    if (!sessionId.startsWith('ses_')) {
      const sessions = await this.listSessions();
      const match = sessions.find((s) => s.slug === sessionId);
      if (match) {
        resolvedId = match.id;
      } else {
        throw new Error(`No session found with slug "${sessionId}"`);
      }
    }
    const body = JSON.stringify({ sessionID: resolvedId });
    await fetch(`http://127.0.0.1:${this.opencodePort}/tui/select-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    });
    this.sessionId = resolvedId;
    this.lastCompletedAssistantId = undefined;
    this.sessionBusy = false;
    this.messageCount = 0;
    this.depthWarned = false;
    console.log(`[OpenCodeBridge] switched to session=${resolvedId}`);
  }

  public stop(): void {
    this.stopped = true;
    this.sessionBusy = false;
    this.cancelIdleDrain();
    for (const timer of this.settleTimers.values()) clearTimeout(timer);
    this.settleTimers.clear();
    if (this.sseReconnectTimer) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = undefined;
    }
    if (this.sseRequest) {
      this.sseRequest.destroy();
      this.sseRequest = undefined;
    }
    for (const [taskId, entry] of this.pending) {
      if (!entry.settled) {
        entry.onComplete(taskId, -1, entry.stdout, 'Bridge stopped', entry.startedAt, new Date().toISOString(), undefined);
      }
    }
    this.pending.clear();
    this.messageToTask.clear();
  }

  private connectSSE(): void {
    if (this.stopped) return;

    const req = http.get(
      { hostname: '127.0.0.1', port: Number(this.opencodePort), path: '/event', headers: { Accept: 'text/event-stream' } },
      (res) => {
        if (res.statusCode !== 200) {
          console.warn(`[OpenCodeBridge] SSE connection failed: ${res.statusCode}`);
          this.scheduleSSEReconnect();
          return;
        }

        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              this.handleSSEEvent(line.slice(6));
            }
          }
        });

        res.on('end', () => {
          console.log('[OpenCodeBridge] SSE connection ended');
          this.scheduleSSEReconnect();
        });

        res.on('error', (err) => {
          console.warn(`[OpenCodeBridge] SSE stream error: ${err.message}`);
          this.scheduleSSEReconnect();
        });
      },
    );

    req.on('error', (err) => {
      console.warn(`[OpenCodeBridge] SSE connect error: ${err.message}`);
      this.scheduleSSEReconnect();
    });

    this.sseRequest = req;
  }

  private scheduleSSEReconnect(): void {
    if (this.stopped) return;
    this.sseReconnectTimer = setTimeout(() => {
      void this.rediscover().then(() => this.connectSSE());
    }, 3000);
  }

  private handleSSEEvent(data: string): void {
    let event: { type: string; properties?: Record<string, unknown> };
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }

    if (event.type === 'message.updated') {
      this.handleMessageUpdated(event.properties);
    } else if (event.type === 'message.part.updated') {
      this.handlePartUpdated(event.properties);
    } else if (event.type === 'session.created') {
      this.handleSessionCreated(event.properties);
    } else if (event.type === 'session.idle') {
      this.handleSessionIdle(event.properties);
    } else if (event.type === 'session.status') {
      this.handleSessionStatus(event.properties);
    } else if (event.type === 'session.error') {
      this.handleSessionError(event.properties);
    } else if (event.type === 'question.asked') {
      this.handleQuestionAsked(event.properties);
    } else if (event.type === 'permission.asked') {
      this.handlePermissionAsked(event.properties);
    } else if (event.type === 'session.compacted') {
      this.handleSessionCompacted(event.properties);
    }
  }

  private handleMessageUpdated(props: Record<string, unknown> | undefined): void {
    if (!props) return;
    const info = props['info'] as { id?: string; role?: string; parentID?: string; error?: unknown; time?: { completed?: number } } | undefined;
    if (!info) return;

    if (info.role === 'user' && info.id && this.pendingCorrelation) {
      const taskId = this.pendingCorrelation;
      this.pendingCorrelation = undefined;
      const entry = this.pending.get(taskId);
      if (entry) {
        entry.userMessageId = info.id;
        this.messageToTask.set(info.id, taskId);
        console.log(`[OpenCodeBridge] correlated user msg ${info.id} → task=${taskId}`);
      }
    }

    if (info.role === 'assistant' && info.id && info.time?.completed) {
      this.lastCompletedAssistantId = info.id;
      this.messageCount++;
      if (this.messageCount >= 250 && !this.depthWarned) {
        this.depthWarned = true;
        console.log(`[OpenCodeBridge] session depth warning: ${this.messageCount} messages`);
        this.emitDepthWarning();
      }
    }

    if (info.role === 'assistant' && info.error) {
      const errorMsg = this.extractErrorMessage(info.error);
      let taskId = info.parentID ? this.messageToTask.get(info.parentID) : undefined;
      if (!taskId && this.pending.size === 1) {
        const [onlyTaskId, onlyEntry] = [...this.pending.entries()][0];
        if (!onlyEntry.settled && onlyEntry.userMessageId && info.parentID === onlyEntry.userMessageId) taskId = onlyTaskId;
      }
      if (taskId) {
        this.settle(taskId, errorMsg);
        return;
      }
    }

    if (info.role === 'assistant' && info.parentID) {
      let taskId = this.messageToTask.get(info.parentID);

      if (!taskId && this.pending.size === 1) {
        const [onlyTaskId, onlyEntry] = [...this.pending.entries()][0];
        if (!onlyEntry.settled && onlyEntry.userMessageId && info.parentID === onlyEntry.userMessageId) {
          taskId = onlyTaskId;
        }
      }

      if (taskId) {
        const entry = this.pending.get(taskId);
        if (entry) {
          entry.assistantMessageId = info.id;
          if (info.id) {
            this.messageToTask.set(info.id, taskId);
          }
          if (info.time?.completed) {
            this.scheduleSettleOnComplete(taskId);
          } else {
            this.cancelSettleTimer(taskId);
          }
        }
      }
    }
  }

  private handlePartUpdated(props: Record<string, unknown> | undefined): void {
    if (!props) return;
    const part = props['part'] as { type?: string; messageID?: string; text?: string; id?: string } | undefined;
    const delta = props['delta'] as string | undefined;
    if (!part) return;

    if (part.type !== 'text') return;

    let taskId = part.messageID ? this.messageToTask.get(part.messageID) : undefined;

    if (!taskId) return;

    const entry = this.pending.get(taskId);
    if (!entry || entry.settled) return;

    if (part.messageID === entry.userMessageId) return;

    const msgId = part.messageID!;
    const sent = entry.sentTextLengths.get(msgId) ?? 0;

    let text: string;
    if (delta && delta.length > 0) {
      text = delta;
    } else if (part.text && part.text.length > sent) {
      text = part.text.slice(sent);
    } else {
      return;
    }

    entry.sentTextLengths.set(msgId, sent + text.length);
    entry.stdout += text;
    entry.onOutput(taskId, 'stdout', text);
  }

  private handleSessionCreated(props: Record<string, unknown> | undefined): void {
    if (!props) return;
    const info = props['info'] as { id?: string; parentID?: string; agent?: string } | undefined;
    if (!info?.id || !info?.parentID) return;
    if (info.parentID !== this.sessionId) return;
    const agentName = info.agent ?? 'unknown';
    this.subAgentTracker.register(info.id, info.parentID, agentName);
    if (this.pending.size === 1) {
      const [, entry] = [...this.pending.entries()][0];
      if (!entry.settled && entry.subAgentVerbosity === 'verbose') {
        entry.onOutput(entry.taskId, 'stdout', `\n🔧 ▶ ${agentName} started\n`);
      }
    }
    console.log(`[OpenCodeBridge] sub-agent registered: ${agentName} session=${info.id}`);
  }

  private handleSessionIdle(props: Record<string, unknown> | undefined): void {
    if (!props) return;
    const sessionID = props['sessionID'] as string | undefined;

    if (sessionID && sessionID !== this.sessionId) {
      const record = this.subAgentTracker.markCompleted(sessionID);
      if (record && this.pending.size === 1) {
        const [, entry] = [...this.pending.entries()][0];
        if (!entry.settled && entry.subAgentVerbosity === 'verbose') {
          const duration = record.completedAt ? `${Math.round((record.completedAt - record.startedAt) / 1000)}s` : '0s';
          entry.onOutput(entry.taskId, 'stdout', `\n🔧 ✅ ${record.agentName} completed (${duration})\n`);
        }
      }
      return;
    }

    this.sessionBusy = false;

    for (const [taskId, entry] of this.pending) {
      if (!entry.settled) {
        entry.settled = true;
        this.cleanup(taskId);
        const summary = this.subAgentTracker.getSummary();
        if (entry.stdout.length === 0) {
          void (async () => {
            const errorMsg = await this.fetchLastError(entry.assistantMessageId);
            if (errorMsg) {
              entry.onFail(taskId, errorMsg);
            } else {
              if (summary && entry.subAgentVerbosity === 'summary') entry.onOutput(taskId, 'stdout', '\n' + summary);
              const files = await this.fetchFileChanges();
              entry.onComplete(taskId, 0, entry.stdout, '', entry.startedAt, new Date().toISOString(), files);
            }
          })();
          continue;
        }
        void (async () => {
          if (summary && entry.subAgentVerbosity === 'summary') entry.onOutput(taskId, 'stdout', '\n' + summary);
          const files = await this.fetchFileChanges();
          entry.onComplete(taskId, 0, entry.stdout, '', entry.startedAt, new Date().toISOString(), files);
        })();
      }
    }

    this.subAgentTracker.reset();

    this.scheduleIdleDrain();
  }

  private handleSessionStatus(props: Record<string, unknown> | undefined): void {
    if (!props) return;
    const sessionID = props['sessionID'] as string | undefined;
    if (sessionID !== this.sessionId) return;
    const status = props['status'] as { type?: string } | undefined;
    this.sessionBusy = status?.type === 'busy';
    if (this.sessionBusy) {
      this.cancelIdleDrain();
      for (const taskId of this.settleTimers.keys()) {
        this.cancelSettleTimer(taskId);
      }
    }
  }

  private handleSessionError(props: Record<string, unknown> | undefined): void {
    if (!props) return;
    const sessionID = props['sessionID'] as string | undefined;

    if (sessionID && sessionID !== this.sessionId) {
      const error = props['error'] as unknown;
      this.subAgentTracker.markFailed(sessionID, this.extractErrorMessage(error));
      return;
    }

    const error = props['error'] as unknown;
    const errorMsg = this.withModelSwitchHint(this.extractErrorMessage(error));

    for (const [taskId, entry] of this.pending) {
      if (!entry.settled) {
        this.settle(taskId, errorMsg);
      }
    }

    // Reset busy flag so queued tasks can drain.
    // session.idle may never fire after certain errors (e.g. MessageAbortedError),
    // leaving sessionBusy=true and blocking the queue permanently.
    this.sessionBusy = false;
    this.scheduleIdleDrain();
  }

  private handleSessionCompacted(props: Record<string, unknown> | undefined): void {
    const sessionID = (props?.['sessionID'] ?? props?.['id']) as string | undefined;
    if (sessionID && sessionID !== this.sessionId) return;
    console.log(`[OpenCodeBridge] session.compacted received for session=${sessionID ?? this.sessionId}`);
    for (const entry of this.pending.values()) {
      if (!entry.settled) {
        entry.onOutput(entry.taskId, 'stdout',
          '\n⚠️ Session history was compacted by opencode. ' +
          'If errors occur, consider switching to a different model with `/pf model` before trying `/pf new`.\n');
      }
    }
  }

  private emitDepthWarning(): void {
    for (const entry of this.pending.values()) {
      if (!entry.settled) {
        entry.onOutput(entry.taskId, 'stdout',
          '\n⚠️ This session has reached ~250 messages. ' +
          'Long sessions may trigger compaction issues with Claude models. ' +
          'Consider switching models with `/pf model` or starting a new session (`/pf new`) soon.\n');
      }
    }
  }

  private withModelSwitchHint(error: string): string {
    if (!/tool_use|tool_result/i.test(error)) return error;
    return `${error}\n\nMitigation: switch to a different connected model with \`/pf model\`, then retry. If needed, use \`/pf new\` after switching.`;
  }

  private extractErrorMessage(error: unknown): string {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (typeof error === 'object') {
      const e = error as { name?: string; data?: { message?: string; statusCode?: number }; message?: string };
      const name = e.name ?? 'Error';
      const message = e.data?.message ?? e.message ?? '';
      const status = e.data?.statusCode ? ` (HTTP ${e.data.statusCode})` : '';
      return `${name}: ${message}${status}`.trim() || 'Unknown error';
    }
    return String(error);
  }

  private async fetchFileChanges(): Promise<FileChange[] | undefined> {
    if (!this.client || !this.sessionId) return undefined;
    try {
      const { data } = await this.client.session.diff({ path: { id: this.sessionId } });
      if (!Array.isArray(data) || data.length === 0) return undefined;
      return data.map((d: { file: string; additions: number; deletions: number }) => ({
        file: d.file,
        additions: d.additions ?? 0,
        deletions: d.deletions ?? 0,
      }));
    } catch {
      return undefined;
    }
  }

  private scheduleSettleOnComplete(taskId: string): void {
    const existing = this.settleTimers.get(taskId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.settleTimers.delete(taskId);
      const entry = this.pending.get(taskId);
      if (!entry || entry.settled) return;

      if (this.sessionBusy) {
        const count = (this.settleDeferralCounts.get(taskId) ?? 0) + 1;
        this.settleDeferralCounts.set(taskId, count);

        if (count < this.maxSettleDeferrals) {
          console.log(`[OpenCodeBridge] safety settle deferred (${count}/${this.maxSettleDeferrals}) — session still busy task=${taskId}`);
          this.scheduleSettleOnComplete(taskId);
          return;
        }

        console.warn(`[OpenCodeBridge] force-settling task=${taskId} after ${count} deferrals — resetting sessionBusy`);
        this.sessionBusy = false;
      }

      this.settleDeferralCounts.delete(taskId);
      console.log(`[OpenCodeBridge] settle firing task=${taskId} (${this.settleGraceMs / 1000}s after completion signal)`);
      entry.settled = true;
      this.cleanup(taskId);
      void (async () => {
        const files = await this.fetchFileChanges();
        entry.onComplete(taskId, 0, entry.stdout, '', entry.startedAt, new Date().toISOString(), files);
      })();
      this.scheduleIdleDrain();
    }, this.settleGraceMs);

    this.settleTimers.set(taskId, timer);
  }

  private cancelSettleTimer(taskId: string): void {
    const timer = this.settleTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.settleTimers.delete(taskId);
    }
  }

  private settle(taskId: string, error: string): void {
    const entry = this.pending.get(taskId);
    if (!entry || entry.settled) return;
    entry.settled = true;
    this.cleanup(taskId);
    entry.onFail(taskId, error);
  }

  private cleanup(taskId: string): void {
    this.cancelSettleTimer(taskId);
    this.settleDeferralCounts.delete(taskId);
    const entry = this.pending.get(taskId);
    if (entry) {
      this.messageToTask.delete(entry.userMessageId);
      if (entry.assistantMessageId) {
        this.messageToTask.delete(entry.assistantMessageId);
      }
      this.pending.delete(taskId);
    }
  }

  private handleQuestionAsked(props: Record<string, unknown> | undefined): void {
    if (!props) return;
    const questionId = props['id'] as string | undefined;
    const sessionID = props['sessionID'] as string | undefined;
    const questions = props['questions'] as Array<{
      question: string; header: string;
      options: Array<{ label: string; description: string }>;
      multiple: boolean; custom: boolean;
    }> | undefined;

    if (!questionId || !questions || questions.length === 0) return;
    if (sessionID && sessionID !== this.sessionId) return;

    let taskId: string | undefined;
    if (this.pending.size === 1) {
      const [onlyTaskId, onlyEntry] = [...this.pending.entries()][0];
      if (!onlyEntry.settled) taskId = onlyTaskId;
    } else if (this.pending.size > 1) {
      for (const [tid, entry] of this.pending) {
        if (!entry.settled) { taskId = tid; break; }
      }
    }

    if (!taskId) {
      return;
    }

    this.cancelSettleTimer(taskId);

    if (this.onQuestion) {
      this.onQuestion(taskId, {
        taskId,
        questionId,
        sessionId: sessionID ?? this.sessionId ?? '',
        questions: questions.map(q => ({
          question: q.question,
          header: q.header,
          options: q.options ?? [],
          multiple: q.multiple ?? false,
          custom: q.custom ?? true,
        })),
      });
    }
  }

  private handlePermissionAsked(props: Record<string, unknown> | undefined): void {
    if (!props) return;
    const permissionId = props['id'] as string | undefined;
    const sessionID = props['sessionID'] as string | undefined;
    const tool = props['tool'] as string | undefined;
    const input = props['input'] as Record<string, unknown> | undefined;

    if (!permissionId || !tool) return;
    if (sessionID && sessionID !== this.sessionId) return;

    let taskId: string | undefined;
    if (this.pending.size === 1) {
      const [onlyTaskId, onlyEntry] = [...this.pending.entries()][0];
      if (!onlyEntry.settled) taskId = onlyTaskId;
    } else if (this.pending.size > 1) {
      for (const [tid, entry] of this.pending) {
        if (!entry.settled) { taskId = tid; break; }
      }
    }

    if (!taskId) {
      return;
    }

    this.cancelSettleTimer(taskId);

    if (this.onPermission) {
      this.onPermission(taskId, {
        taskId,
        permissionId,
        sessionId: sessionID ?? this.sessionId ?? '',
        tool,
        input: input ?? {},
      });
    }
  }

  public answerQuestion(questionId: string, answers: string[][]): void {
    if (!this.opencodePort) return;
    const body = JSON.stringify({ answers });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: Number(this.opencodePort),
        path: `/question/${questionId}/reply`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        console.log(`[OpenCodeBridge] answerQuestion ${questionId} → ${res.statusCode}`);
      },
    );
    req.on('error', (err) => {
      console.warn(`[OpenCodeBridge] answerQuestion failed: ${err.message}`);
    });
    req.write(body);
    req.end();
  }

  public answerPermission(permissionId: string, allowed: boolean): void {
    if (!this.opencodePort) return;
    const body = JSON.stringify({ allowed });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: Number(this.opencodePort),
        path: `/permission/${permissionId}/reply`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        console.log(`[OpenCodeBridge] answerPermission ${permissionId} allowed=${allowed} → ${res.statusCode}`);
      },
    );
    req.on('error', (err) => {
      console.warn(`[OpenCodeBridge] answerPermission failed: ${err.message}`);
    });
    req.write(body);
    req.end();
  }

  private async discoverPort(): Promise<string | undefined> {
    const pid = process.env['OPENCODE_PID'];

    if (pid) {
      try {
        const { stdout: out } = await execAsync(`ss -tlnp 2>/dev/null | grep "pid=${pid}"`);
        const portMatch = out.match(/:(\d+)\s/);
        if (portMatch) return portMatch[1];
      } catch { /* fall through to scan */ }
    }

    const candidatePorts = process.platform !== 'win32'
      ? await this.findCandidatePortsUnix()
      : await this.findCandidatePortsWindows();

    if (candidatePorts.length === 0) return undefined;

    if (this.cwd) {
      const verified = await this.verifyPortBySessionApi(candidatePorts);
      if (verified) return verified;
      if (candidatePorts.length === 1) {
        console.warn(`[OpenCodeBridge] single opencode port=${candidatePorts[0]} found but no session matches cwd=${this.cwd}; using it anyway`);
      }
    }

    return candidatePorts[0];
  }

  private async verifyPortBySessionApi(ports: string[]): Promise<string | undefined> {
    for (const port of ports) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/session`, {
          signal: AbortSignal.timeout(2000),
        });
        const sessions = await res.json() as Array<{ directory?: string }>;
        if (sessions.some(s => s.directory === this.cwd)) {
          console.log(`[OpenCodeBridge] verified port=${port} via /session API (directory=${this.cwd})`);
          return port;
        }
      } catch { /* unreachable or not opencode */ }
    }
    return undefined;
  }

  private async findCandidatePortsUnix(): Promise<string[]> {
    try {
      const { stdout: psOut } = await execAsync(`ps -eo pid,args 2>/dev/null | grep "opencode.*--port" | grep -v grep`);
      const ports: string[] = [];
      for (const line of psOut.trim().split('\n')) {
        const portMatch = line.match(/--port\s+(\d+)/);
        if (portMatch && !ports.includes(portMatch[1])) {
          ports.push(portMatch[1]);
        }
      }
      return ports;
    } catch {
      return [];
    }
  }

  private async findCandidatePortsWindows(): Promise<string[]> {
    try {
      const { stdout: psOut } = await execAsync(
        'powershell -NoProfile -Command "Get-Process opencode -ErrorAction SilentlyContinue | ForEach-Object { (Get-CimInstance Win32_Process -Filter \\"ProcessId=$($_.Id)\\").CommandLine }"',
      );

      const ports: string[] = [];
      for (const line of psOut.trim().split('\n')) {
        const portMatch = line.match(/--port\s+(\d+)/);
        if (portMatch && !ports.includes(portMatch[1])) {
          ports.push(portMatch[1]);
        }
      }
      return ports;
    } catch {
      return [];
    }
  }

  private async discoverSession(): Promise<string | undefined> {
    if (process.env['OPENCODE_SESSION_ID']) {
      return process.env['OPENCODE_SESSION_ID'];
    }
    if (!this.client) return undefined;
    try {
      const { data: sessions } = await this.client.session.list();
      const list = sessions as Array<{ id: string; directory?: string; time: { updated: number } }> | undefined;
      if (!list || list.length === 0) return undefined;
      list.sort((a, b) => b.time.updated - a.time.updated);

      // Prefer sessions whose directory matches this bridge's cwd
      if (this.cwd) {
        const matching = list.find(s => s.directory === this.cwd);
        if (matching) {
          console.log(`[OpenCodeBridge] discovered session=${matching.id} matching cwd=${this.cwd}`);
          return matching.id;
        }
        console.warn(`[OpenCodeBridge] no session matches cwd=${this.cwd}, falling back to most recent`);
      }

      return list[0].id;
    } catch {
      return undefined;
    }
  }

  private async validateSessionExists(): Promise<boolean> {
    if (!this.client || !this.sessionId) return false;
    try {
      const { data: sessions } = await this.client.session.list();
      const list = sessions as Array<{ id: string }> | undefined;
      return list?.some(s => s.id === this.sessionId) ?? false;
    } catch {
      return false;
    }
  }

  private async discoverLastAssistantMessage(): Promise<string | undefined> {
    if (!this.client || !this.sessionId) return undefined;
    try {
      const { data: messages } = await this.client.session.messages({ path: { id: this.sessionId } });
      const list = messages as Array<{ info?: { id?: string; role?: string; time?: { completed?: number } } }> | undefined;
      if (!list) return undefined;
      for (let i = list.length - 1; i >= 0; i--) {
        const info = list[i].info;
        if (info?.role === 'assistant' && info.id && info.time?.completed) {
          return info.id;
        }
      }
      return undefined;
    } catch (e) {
      console.log(`[OpenCodeBridge] discoverLastAssistantMessage failed: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  }

  private async fetchLastError(assistantMessageId: string | undefined): Promise<string | undefined> {
    if (!this.client || !this.sessionId) return undefined;
    try {
      const { data: messages } = await this.client.session.messages({ path: { id: this.sessionId } });
      const list = messages as Array<{
        info?: { id?: string; role?: string; error?: string; metadata?: { error?: string } };
        parts?: Array<{ type?: string; text?: string }>;
      }> | undefined;
      if (!list) return undefined;

      for (let i = list.length - 1; i >= 0; i--) {
        const msg = list[i];
        if (msg.info?.role !== 'assistant') continue;
        if (assistantMessageId && msg.info.id !== assistantMessageId) continue;

        if (msg.info.error) return msg.info.error;
        if (msg.info.metadata?.error) return msg.info.metadata.error;

        const textParts = msg.parts?.filter(p => p.type === 'text' && p.text) ?? [];
        for (const part of textParts) {
          if (part.text && /error|failed|exception/i.test(part.text) && part.text.length < 500) {
            return part.text;
          }
        }
        break;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
