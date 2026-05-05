import { spawn, execSync, type ChildProcess } from 'node:child_process';

export interface SessionBridgeConfig {
  opencodeBin?: string;
}

export type OutputCallback = (taskId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
export type CompleteCallback = (taskId: string, exitCode: number, stdout: string, stderr: string, startedAt: string, finishedAt: string) => void;
export type FailCallback = (taskId: string, error: string) => void;

export class SessionBridge {
  private sessionId: string | undefined;
  private readonly opencodeBin: string;
  private readonly running = new Map<string, ChildProcess>();

  public constructor(config: SessionBridgeConfig) {
    this.opencodeBin = config.opencodeBin ?? process.env['OPENCODE_BIN'] ?? 'opencode';
  }

  public async init(): Promise<void> {
    this.sessionId = this.discoverSession();
    if (!this.sessionId) {
      throw new Error('Cannot discover active session. Is OPENCODE_SESSION_ID set?');
    }
    console.log(`SessionBridge: session=${this.sessionId} bin=${this.opencodeBin}`);
  }

  public prompt(taskId: string, instruction: string, onOutput: OutputCallback, onComplete: CompleteCallback, onFail: FailCallback): boolean {
    if (!this.sessionId) {
      onFail(taskId, 'SessionBridge not initialized');
      return false;
    }

    const startedAt = new Date().toISOString();
    const args = ['run', '-s', this.sessionId, '--format', 'json', instruction];

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
          const event = JSON.parse(line) as { type: string; sessionID?: string; part?: { type: string; text?: string }; timestamp?: number };
          if (event.type === 'text' && event.part?.text) {
            onOutput(taskId, 'stdout', event.part.text);
          }
        } catch {
          // non-JSON line, ignore
        }
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      onOutput(taskId, 'stderr', data.toString());
    });

    child.on('error', (err) => {
      this.running.delete(taskId);
      onFail(taskId, err.message);
    });

    child.on('close', (code) => {
      this.running.delete(taskId);
      onComplete(taskId, code ?? 1, stdout, '', startedAt, new Date().toISOString());
    });

    return true;
  }

  public cancel(taskId: string): void {
    const child = this.running.get(taskId);
    if (child) {
      child.kill('SIGTERM');
      this.running.delete(taskId);
    }
  }

  public stop(): void {
    for (const [, child] of this.running) {
      child.kill('SIGTERM');
    }
    this.running.clear();
  }

  private discoverSession(): string | undefined {
    if (process.env['OPENCODE_SESSION_ID']) {
      return process.env['OPENCODE_SESSION_ID'];
    }

    const pid = process.env['OPENCODE_PID'];
    if (!pid) return undefined;

    try {
      const out = execSync(`ss -tlnp 2>/dev/null | grep "pid=${pid}"`, { encoding: 'utf-8' });
      const portMatch = out.match(/:(\d+)\s/);
      if (!portMatch) return undefined;

      const port = portMatch[1];
      const sessionsRaw = execSync(`curl -s http://127.0.0.1:${port}/session`, { encoding: 'utf-8' });
      const sessions = JSON.parse(sessionsRaw) as Array<{ id: string; time: { updated: number } }>;
      if (sessions.length === 0) return undefined;
      sessions.sort((a, b) => b.time.updated - a.time.updated);
      return sessions[0].id;
    } catch {
      return undefined;
    }
  }
}
