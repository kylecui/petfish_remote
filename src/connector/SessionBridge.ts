import { spawn, execSync, type ChildProcess } from 'node:child_process';

export interface SessionBridgeConfig {
  opencodeBin?: string;
  pollIntervalMs?: number;
  maxQueueWaitMs?: number;
}

export type OutputCallback = (taskId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
export type CompleteCallback = (taskId: string, exitCode: number, stdout: string, stderr: string, startedAt: string, finishedAt: string) => void;
export type FailCallback = (taskId: string, error: string) => void;

interface QueuedTask {
  taskId: string;
  instruction: string;
  onOutput: OutputCallback;
  onComplete: CompleteCallback;
  onFail: FailCallback;
  queuedAt: number;
}

export class SessionBridge {
  private sessionId: string | undefined;
  private opencodePort: string | undefined;
  private readonly opencodeBin: string;
  private readonly pollIntervalMs: number;
  private readonly maxQueueWaitMs: number;
  private readonly running = new Map<string, ChildProcess>();
  private readonly queue: QueuedTask[] = [];
  private pollTimer: NodeJS.Timeout | undefined;

  public constructor(config: SessionBridgeConfig) {
    this.opencodeBin = config.opencodeBin ?? process.env['OPENCODE_BIN'] ?? 'opencode';
    this.pollIntervalMs = config.pollIntervalMs ?? 5_000;
    this.maxQueueWaitMs = config.maxQueueWaitMs ?? 300_000;
  }

  public async init(): Promise<void> {
    this.opencodePort = this.discoverPort();
    this.sessionId = this.discoverSession();
    if (!this.sessionId) {
      throw new Error('Cannot discover active session. Is OPENCODE_SESSION_ID set?');
    }
    console.log(`SessionBridge: session=${this.sessionId} port=${this.opencodePort ?? 'none'} bin=${this.opencodeBin}`);
  }

  public prompt(taskId: string, instruction: string, onOutput: OutputCallback, onComplete: CompleteCallback, onFail: FailCallback): boolean {
    if (!this.sessionId) {
      onFail(taskId, 'SessionBridge not initialized');
      return false;
    }

    const status = this.getSessionStatus();

    if (status === 'busy' || this.running.size > 0) {
      this.queue.push({ taskId, instruction, onOutput, onComplete, onFail, queuedAt: Date.now() });
      onOutput(taskId, 'stdout', '⏳ Agent is currently working on a task. Your request is queued and will be processed once it becomes idle.\n');
      console.log(`[SessionBridge] Task ${taskId} queued (session busy, queue size: ${this.queue.length})`);
      this.ensurePolling();
      return true;
    }

    this.spawnRun(taskId, instruction, onOutput, onComplete, onFail);
    return true;
  }

  public cancel(taskId: string): void {
    const child = this.running.get(taskId);
    if (child) {
      child.kill('SIGTERM');
      this.running.delete(taskId);
      return;
    }
    const idx = this.queue.findIndex((t) => t.taskId === taskId);
    if (idx !== -1) {
      const removed = this.queue.splice(idx, 1)[0];
      removed.onComplete(taskId, -1, '', 'Cancelled while queued', removed.queuedAt.toString(), new Date().toISOString());
    }
  }

  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    for (const [, child] of this.running) {
      child.kill('SIGTERM');
    }
    this.running.clear();
    this.queue.length = 0;
  }

  private spawnRun(taskId: string, instruction: string, onOutput: OutputCallback, onComplete: CompleteCallback, onFail: FailCallback): void {
    const startedAt = new Date().toISOString();
    const args = ['run', '-s', this.sessionId!, '--format', 'json', instruction];

    console.log(`[SessionBridge] Spawning: ${this.opencodeBin} ${args.slice(0, 4).join(' ')} "<instruction>"`);

    const child = spawn(this.opencodeBin, args, {
      cwd: process.cwd(),
      shell: false,
      env: { ...process.env },
    });

    this.running.set(taskId, child);
    let stdout = '';
    let textBuffer = '';

    child.stdout.on('data', (data: Buffer) => {
      const raw = data.toString();
      stdout += raw;

      const lines = (textBuffer + raw).split('\n');
      textBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as { type: string; part?: { text?: string } };
          if (event.type === 'text' && event.part?.text) {
            onOutput(taskId, 'stdout', event.part.text);
          }
        } catch {
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      onOutput(taskId, 'stderr', data.toString());
    });

    child.on('error', (err) => {
      this.running.delete(taskId);
      onFail(taskId, err.message);
      this.drainQueue();
    });

    child.on('close', (code) => {
      this.running.delete(taskId);
      onComplete(taskId, code ?? 1, stdout, '', startedAt, new Date().toISOString());
      this.drainQueue();
    });
  }

  private ensurePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.checkAndDrain();
    }, this.pollIntervalMs);
  }

  private checkAndDrain(): void {
    if (this.queue.length === 0) {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
      return;
    }

    const now = Date.now();
    while (this.queue.length > 0 && now - this.queue[0].queuedAt > this.maxQueueWaitMs) {
      const expired = this.queue.shift()!;
      expired.onOutput(expired.taskId, 'stdout', '⚠️ Request timed out after waiting too long for agent to become idle.\n');
      expired.onComplete(expired.taskId, -1, '', 'Queue timeout', expired.queuedAt.toString(), new Date().toISOString());
    }

    if (this.queue.length === 0) {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
      return;
    }

    if (this.running.size > 0) return;
    const status = this.getSessionStatus();
    if (status === 'idle') {
      this.drainQueue();
    }
  }

  private drainQueue(): void {
    if (this.queue.length === 0) return;
    if (this.running.size > 0) return;

    const next = this.queue.shift()!;
    console.log(`[SessionBridge] Dequeuing task ${next.taskId} (remaining: ${this.queue.length})`);
    next.onOutput(next.taskId, 'stdout', '▶️ Agent is now idle. Processing your request...\n');
    this.spawnRun(next.taskId, next.instruction, next.onOutput, next.onComplete, next.onFail);
  }

  private getSessionStatus(): 'idle' | 'busy' | 'unknown' {
    if (!this.opencodePort) return 'unknown';
    try {
      const raw = execSync(`curl -s http://127.0.0.1:${this.opencodePort}/session/status`, {
        encoding: 'utf-8',
        timeout: 3000,
      });
      const statuses = JSON.parse(raw) as Record<string, { type: string }>;
      const entry = statuses[this.sessionId!];
      if (entry?.type === 'idle') return 'idle';
      if (entry?.type === 'busy') return 'busy';
      return 'unknown';
    } catch {
      return 'unknown';
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
}
