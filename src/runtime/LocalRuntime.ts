import { spawn } from 'node:child_process';

import type { RuntimeType } from '../types.js';
import type { RuntimeCommand, RuntimeConnector, RuntimeHealth, RuntimeResult } from './RuntimeConnector.js';

export class LocalRuntime implements RuntimeConnector {
  public readonly type: RuntimeType = 'local';
  private readonly runningProcesses = new Map<string, ReturnType<typeof spawn>>();

  public constructor(public readonly id: string, private readonly opencodeBin = 'opencode') {}

  public async healthCheck(): Promise<RuntimeHealth> {
    return {
      ok: true,
      runtimeId: this.id,
      opencodeAvailable: true,
      opencodeVersion: 'unknown',
      message: `Assuming ${this.opencodeBin} is available`,
    };
  }

  public run(command: RuntimeCommand): Promise<RuntimeResult> {
    const startedAt = new Date().toISOString();

    return new Promise<RuntimeResult>((resolve, reject) => {
      const child = spawn(command.command, {
        cwd: command.cwd,
        env: { ...process.env, ...(command.env ?? {}) },
        shell: true,
      });

      if (command.taskId) {
        this.runningProcesses.set(command.taskId, child);
      }

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        command.onOutput?.(text, 'stdout');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        command.onOutput?.(text, 'stderr');
      });

      let timeoutHandle: NodeJS.Timeout | undefined;
      if (command.timeoutSeconds && command.timeoutSeconds > 0) {
        timeoutHandle = setTimeout(() => {
          child.kill('SIGTERM');
        }, command.timeoutSeconds * 1000);
      }

      child.on('error', (error) => {
        if (command.taskId) {
          this.runningProcesses.delete(command.taskId);
        }
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        reject(error);
      });

      child.on('close', (code) => {
        if (command.taskId) {
          this.runningProcesses.delete(command.taskId);
        }
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          startedAt,
          finishedAt: new Date().toISOString(),
        });
      });
    });
  }

  public async stop(taskId: string): Promise<void> {
    const child = this.runningProcesses.get(taskId);
    if (!child) {
      return;
    }
    child.kill('SIGTERM');
    this.runningProcesses.delete(taskId);
  }
}
