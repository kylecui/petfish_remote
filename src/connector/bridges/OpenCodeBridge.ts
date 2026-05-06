import { execSync } from 'node:child_process';
import http from 'node:http';

import type {
  AgentBridge,
  AgentType,
  OutputCallback,
  CompleteCallback,
  FailCallback,
  QuestionCallback,
  PermissionCallback,
} from './AgentBridge.js';

export interface OpenCodeBridgeConfig {
  opencodeBin?: string;
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
}

export class OpenCodeBridge implements AgentBridge {
  public readonly agentType: AgentType = 'opencode';

  private sessionId: string | undefined;
  private opencodePort: string | undefined;
  private readonly pending = new Map<string, PendingPrompt>();
  private readonly messageToTask = new Map<string, string>();
  private readonly localQueue: Array<{ taskId: string; instruction: string; onOutput: OutputCallback; onComplete: CompleteCallback; onFail: FailCallback }> = [];
  private sseRequest: http.ClientRequest | undefined;
  private sseReconnectTimer: NodeJS.Timeout | undefined;
  private idleDrainTimer: NodeJS.Timeout | undefined;
  private readonly settleTimers = new Map<string, NodeJS.Timeout>();
  private readonly idleConfirmMs = 1500;
  private readonly settleGraceMs = 300_000;
  private readonly submitVerifyMs = 5000;
  private readonly maxSubmitRetries = 3;
  private lastCompletedAssistantId: string | undefined;
  private lastActiveTaskId: string | undefined;
  private pendingCorrelation: string | undefined;
  private stopped = false;
  private onQuestion: QuestionCallback | undefined;
  private onPermission: PermissionCallback | undefined;

  public constructor(_config: OpenCodeBridgeConfig) {}

  public setQuestionCallback(cb: QuestionCallback): void {
    this.onQuestion = cb;
  }

  public setPermissionCallback(cb: PermissionCallback): void {
    this.onPermission = cb;
  }

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
    console.log(`OpenCodeBridge: session=${this.sessionId} port=${this.opencodePort} lastAssistant=${this.lastCompletedAssistantId ?? 'none'}`);
  }

  private rediscover(): boolean {
    const oldPort = this.opencodePort;
    const oldSession = this.sessionId;

    this.opencodePort = this.discoverPort();
    if (!this.opencodePort) {
      console.warn('[OpenCodeBridge] rediscover: cannot find opencode port');
      return false;
    }

    this.sessionId = this.discoverSession();
    if (!this.sessionId) {
      console.warn('[OpenCodeBridge] rediscover: cannot find active session');
      return false;
    }

    if (this.opencodePort !== oldPort || this.sessionId !== oldSession) {
      console.log(`[OpenCodeBridge] rediscovered: port=${oldPort}→${this.opencodePort} session=${oldSession}→${this.sessionId}`);
      if (this.sseRequest) {
        this.sseRequest.destroy();
        this.sseRequest = undefined;
      }
      this.connectSSE();
    }
    return true;
  }

  public prompt(taskId: string, instruction: string, onOutput: OutputCallback, onComplete: CompleteCallback, onFail: FailCallback): boolean {
    if (!this.sessionId || !this.opencodePort) {
      if (!this.rediscover()) {
        onFail(taskId, 'OpenCodeBridge not initialized and rediscovery failed');
        return false;
      }
    }

    this.localQueue.push({ taskId, instruction, onOutput, onComplete, onFail });

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

    const busy = this.isSessionBusy();
    if (busy) {
      console.log('[OpenCodeBridge] Idle drain aborted — session still busy');
      return;
    }

    const next = this.localQueue.shift()!;
    console.log(`[OpenCodeBridge] Confirmed idle, injecting taskId=${next.taskId} (${this.localQueue.length} remaining)`);
    this.injectPrompt(next.taskId, next.instruction, next.onOutput, next.onComplete, next.onFail);
  }

  private isSessionBusy(): boolean {
    if (this.pending.size > 0) return true;
    try {
      const raw = execSync(
        `curl -s --max-time 5 http://127.0.0.1:${this.opencodePort}/session/status`,
        { encoding: 'utf-8', timeout: 8000 },
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
    this.lastActiveTaskId = taskId;
    this.pendingCorrelation = taskId;

    const port = Number(this.opencodePort);

    const doPost = (path: string, body: string): Promise<number> => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          req.destroy();
          reject(new Error(`HTTP POST ${path} timed out after 10s`));
        }, 10_000);
        const req = http.request(
          { hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
          (res) => { res.resume(); clearTimeout(timer); resolve(res.statusCode ?? 0); },
        );
        req.on('error', (err) => { clearTimeout(timer); reject(err); });
        req.write(body);
        req.end();
      });
    };

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
        const clearBody = JSON.stringify({});
        const appendBody = JSON.stringify({ text: instruction });
        const submitBody = JSON.stringify({});

        await doPost('/tui/clear-prompt', clearBody);
        await doPost('/tui/append-prompt', appendBody);
        await new Promise(r => setTimeout(r, 200));

        for (let attempt = 0; attempt < this.maxSubmitRetries; attempt++) {
          const status = await doPost('/tui/submit-prompt', submitBody);
          console.log(`[OpenCodeBridge] TUI submit response: ${status} taskId=${taskId} attempt=${attempt + 1}`);

          if (status !== 204 && status !== 200) {
            this.pendingCorrelation = undefined;
            this.settle(taskId, `TUI submit failed: ${status}`);
            return;
          }

          const correlated = await waitForCorrelation();
          if (correlated) {
            return;
          }

          console.log(`[OpenCodeBridge] Submit not acknowledged after ${this.submitVerifyMs}ms, retry ${attempt + 2}/${this.maxSubmitRetries} taskId=${taskId}`);

          if (attempt < this.maxSubmitRetries - 1) {
            await doPost('/tui/clear-prompt', clearBody);
            await doPost('/tui/append-prompt', appendBody);
            await new Promise(r => setTimeout(r, 200));
          }
        }

        console.log(`[OpenCodeBridge] Submit failed after ${this.maxSubmitRetries} retries, re-queuing taskId=${taskId}`);
        this.pendingCorrelation = undefined;
        this.pending.delete(taskId);
        this.localQueue.unshift({ taskId, instruction, onOutput, onComplete, onFail });
        this.scheduleIdleDrain();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[OpenCodeBridge] inject failed for taskId=${taskId}: ${errMsg}`);
        this.pendingCorrelation = undefined;
        this.pending.delete(taskId);

        if (this.rediscover()) {
          console.log(`[OpenCodeBridge] rediscovered after failure, re-queuing taskId=${taskId}`);
          this.localQueue.unshift({ taskId, instruction, onOutput, onComplete, onFail });
          this.scheduleIdleDrain();
        } else {
          onFail(taskId, `TUI submit error: ${errMsg} (rediscovery also failed)`);
        }
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

  public async requestNewSession(): Promise<void> {
    if (!this.opencodePort) {
      console.warn('[OpenCodeBridge] requestNewSession: no opencode port');
      return;
    }

    try {
      execSync(
        `curl -s --max-time 5 -X POST http://127.0.0.1:${this.opencodePort}/session`,
        { encoding: 'utf-8', timeout: 8000 },
      );
      this.rediscover();
      console.log(`[OpenCodeBridge] new session created, now on session=${this.sessionId}`);
    } catch (err) {
      console.warn(`[OpenCodeBridge] requestNewSession failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public stop(): void {
    this.stopped = true;
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

    if (event.type === 'message.updated') {
      this.handleMessageUpdated(event.properties);
    } else if (event.type === 'message.part.updated') {
      this.handlePartUpdated(event.properties);
    } else if (event.type === 'session.idle') {
      this.handleSessionIdle(event.properties);
    } else if (event.type === 'session.status') {
      this.handleSessionStatus(event.properties);
    } else if (event.type === 'question.asked') {
      this.handleQuestionAsked(event.properties);
    } else if (event.type === 'permission.asked') {
      this.handlePermissionAsked(event.properties);
    }
  }

  private handleMessageUpdated(props: Record<string, unknown> | undefined): void {
    if (!props) return;
    const info = props['info'] as { id?: string; role?: string; parentID?: string; time?: { completed?: number } } | undefined;
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
    }

    if (info.role === 'assistant' && info.parentID) {
      let taskId = this.messageToTask.get(info.parentID);

      if (!taskId && this.pending.size === 1) {
        const [onlyTaskId, onlyEntry] = [...this.pending.entries()][0];
        if (!onlyEntry.settled) {
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

    if (!taskId && this.pending.size === 1) {
      const [onlyTaskId, onlyEntry] = [...this.pending.entries()][0];
      if (!onlyEntry.settled && part.messageID !== onlyEntry.userMessageId) {
        taskId = onlyTaskId;
        if (part.messageID) {
          this.messageToTask.set(part.messageID, taskId);
        }
      }
    }

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
      for (const taskId of this.settleTimers.keys()) {
        this.cancelSettleTimer(taskId);
      }
    }
  }

  private scheduleSettleOnComplete(taskId: string): void {
    const existing = this.settleTimers.get(taskId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.settleTimers.delete(taskId);
      const entry = this.pending.get(taskId);
      if (!entry || entry.settled) return;

      if (this.isSessionBusy()) {
        console.log(`[OpenCodeBridge] safety settle deferred — session still busy task=${taskId}`);
        return;
      }

      console.log(`[OpenCodeBridge] safety settle firing task=${taskId} (${this.settleGraceMs / 1000}s timeout)`);
      entry.settled = true;
      this.cleanup(taskId);
      entry.onComplete(taskId, 0, entry.stdout, '', entry.startedAt, new Date().toISOString());
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
      taskId = this.lastActiveTaskId ?? `question_${questionId}`;
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
      taskId = this.lastActiveTaskId ?? `permission_${permissionId}`;
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
      console.log(`[OpenCodeBridge] discoverLastAssistantMessage failed: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  }
}
