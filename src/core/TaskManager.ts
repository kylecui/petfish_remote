import { nanoid } from 'nanoid';

import { OpenCodeCliRunner } from '../opencode/OpenCodeCliRunner.js';
import type { OutputStream } from '../runtime/RuntimeConnector.js';
import type { RuntimeRouter } from '../runtime/RuntimeRouter.js';
import type { Storage } from '../storage/sqlite.js';
import type { ExecutionMode, TaskRecord, TaskStatus } from '../types.js';
import type { PolicyEngine } from './PolicyEngine.js';
import type { ProjectRegistry } from './ProjectRegistry.js';

export interface CreateTaskParams {
  project_id: string;
  user_id: string;
  instruction: string;
  mode: ExecutionMode;
}

export interface TaskDispatchResult {
  output: string;
  exitCode: number;
}

export class TaskManager {
  public constructor(
    private readonly storage: Storage,
    private readonly runtimeRouter: RuntimeRouter,
    private readonly projectRegistry: ProjectRegistry,
    private readonly policyEngine: PolicyEngine,
  ) {
    void this.policyEngine;
  }

  public createTask(params: CreateTaskParams): TaskRecord {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      task_id: nanoid(),
      project_id: params.project_id,
      user_id: params.user_id,
      instruction: params.instruction,
      mode: params.mode,
      status: 'created',
      created_at: now,
      updated_at: now,
    };

    this.storage.createTask(task);
    return task;
  }

  public async dispatchTask(
    taskId: string,
    onOutput?: (chunk: string, stream: OutputStream) => void,
  ): Promise<TaskDispatchResult> {
    const task = this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const project = this.projectRegistry.getProject(task.project_id);
    if (!project) {
      this.updateStatus(taskId, 'failed');
      throw new Error(`Project not found: ${task.project_id}`);
    }

    let connector;
    try {
      connector = this.runtimeRouter.getConnector(project.runtime);
    } catch {
      this.updateStatus(taskId, 'queued');
      return { output: `Runtime "${project.runtime}" is not connected. Task queued.`, exitCode: -1 };
    }

    this.updateStatus(taskId, 'running');

    const runner = new OpenCodeCliRunner(connector);
    try {
      const result = await runner.run({
        projectPath: project.path,
        instruction: task.instruction,
        mode: task.mode,
        sessionId: taskId,
        timeoutSeconds: 1800,
        onOutput,
      });

      this.updateStatus(taskId, result.exitCode === 0 ? 'completed' : 'failed');
      return { output: result.output, exitCode: result.exitCode };
    } catch (err) {
      this.updateStatus(taskId, 'failed');
      throw err;
    }
  }

  public getTask(taskId: string): TaskRecord | undefined {
    return this.storage.getTask(taskId);
  }

  public updateStatus(taskId: string, status: TaskStatus): void {
    const existing = this.storage.getTask(taskId);
    if (!existing) {
      throw new Error(`Task not found: ${taskId}`);
    }
    this.storage.updateTask({ ...existing, status, updated_at: new Date().toISOString() });
  }

  public cancelTask(taskId: string): void {
    this.updateStatus(taskId, 'cancelled');
  }
}
