import { nanoid } from 'nanoid';

import type { OpenCodeRunner } from '../opencode/OpenCodeRunner.js';
import type { Storage } from '../storage/sqlite.js';
import type { ExecutionMode, TaskRecord, TaskStatus } from '../types.js';
import type { PolicyEngine } from './PolicyEngine.js';

export interface CreateTaskParams {
  project_id: string;
  user_id: string;
  instruction: string;
  mode: ExecutionMode;
}

export class TaskManager {
  public constructor(
    private readonly storage: Storage,
    private readonly openCodeRunner: OpenCodeRunner,
    private readonly policyEngine: PolicyEngine,
  ) {
    void this.openCodeRunner;
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
