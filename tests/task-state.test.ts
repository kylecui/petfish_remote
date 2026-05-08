import { describe, it, expect, beforeEach } from 'vitest';
import { TaskManager } from '../src/core/TaskManager.js';
import { PolicyEngine } from '../src/core/PolicyEngine.js';
import { ProjectRegistry } from '../src/core/ProjectRegistry.js';
import { RuntimeRouter } from '../src/runtime/RuntimeRouter.js';
import { Storage } from '../src/storage/sqlite.js';
import type { TaskStatus } from '../src/types.js';

function createTestDeps() {
  const storage = new Storage(':memory:');
  storage.init();
  const runtimeRouter = new RuntimeRouter([]);
  const projectRegistry = new ProjectRegistry([]);
  const policyEngine = new PolicyEngine({
    blockedTargets: [],
    highRiskProfiles: [],
    requireApprovalActions: [],
  });
  const taskManager = new TaskManager(storage, runtimeRouter, projectRegistry, policyEngine);
  return { storage, taskManager };
}

function createTaskInState(taskManager: TaskManager, storage: Storage, status: TaskStatus): string {
  const task = taskManager.createTask({
    project_id: 'test-proj',
    user_id: 'test-user',
    instruction: 'test',
    mode: 'read_only',
  });
  if (status !== 'created') {
    // Force the storage to the desired state for testing guards
    storage.updateTask({ ...task, status, updated_at: new Date().toISOString() });
  }
  return task.task_id;
}

describe('Task State Machine', () => {
  let taskManager: TaskManager;
  let storage: Storage;

  beforeEach(() => {
    ({ taskManager, storage } = createTestDeps());
  });

  it('should transition from created to queued', () => {
    const id = createTaskInState(taskManager, storage, 'created');
    taskManager.updateStatus(id, 'queued');
    expect(taskManager.getTask(id)?.status).toBe('queued');
  });

  it('should transition from created to running', () => {
    const id = createTaskInState(taskManager, storage, 'created');
    taskManager.updateStatus(id, 'running');
    expect(taskManager.getTask(id)?.status).toBe('running');
  });

  it('should transition from created to failed', () => {
    const id = createTaskInState(taskManager, storage, 'created');
    taskManager.updateStatus(id, 'failed');
    expect(taskManager.getTask(id)?.status).toBe('failed');
  });

  it('should transition from queued to running', () => {
    const id = createTaskInState(taskManager, storage, 'queued');
    taskManager.updateStatus(id, 'running');
    expect(taskManager.getTask(id)?.status).toBe('running');
  });

  it('should transition from running to completed', () => {
    const id = createTaskInState(taskManager, storage, 'running');
    taskManager.updateStatus(id, 'completed');
    expect(taskManager.getTask(id)?.status).toBe('completed');
  });

  it('should transition from running to failed', () => {
    const id = createTaskInState(taskManager, storage, 'running');
    taskManager.updateStatus(id, 'failed');
    expect(taskManager.getTask(id)?.status).toBe('failed');
  });

  it('should transition from running to waiting_approval', () => {
    const id = createTaskInState(taskManager, storage, 'running');
    taskManager.updateStatus(id, 'waiting_approval');
    expect(taskManager.getTask(id)?.status).toBe('waiting_approval');
  });

  it('should transition from waiting_approval to running on approve', () => {
    const id = createTaskInState(taskManager, storage, 'waiting_approval');
    taskManager.updateStatus(id, 'running');
    expect(taskManager.getTask(id)?.status).toBe('running');
  });

  it('should transition from waiting_approval to cancelled on deny', () => {
    const id = createTaskInState(taskManager, storage, 'waiting_approval');
    taskManager.updateStatus(id, 'cancelled');
    expect(taskManager.getTask(id)?.status).toBe('cancelled');
  });

  it('should allow cancelling from any non-terminal state', () => {
    for (const state of ['created', 'queued', 'running', 'waiting_approval', 'waiting_user_input'] as TaskStatus[]) {
      const id = createTaskInState(taskManager, storage, state);
      taskManager.updateStatus(id, 'cancelled');
      expect(taskManager.getTask(id)?.status).toBe('cancelled');
    }
  });

  it('should reject transition from completed (terminal)', () => {
    const id = createTaskInState(taskManager, storage, 'completed');
    expect(() => taskManager.updateStatus(id, 'running')).toThrow('Invalid task state transition');
  });

  it('should reject transition from failed (terminal)', () => {
    const id = createTaskInState(taskManager, storage, 'failed');
    expect(() => taskManager.updateStatus(id, 'running')).toThrow('Invalid task state transition');
  });

  it('should reject transition from cancelled (terminal)', () => {
    const id = createTaskInState(taskManager, storage, 'cancelled');
    expect(() => taskManager.updateStatus(id, 'running')).toThrow('Invalid task state transition');
  });

  it('should reject transition from timeout (terminal)', () => {
    const id = createTaskInState(taskManager, storage, 'timeout');
    expect(() => taskManager.updateStatus(id, 'running')).toThrow('Invalid task state transition');
  });

  it('should reject invalid forward transitions', () => {
    const id = createTaskInState(taskManager, storage, 'created');
    expect(() => taskManager.updateStatus(id, 'completed')).toThrow('Invalid task state transition');
  });

  it('should reject backward transitions', () => {
    const id = createTaskInState(taskManager, storage, 'running');
    expect(() => taskManager.updateStatus(id, 'created')).toThrow('Invalid task state transition');
  });
});

describe('PolicyEngine integration', () => {
  it('should deny dispatch when target matches blockedTargets', async () => {
    const storage = new Storage(':memory:');
    storage.init();
    const projectRegistry = new ProjectRegistry([{
      id: 'secret-proj', name: 'Secret', runtime: 'connector', path: '/opt/.env/secret',
      default_mode: 'read_only', allowed_users: ['u1'], readme_files: [], test_commands: {},
      risk_profile: 'default', secrets_policy: 'mask',
    }]);
    const policyEngine = new PolicyEngine({
      blockedTargets: ['.env'],
      highRiskProfiles: [],
      requireApprovalActions: [],
    });
    const tm = new TaskManager(storage, new RuntimeRouter([]), projectRegistry, policyEngine);

    const task = tm.createTask({ project_id: 'secret-proj', user_id: 'u1', instruction: 'read', mode: 'read_only' });
    const result = await tm.dispatchTask(task.task_id);

    expect(result.output).toContain('Policy denied');
    expect(result.exitCode).toBe(-1);
    expect(tm.getTask(task.task_id)?.status).toBe('failed');
  });

  it('should require approval for high-risk profiles', async () => {
    const storage = new Storage(':memory:');
    storage.init();
    const projectRegistry = new ProjectRegistry([{
      id: 'risky-proj', name: 'Risky', runtime: 'connector', path: '/opt/risky',
      default_mode: 'read_only', allowed_users: ['u1'], readme_files: [], test_commands: {},
      risk_profile: 'kernel-ebpf', secrets_policy: 'mask',
    }]);
    const policyEngine = new PolicyEngine({
      blockedTargets: [],
      highRiskProfiles: ['kernel-ebpf'],
      requireApprovalActions: [],
    });
    const tm = new TaskManager(storage, new RuntimeRouter([]), projectRegistry, policyEngine);

    const task = tm.createTask({ project_id: 'risky-proj', user_id: 'u1', instruction: 'deploy', mode: 'read_only' });
    const result = await tm.dispatchTask(task.task_id);

    expect(result.output).toContain('requires approval');
    expect(result.exitCode).toBe(-1);
    expect(tm.getTask(task.task_id)?.status).toBe('waiting_approval');
  });

  it('should require approval for write/exec action types', async () => {
    const storage = new Storage(':memory:');
    storage.init();
    const projectRegistry = new ProjectRegistry([{
      id: 'safe-proj', name: 'Safe', runtime: 'connector', path: '/opt/safe',
      default_mode: 'read_only', allowed_users: ['u1'], readme_files: [], test_commands: {},
      risk_profile: 'default', secrets_policy: 'mask',
    }]);
    const policyEngine = new PolicyEngine({
      blockedTargets: [],
      highRiskProfiles: [],
      requireApprovalActions: ['write', 'exec'],
    });
    const tm = new TaskManager(storage, new RuntimeRouter([]), projectRegistry, policyEngine);

    const task = tm.createTask({ project_id: 'safe-proj', user_id: 'u1', instruction: 'edit file', mode: 'edit_guarded' });
    const result = await tm.dispatchTask(task.task_id);

    expect(result.output).toContain('requires approval');
    expect(tm.getTask(task.task_id)?.status).toBe('waiting_approval');
  });

  it('should deny a waiting task', () => {
    const storage = new Storage(':memory:');
    storage.init();
    const projectRegistry = new ProjectRegistry([{
      id: 'proj', name: 'P', runtime: 'connector', path: '/opt/p',
      default_mode: 'read_only', allowed_users: ['u1'], readme_files: [], test_commands: {},
      risk_profile: 'kernel-ebpf', secrets_policy: 'mask',
    }]);
    const policyEngine = new PolicyEngine({
      blockedTargets: [],
      highRiskProfiles: ['kernel-ebpf'],
      requireApprovalActions: [],
    });
    const tm = new TaskManager(storage, new RuntimeRouter([]), projectRegistry, policyEngine);

    const task = tm.createTask({ project_id: 'proj', user_id: 'u1', instruction: 'x', mode: 'read_only' });
    void tm.dispatchTask(task.task_id);
    tm.denyTask(task.task_id);
    expect(tm.getTask(task.task_id)?.status).toBe('cancelled');
  });
});
