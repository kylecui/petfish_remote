import { nanoid } from 'nanoid';

import { OpenCodeCliRunner } from '../opencode/OpenCodeCliRunner.js';
import type { OutputStream } from '../runtime/RuntimeConnector.js';
import type { RuntimeRouter } from '../runtime/RuntimeRouter.js';
import type { Storage } from '../storage/sqlite.js';
import type { ExecutionMode, ProjectConfig, TaskRecord, TaskStatus } from '../types.js';
import type { PolicyAction, PolicyEngine } from './PolicyEngine.js';
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

/** Valid state transitions for the task state machine. Terminal states have no outbound edges. */
const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  created: ['queued', 'running', 'failed', 'waiting_approval', 'cancelled'],
  queued: ['running', 'cancelled', 'failed'],
  running: ['completed', 'failed', 'cancelled', 'waiting_approval', 'waiting_user_input', 'timeout'],
  waiting_approval: ['running', 'cancelled', 'failed'],
  waiting_user_input: ['running', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
  timeout: [],
};

const MODE_TO_ACTION_TYPE: Record<ExecutionMode, PolicyAction['type']> = {
  read_only: 'read',
  suggest: 'read',
  edit_guarded: 'write',
  execute_guarded: 'exec',
  admin: 'exec',
};

export class TaskManager {
  public constructor(
    private readonly storage: Storage,
    private readonly runtimeRouter: RuntimeRouter,
    private readonly projectRegistry: ProjectRegistry,
    private readonly policyEngine: PolicyEngine,
  ) {}

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

    const policyDecision = this.policyEngine.evaluate({
      type: MODE_TO_ACTION_TYPE[task.mode],
      target: project.path,
      project_profile: project.risk_profile,
    });

    if (policyDecision === 'deny') {
      this.updateStatus(taskId, 'failed');
      return { output: `Policy denied: task target or profile is blocked.`, exitCode: -1 };
    }

    if (policyDecision === 'require_approval') {
      this.updateStatus(taskId, 'waiting_approval');
      this.storage.updateTask({
        ...this.storage.getTask(taskId)!,
        risk_level: 'high',
        updated_at: new Date().toISOString(),
      });
      return { output: `Task requires approval. Use /pf approve ${taskId} to proceed.`, exitCode: -1 };
    }

    try {
      this.runtimeRouter.getConnector(project.runtime);
    } catch {
      this.updateStatus(taskId, 'queued');
      return { output: `Runtime "${project.runtime}" is not connected. Task queued.`, exitCode: -1 };
    }

    this.updateStatus(taskId, 'running');
    return this.executeTask(taskId, task, project, onOutput);
  }

  private async executeTask(
    taskId: string,
    task: TaskRecord,
    project: ProjectConfig,
    onOutput?: (chunk: string, stream: OutputStream) => void,
  ): Promise<TaskDispatchResult> {
    let connector: ReturnType<RuntimeRouter['getConnector']>;
    try {
      connector = this.runtimeRouter.getConnector(project.runtime);
    } catch {
      this.updateStatus(taskId, 'failed');
      return { output: `Runtime "${project.runtime}" is not connected.`, exitCode: -1 };
    }

    console.log(`[dispatch] taskId=${taskId} project=${task.project_id} runtime=${project.runtime} connector=${connector.id}(${connector.type})`);

    const runner = new OpenCodeCliRunner(connector);
    try {
      const result = await runner.run({
        projectPath: project.path,
        projectId: task.project_id,
        instruction: task.instruction,
        mode: task.mode,
        sessionId: taskId,
        timeoutSeconds: 1800,
        onOutput,
      });

      console.log(`[dispatch] taskId=${taskId} completed exitCode=${result.exitCode}`);
      this.updateStatus(taskId, result.exitCode === 0 ? 'completed' : 'failed');
      return { output: result.output, exitCode: result.exitCode };
    } catch (err) {
      console.error(`[dispatch] taskId=${taskId} error:`, err);
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

    const allowed = VALID_TRANSITIONS[existing.status];
    if (!allowed.includes(status)) {
      throw new Error(
        `Invalid task state transition: ${existing.status} → ${status} (task ${taskId})`,
      );
    }

    this.storage.updateTask({ ...existing, status, updated_at: new Date().toISOString() });
  }

  public cancelTask(taskId: string): void {
    this.updateStatus(taskId, 'cancelled');
  }

  public approveTask(
    taskId: string,
    onOutput?: (chunk: string, stream: OutputStream) => void,
  ): Promise<TaskDispatchResult> {
    const task = this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'waiting_approval') {
      throw new Error(`Task ${taskId} is not waiting for approval (status: ${task.status})`);
    }
    this.updateStatus(taskId, 'running');

    const project = this.projectRegistry.getProject(task.project_id);
    if (!project) {
      this.updateStatus(taskId, 'failed');
      return Promise.resolve({ output: `Project not found: ${task.project_id}`, exitCode: -1 });
    }

    return this.executeTask(taskId, task, project, onOutput);
  }

  public denyTask(taskId: string): void {
    const task = this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'waiting_approval') {
      throw new Error(`Task ${taskId} is not waiting for approval (status: ${task.status})`);
    }
    this.updateStatus(taskId, 'cancelled');
  }
}
