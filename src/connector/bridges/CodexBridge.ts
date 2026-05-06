import { spawn, type ChildProcess } from 'node:child_process';

import type {
  AgentBridge,
  AgentType,
  OutputCallback,
  CompleteCallback,
  FailCallback,
  QuestionCallback,
  PermissionCallback,
} from './AgentBridge.js';

export interface CodexBridgeConfig {
  codexBin?: string;
}

export class CodexBridge implements AgentBridge {
  public readonly agentType: AgentType = 'codex';

  private readonly bin: string;
  private readonly activeProcesses = new Map<string, ChildProcess>();

  public constructor(config: CodexBridgeConfig) {
    this.bin = config.codexBin ?? 'codex';
  }

  public async init(): Promise<void> {}

  public stop(): void {
    for (const [taskId, proc] of this.activeProcesses) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(taskId);
    }
  }

  public prompt(
    taskId: string,
    instruction: string,
    onOutput: OutputCallback,
    onComplete: CompleteCallback,
    onFail: FailCallback,
  ): boolean {
    const proc = spawn(this.bin, ['exec', '--json', instruction], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.activeProcesses.set(taskId, proc);
    const startedAt = new Date().toISOString();
    let stdout = '';
    let stderr = '';
    let lineBuffer = '';

    proc.stdout!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      lineBuffer += text;

      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleJsonLine(taskId, line, onOutput);
      }

      stdout += text;
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      onOutput(taskId, 'stderr', text);
    });

    proc.on('close', (code) => {
      if (lineBuffer.trim()) {
        this.handleJsonLine(taskId, lineBuffer, onOutput);
      }
      this.activeProcesses.delete(taskId);
      const finishedAt = new Date().toISOString();
      if (code === 0 || code === null) {
        onComplete(taskId, code ?? 0, stdout, stderr, startedAt, finishedAt);
      } else {
        onFail(taskId, `codex exited with code ${code}: ${stderr.slice(0, 500)}`);
      }
    });

    proc.on('error', (err) => {
      this.activeProcesses.delete(taskId);
      onFail(taskId, `Failed to spawn codex: ${err.message}`);
    });

    return true;
  }

  private handleJsonLine(taskId: string, line: string, onOutput: OutputCallback): void {
    try {
      const event = JSON.parse(line) as { type: string; [key: string]: unknown };

      switch (event.type) {
        case 'item.completed': {
          const item = event['item'] as { type?: string; text?: string } | undefined;
          if (item?.type === 'agent_message' && item.text) {
            onOutput(taskId, 'stdout', item.text);
          }
          break;
        }
        case 'item.started': {
          const item = event['item'] as { type?: string; command?: string } | undefined;
          if (item?.type === 'command_execution' && item.command) {
            onOutput(taskId, 'stdout', `\n$ ${item.command}\n`);
          }
          break;
        }
        case 'thread.started':
        case 'turn.completed':
          break;
        default:
          break;
      }
    } catch {
      if (line.trim()) {
        onOutput(taskId, 'stdout', line + '\n');
      }
    }
  }

  public cancel(taskId: string): void {
    const proc = this.activeProcesses.get(taskId);
    if (proc) {
      proc.kill('SIGTERM');
      this.activeProcesses.delete(taskId);
    }
  }

  public async requestNewSession(): Promise<void> {
    // Tier 1: each prompt is already a new session (no persistence)
  }

  public setQuestionCallback(_cb: QuestionCallback): void {}

  public setPermissionCallback(_cb: PermissionCallback): void {}

  public answerQuestion(_questionId: string, _answers: string[][]): void {}

  public answerPermission(_permissionId: string, _allowed: boolean): void {}
}
