import { execSync } from 'node:child_process';
import http from 'node:http';

export interface SessionBridgeConfig {
  opencodeBin?: string;
}

export type OutputCallback = (taskId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
export type CompleteCallback = (taskId: string, exitCode: number, stdout: string, stderr: string, startedAt: string, finishedAt: string) => void;
export type FailCallback = (taskId: string, error: string) => void;

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
}

export class SessionBridge {
  private sessionId: string | undefined;
  private opencodePort: string | undefined;
  private readonly pending = new Map<string, PendingPrompt>();
  private readonly messageToTask = new Map<string, string>();
  private readonly localQueue: Array<{ taskId: string; instruction: string; onOutput: OutputCallback; onComplete: CompleteCallback; onFail: FailCallback }> = [];
  private sseRequest: http.ClientRequest | undefined;
  private sseReconnectTimer: NodeJS.Timeout | undefined;
  private idleDrainTimer: NodeJS.Timeout | undefined;
  private readonly idleConfirmMs = 1500;
  private lastCompletedAssistantId: string | undefined;
  private pendingCorrelation: string | undefined;
  private stopped = false;

  public constructor(_config: SessionBridgeConfig) {}

  public async init(): Promise<void> {
    this.opencodePort = this.discoverPort();
    this.sessionId = this.discoverSession();
    if (!this.sessionId) {
      throw new Error('Cannot discover active session. Is OPENCODE_SESSION_ID set?');
    }
    if (!this.opencodePort) {
      throw new Error('Cannot discover opencode port. Is OPENCODE_PID set?');
    }
    this.lastCompletedAssistantId = this.discoverLastAssistantMessage();
    this.connectSSE();
    console.log(`SessionBridge: session=${this.sessionId} port=${this.opencodePort} lastAssistant=${this.lastCompletedAssistantId ?? 'none'}`);
  }

  public prompt(taskId: string, instruction: string, onOutput: OutputCallback, onComplete: CompleteCallback, onFail: FailCallback): boolean {
    if (!this.sessionId || !this.opencodePort) {
      onFail(taskId, 'SessionBridge not initialized');
      return false;
    }

    this.localQueue.push({ taskId, instruction, onOutput, onComplete, onFail });

    if (this.pending.size > 0) {
      console.log(`[SessionBridge] IM task in-flight, queuing ${taskId}`);
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

    const busy = this.isSessionBusy();
    if (busy) {
      console.log('[SessionBridge] Idle drain aborted — session still busy');
      return;
    }

    const next = this.localQueue.shift()!;
    console.log(`[SessionBridge] Confirmed idle, injecting taskId=${next.taskId} (${this.localQueue.length} remaining)`);
    this.injectPrompt(next.taskId, next.instruction, next.onOutput, next.onComplete, next.onFail);
  }

  private isSessionBusy(): boolean {
    if (this.pending.size > 0) return true;
    try {
      const raw = execSync(
        `curl -s http://127.0.0.1:${this.opencodePort}/session/status`,
        { encoding: 'utf-8', timeout: 3000 },
      );
      const statuses = JSON.parse(raw) as Record<string, { type: string }>;
      const status = statuses[this.sessionId!];
      return status?.type === 'busy';
    } catch {
      return false;
    }
  }

  private injectPrompt(taskId: string, instruction: string, onOutput: OutputCallback, onComplete: CompleteCallback, onFail: FailCallback): void {

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
    };

    this.pending.set(taskId, entry);
    this.pendingCorrelation = taskId;

    const port = Number(this.opencodePort);
    const clearBody = JSON.stringify({});
    const appendBody = JSON.stringify({ text: instruction });
    const submitBody = JSON.stringify({});

    const doPost = (path: string, body: string): Promise<number> => {
      return new Promise((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
          (res) => { res.resume(); resolve(res.statusCode ?? 0); },
        );
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    };

    (async () => {
      try {
        await doPost('/tui/clear-prompt', clearBody);
        await doPost('/tui/append-prompt', appendBody);
        const status = await doPost('/tui/submit-prompt', submitBody);
        console.log(`[SessionBridge] TUI submit response: ${status} taskId=${taskId}`);
        if (status !== 204 && status !== 200) {
          this.pendingCorrelation = undefined;
          this.settle(taskId, `TUI submit failed: ${status}`);
        }
      } catch (err) {
        this.pendingCorrelation = undefined;
        this.settle(taskId, `TUI submit error: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }

  public cancel(taskId: string): void {
    const entry = this.pending.get(taskId);
    if (entry && !entry.settled) {
      entry.settled = true;
      this.cleanup(taskId);
      entry.onComplete(taskId, -1, entry.stdout, 'Cancelled', entry.startedAt, new Date().toISOString());
    }
  }

  public stop(): void {
    this.stopped = true;
    this.cancelIdleDrain();
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
        entry.onComplete(taskId, -1, entry.stdout, 'Bridge stopped', entry.startedAt, new Date().toISOString());
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
          console.warn(`[SessionBridge] SSE connection failed: ${res.statusCode}`);
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
          console.log('[SessionBridge] SSE connection ended');
          this.scheduleSSEReconnect();
        });

        res.on('error', (err) => {
          console.warn(`[SessionBridge] SSE stream error: ${err.message}`);
          this.scheduleSSEReconnect();
        });
      },
    );

    req.on('error', (err) => {
      console.warn(`[SessionBridge] SSE connect error: ${err.message}`);
      this.scheduleSSEReconnect();
    });

    this.sseRequest = req;
  }

  private scheduleSSEReconnect(): void {
    if (this.stopped) return;
    this.sseReconnectTimer = setTimeout(() => {
      this.connectSSE();
    }, 3000);
  }

  private handleSSEEvent(data: string): void {
    let event: { type: string; properties?: Record<string, unknown> };
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }

    const interested = ['message.updated', 'message.part.updated', 'session.idle', 'session.status'];
    if (interested.includes(event.type)) {
      console.log(`[SSE] ${event.type} pending=${this.pending.size} msgMap=${this.messageToTask.size}`);
    }

    if (event.type === 'message.updated') {
      this.handleMessageUpdated(event.properties);
    } else if (event.type === 'message.part.updated') {
      this.handlePartUpdated(event.properties);
    } else if (event.type === 'session.idle') {
      this.handleSessionIdle(event.properties);
    } else if (event.type === 'session.status') {
      this.handleSessionStatus(event.properties);
    }
  }

  private handleMessageUpdated(props: Record<string, unknown> | undefined): void {
    if (!props) return;
    const info = props['info'] as { id?: string; role?: string; parentID?: string; time?: { completed?: number } } | undefined;
    if (!info) return;

    console.log(`[SSE] message.updated role=${info.role} id=${info.id} parentID=${info.parentID} completed=${!!info.time?.completed}`);

    if (info.role === 'user' && info.id && this.pendingCorrelation) {
      const taskId = this.pendingCorrelation;
      this.pendingCorrelation = undefined;
      const entry = this.pending.get(taskId);
      if (entry) {
        entry.userMessageId = info.id;
        this.messageToTask.set(info.id, taskId);
        console.log(`[SSE] correlated user msg ${info.id} → taskId=${taskId}`);
      }
    }

    if (info.role === 'assistant' && info.id && info.time?.completed) {
      this.lastCompletedAssistantId = info.id;
    }

    if (info.role === 'assistant' && info.parentID) {
      const taskId = this.messageToTask.get(info.parentID);
      console.log(`[SSE] assistant parentID=${info.parentID} → taskId=${taskId ?? 'NONE'} (known keys: ${[...this.messageToTask.keys()].join(', ')})`);
      if (taskId) {
        const entry = this.pending.get(taskId);
        if (entry) {
          entry.assistantMessageId = info.id;
          if (info.id) {
            this.messageToTask.set(info.id, taskId);
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

    console.log(`[SSE] part type=${part.type} msgId=${part.messageID} delta=${delta?.length ?? 'undef'} textLen=${part.text?.length ?? 0} pending=${this.pending.size}`);

    if (part.type !== 'text') return;

    const taskId = part.messageID ? this.messageToTask.get(part.messageID) : undefined;
    if (!taskId) return;

    const entry = this.pending.get(taskId);
    if (!entry || entry.settled) return;

    // Skip user message text — only relay assistant responses
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

  private handleSessionIdle(props: Record<string, unknown> | undefined): void {
    if (!props) return;
    const sessionID = props['sessionID'] as string | undefined;
    if (sessionID !== this.sessionId) return;

    for (const [taskId, entry] of this.pending) {
      if (!entry.settled) {
        entry.settled = true;
        this.cleanup(taskId);
        entry.onComplete(taskId, 0, entry.stdout, '', entry.startedAt, new Date().toISOString());
      }
    }

    this.scheduleIdleDrain();
  }

  private handleSessionStatus(props: Record<string, unknown> | undefined): void {
    if (!props) return;
    const sessionID = props['sessionID'] as string | undefined;
    if (sessionID !== this.sessionId) return;
    const status = props['status'] as { type?: string } | undefined;
    if (status?.type === 'busy') {
      this.cancelIdleDrain();
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
    const entry = this.pending.get(taskId);
    if (entry) {
      this.messageToTask.delete(entry.userMessageId);
      if (entry.assistantMessageId) {
        this.messageToTask.delete(entry.assistantMessageId);
      }
      this.pending.delete(taskId);
    }
  }

  private discoverPort(): string | undefined {
    const pid = process.env['OPENCODE_PID'];
    if (!pid) return undefined;
    try {
      const out = execSync(`ss -tlnp 2>/dev/null | grep "pid=${pid}"`, { encoding: 'utf-8' });
      const portMatch = out.match(/:(\d+)\s/);
      return portMatch?.[1];
    } catch {
      return undefined;
    }
  }

  private discoverSession(): string | undefined {
    if (process.env['OPENCODE_SESSION_ID']) {
      return process.env['OPENCODE_SESSION_ID'];
    }
    if (!this.opencodePort) return undefined;
    try {
      const sessionsRaw = execSync(`curl -s http://127.0.0.1:${this.opencodePort}/session`, { encoding: 'utf-8' });
      const sessions = JSON.parse(sessionsRaw) as Array<{ id: string; time: { updated: number } }>;
      if (sessions.length === 0) return undefined;
      sessions.sort((a, b) => b.time.updated - a.time.updated);
      return sessions[0].id;
    } catch {
      return undefined;
    }
  }

  private discoverLastAssistantMessage(): string | undefined {
    if (!this.opencodePort || !this.sessionId) return undefined;
    try {
      const raw = execSync(
        `curl -s --max-time 10 http://127.0.0.1:${this.opencodePort}/session/${this.sessionId}/message`,
        { encoding: 'utf-8', timeout: 15000, maxBuffer: 50 * 1024 * 1024 },
      );
      const messages = JSON.parse(raw) as Array<{ info?: { id?: string; role?: string; time?: { completed?: number } } }>;
      for (let i = messages.length - 1; i >= 0; i--) {
        const info = messages[i].info;
        if (info?.role === 'assistant' && info.id && info.time?.completed) {
          return info.id;
        }
      }
      return undefined;
    } catch (e) {
      console.log(`[SessionBridge] discoverLastAssistantMessage failed: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  }
}
