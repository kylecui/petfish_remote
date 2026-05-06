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

export interface GeminiBridgeConfig {
  geminiBin?: string;
}

export class GeminiBridge implements AgentBridge {
  public readonly agentType: AgentType = 'gemini';

  private readonly bin: string;
  private readonly activeProcesses = new Map<string, ChildProcess>();

  public constructor(config: GeminiBridgeConfig) {
    this.bin = config.geminiBin ?? 'gemini';
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
    const proc = spawn(this.bin, ['-p', instruction, '--output-format', 'stream-json'], {
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
        onFail(taskId, `gemini exited with code ${code}: ${stderr.slice(0, 500)}`);
      }
    });

    proc.on('error', (err) => {
      this.activeProcesses.delete(taskId);
      onFail(taskId, `Failed to spawn gemini: ${err.message}`);
    });

    return true;
  }

  private handleJsonLine(taskId: string, line: string, onOutput: OutputCallback): void {
    try {
      const event = JSON.parse(line) as { type: string; [key: string]: unknown };

      switch (event.type) {
        case 'message': {
          const delta = event['delta'] as string | undefined;
          if (delta) {
            onOutput(taskId, 'stdout', delta);
          }
          break;
        }
        case 'tool_use': {
          const toolName = event['tool_name'] as string | undefined;
          const params = event['parameters'] as Record<string, unknown> | undefined;
          onOutput(taskId, 'stdout', `\n🔧 ${toolName ?? 'tool'}(${JSON.stringify(params ?? {}).slice(0, 200)})\n`);
          break;
        }
        case 'tool_result': {
          const status = event['status'] as string | undefined;
          const output = event['output'] as string | undefined;
          if (output) {
            const preview = output.length > 300 ? output.slice(0, 300) + '...' : output;
            onOutput(taskId, 'stdout', `  → ${status}: ${preview}\n`);
          }
          break;
        }
        case 'result':
        case 'init':
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

  public async requestNewSession(): Promise<void> {}

  public setQuestionCallback(_cb: QuestionCallback): void {}

  public setPermissionCallback(_cb: PermissionCallback): void {}

  public answerQuestion(_questionId: string, _answers: string[][]): void {}

  public answerPermission(_permissionId: string, _allowed: boolean): void {}
}
