import { spawn, type ChildProcess } from 'node:child_process';

import type { ConnectorProjectConfig } from './connectorConfig.js';

export type OutputCallback = (taskId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
export type CompleteCallback = (
  taskId: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  startedAt: string,
  finishedAt: string,
) => void;
export type FailCallback = (taskId: string, error: string) => void;

export class LocalTaskExecutor {
  private readonly running = new Map<string, ChildProcess>();

  public constructor(private readonly projects: Map<string, ConnectorProjectConfig>) {}

  public execute(
    taskId: string,
    projectId: string,
    instruction: string,
    _mode: string,
    timeoutSeconds: number,
    onOutput: OutputCallback,
    onComplete: CompleteCallback,
    onFail: FailCallback,
  ): boolean {
    const project = this.projects.get(projectId);
    if (!project) {
      onFail(taskId, `Unknown project: ${projectId}`);
      return false;
    }

    const startedAt = new Date().toISOString();
    const args = ['run', instruction];

    const child = spawn(project.opencodeBin, args, {
      cwd: project.path,
      shell: false,
      env: { ...process.env },
    });

    this.running.set(taskId, child);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      onOutput(taskId, 'stdout', text);
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      onOutput(taskId, 'stderr', text);
    });

    let timeoutHandle: NodeJS.Timeout | undefined;
    if (timeoutSeconds > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeoutSeconds * 1000);
    }

    child.on('error', (err) => {
      this.running.delete(taskId);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      onFail(taskId, err.message);
    });

    child.on('close', (code) => {
      this.running.delete(taskId);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      onComplete(taskId, code ?? 1, stdout, stderr, startedAt, new Date().toISOString());
    });

    return true;
  }

  public cancel(taskId: string): boolean {
    const child = this.running.get(taskId);
    if (!child) return false;
    child.kill('SIGTERM');
    this.running.delete(taskId);
    return true;
  }

  public getRunningTaskIds(): string[] {
    return [...this.running.keys()];
  }
}
