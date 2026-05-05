import type { RuntimeType } from '../types.js';
import {
  type TaskStartPayload,
  type TaskOutputPayload,
  type TaskCompletePayload,
  type TaskFailPayload,
  MSG,
  createEnvelope,
} from '../protocol/connectorProtocol.js';
import type { RuntimeCommand, RuntimeConnector, RuntimeHealth, RuntimeResult } from '../runtime/RuntimeConnector.js';
import type { ConnectorGateway } from '../server/ConnectorGateway.js';

interface PendingTask {
  command: RuntimeCommand;
  resolve: (result: RuntimeResult) => void;
  reject: (error: Error) => void;
  stdout: string;
  stderr: string;
  startedAt: string;
}

export class RemoteRuntime implements RuntimeConnector {
  public readonly type: RuntimeType = 'connector';
  private readonly pending = new Map<string, PendingTask>();

  public constructor(
    public readonly id: string,
    private readonly connectorId: string,
    private readonly gateway: ConnectorGateway,
  ) {
    this.wireGatewayHandlers();
  }

  public async healthCheck(): Promise<RuntimeHealth> {
    const info = this.gateway.registry.get(this.connectorId);
    return {
      ok: !!info,
      runtimeId: this.id,
      opencodeAvailable: !!info,
      message: info ? `Connected from ${info.hostname}` : `Connector ${this.connectorId} not connected`,
    };
  }

  public run(command: RuntimeCommand): Promise<RuntimeResult> {
    const taskId = command.taskId;
    if (!taskId) {
      return Promise.reject(new Error('RemoteRuntime requires command.taskId'));
    }

    const info = this.gateway.registry.get(this.connectorId);
    if (!info) {
      return Promise.reject(new Error(`Connector ${this.connectorId} is not connected`));
    }

    return new Promise<RuntimeResult>((resolve, reject) => {
      this.pending.set(taskId, {
        command,
        resolve,
        reject,
        stdout: '',
        stderr: '',
        startedAt: new Date().toISOString(),
      });

      const payload: TaskStartPayload = {
        taskId,
        projectId: '',
        projectPath: command.cwd,
        instruction: command.command,
        mode: 'read_only',
        timeoutSeconds: command.timeoutSeconds ?? 1800,
        env: command.env,
      };

      const envelope = createEnvelope(MSG.TASK_START, payload as unknown as Record<string, unknown>, taskId);
      const sent = this.gateway.sendToConnector(this.connectorId, envelope);
      if (!sent) {
        this.pending.delete(taskId);
        reject(new Error(`Failed to send task to connector ${this.connectorId}`));
      }
    });
  }

  public async stop(taskId: string): Promise<void> {
    const envelope = createEnvelope(MSG.TASK_CONTROL, { taskId, action: 'cancel' }, taskId);
    this.gateway.sendToConnector(this.connectorId, envelope);
    const pending = this.pending.get(taskId);
    if (pending) {
      this.pending.delete(taskId);
      pending.resolve({
        exitCode: -1,
        stdout: pending.stdout,
        stderr: pending.stderr,
        startedAt: pending.startedAt,
        finishedAt: new Date().toISOString(),
      });
    }
  }

  private wireGatewayHandlers(): void {
    this.gateway.on('task:output', (connectorId: string, payload: TaskOutputPayload) => {
      if (connectorId !== this.connectorId) return;
      const pending = this.pending.get(payload.taskId);
      if (!pending) return;
      if (payload.stream === 'stdout') {
        pending.stdout += payload.chunk;
      } else {
        pending.stderr += payload.chunk;
      }
      pending.command.onOutput?.(payload.chunk, payload.stream);
    });

    this.gateway.on('task:complete', (connectorId: string, payload: TaskCompletePayload) => {
      if (connectorId !== this.connectorId) return;
      const pending = this.pending.get(payload.taskId);
      if (!pending) return;
      this.pending.delete(payload.taskId);
      pending.resolve({
        exitCode: payload.exitCode,
        stdout: payload.stdout,
        stderr: payload.stderr,
        startedAt: payload.startedAt,
        finishedAt: payload.finishedAt,
      });
    });

    this.gateway.on('task:fail', (connectorId: string, payload: TaskFailPayload) => {
      if (connectorId !== this.connectorId) return;
      const pending = this.pending.get(payload.taskId);
      if (!pending) return;
      this.pending.delete(payload.taskId);
      pending.reject(new Error(payload.error));
    });
  }
}
