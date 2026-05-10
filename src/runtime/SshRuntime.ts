import { spawn } from 'node:child_process';

import type { RuntimeType } from '../types.js';
import type { RuntimeCommand, RuntimeConnector, RuntimeHealth, RuntimeResult } from './RuntimeConnector.js';

export class SshRuntime implements RuntimeConnector {
  public readonly type: RuntimeType = 'ssh';
  private readonly runningProcesses = new Map<string, ReturnType<typeof spawn>>();

  public constructor(
    public readonly id: string,
    private readonly host: string,
    private readonly user: string,
    private readonly identityFile?: string,
    private readonly port?: number,
    private readonly opencodeBin = 'opencode',
  ) {}

  private buildSshArgs(remoteCommand: string): string[] {
    const args: string[] = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
    ];
    if (this.identityFile) {
      args.push('-i', this.identityFile);
    }
    if (this.port) {
      args.push('-p', String(this.port));
    }
    args.push(`${this.user}@${this.host}`, remoteCommand);
    return args;
  }

  public async healthCheck(): Promise<RuntimeHealth> {
    try {
      const result = await this.execSsh(`${this.opencodeBin} version 2>/dev/null || echo unknown`);
      const version = result.stdout.trim() || 'unknown';
      return {
        ok: result.exitCode === 0,
        runtimeId: this.id,
        opencodeAvailable: result.exitCode === 0 && version !== 'unknown',
        opencodeVersion: version,
        message: result.exitCode === 0
          ? `SSH connected to ${this.user}@${this.host}`
          : `SSH failed: ${result.stderr.trim()}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        runtimeId: this.id,
        opencodeAvailable: false,
        message: `SSH connection failed: ${msg}`,
      };
    }
  }

  public run(command: RuntimeCommand): Promise<RuntimeResult> {
    const startedAt = new Date().toISOString();

    const envPrefix = command.env
      ? Object.entries(command.env).map(([k, v]) => `${k}=${this.shellEscape(v)}`).join(' ') + ' '
      : '';

    const cdPrefix = command.cwd ? `cd ${this.shellEscape(command.cwd)} && ` : '';
    const remoteCommand = `${cdPrefix}${envPrefix}${command.command}`;

    return new Promise<RuntimeResult>((resolve, reject) => {
      const child = spawn('ssh', this.buildSshArgs(remoteCommand), { stdio: ['ignore', 'pipe', 'pipe'] });

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

  private execSsh(remoteCommand: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('ssh', this.buildSshArgs(remoteCommand), { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
      }, 15_000);

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }

  private shellEscape(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`;
  }
}
