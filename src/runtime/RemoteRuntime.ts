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
    private readonly connectorId: string | undefined,
    private readonly gateway: ConnectorGateway,
  ) {
    this.wireGatewayHandlers();
  }

  public async healthCheck(): Promise<RuntimeHealth> {
    const info = this.resolveConnector();
    return {
      ok: !!info,
      runtimeId: this.id,
      opencodeAvailable: !!info,
      message: info ? `Connected from ${info.hostname}` : `No connector available for runtime ${this.id}`,
    };
  }

  public async run(command: RuntimeCommand): Promise<RuntimeResult> {
    const taskId = command.taskId;
    if (!taskId) {
      return Promise.reject(new Error('RemoteRuntime requires command.taskId'));
    }

    const maxRetries = 3;
    const retryDelays = [5000, 10000, 15000];
    let resolvedConnectorId: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const info = this.resolveConnector(command.projectId);
      if (info) {
        resolvedConnectorId = info.connectorId;
        break;
      }
      if (attempt === maxRetries) {
        return Promise.reject(new Error(`No connector available for runtime ${this.id} (project: ${command.projectId ?? 'unknown'})`));
      }
      console.log(`[remote] No connector for runtime ${this.id}, retry ${attempt + 1}/${maxRetries} in ${retryDelays[attempt]}ms...`);
      await new Promise(r => setTimeout(r, retryDelays[attempt]));
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
        projectId: command.projectId ?? '',
        projectPath: command.cwd,
        instruction: command.instruction ?? command.command,
        rawInstruction: command.rawInstruction,
        mode: command.mode ?? 'read_only',
        timeoutSeconds: command.timeoutSeconds ?? 1800,
        env: command.env,
      };

      console.log(`[remote] Sending task.start to connector=${resolvedConnectorId} taskId=${taskId} instruction=${(command.instruction ?? command.command).slice(0, 80)}...`);
      const envelope = createEnvelope(MSG.TASK_START, payload as unknown as Record<string, unknown>, taskId);
      const sent = this.gateway.sendToConnector(resolvedConnectorId!, envelope);
      console.log(`[remote] sendToConnector result: ${sent}`);
      if (!sent) {
        this.pending.delete(taskId);
        reject(new Error(`Failed to send task to connector ${resolvedConnectorId}`));
      }
    });
  }

  public async stop(taskId: string): Promise<void> {
    const envelope = createEnvelope(MSG.TASK_CONTROL, { taskId, action: 'cancel' }, taskId);
    const connectorId = this.connectorId ?? this.resolveConnector()?.connectorId;
    if (connectorId) this.gateway.sendToConnector(connectorId, envelope);
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

  private resolveConnector(projectId?: string): { connectorId: string; hostname: string } | undefined {
    if (this.connectorId) {
      const info = this.gateway.registry.get(this.connectorId);
      if (info) return info;
    }
    if (projectId) {
      const info = this.gateway.registry.findByProject(projectId);
      if (info) return info;
    }
    return undefined;
  }

  private wireGatewayHandlers(): void {
    this.gateway.on('task:output', (_connectorId: string, payload: TaskOutputPayload) => {
      const pending = this.pending.get(payload.taskId);
      if (!pending) return;
      if (payload.stream === 'stdout') {
        pending.stdout += payload.chunk;
      } else {
        pending.stderr += payload.chunk;
      }
      pending.command.onOutput?.(payload.chunk, payload.stream);
    });

    this.gateway.on('task:complete', (_connectorId: string, payload: TaskCompletePayload) => {
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

    this.gateway.on('task:fail', (_connectorId: string, payload: TaskFailPayload) => {
      const pending = this.pending.get(payload.taskId);
      if (!pending) return;
      this.pending.delete(payload.taskId);
      pending.reject(new Error(payload.error));
    });

    this.gateway.on('connector:change', (_connectorId: string, info: unknown) => {
      if (info) return;
      for (const [taskId, pending] of this.pending.entries()) {
        const projectId = pending.command.projectId;
        if (projectId && !this.gateway.registry.findByProject(projectId)) {
          this.pending.delete(taskId);
          pending.reject(new Error(`Connector disconnected (was serving project ${projectId})`));
        }
      }
    });
  }
}
