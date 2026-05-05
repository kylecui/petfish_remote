import { hostname } from 'node:os';

import WebSocket from 'ws';

import {
  type Envelope,
  type TaskStartPayload,
  type TaskControlPayload,
  MSG,
  createEnvelope,
  parseEnvelope,
  taskStartPayloadSchema,
  taskControlPayloadSchema,
} from '../protocol/connectorProtocol.js';
import type { ConnectorConfig } from './connectorConfig.js';
import type { LocalTaskExecutor } from './LocalTaskExecutor.js';
import type { SessionBridge } from './SessionBridge.js';

export class ConnectorClient {
  private ws: WebSocket | undefined;
  private reconnectDelay: number;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private pingTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private readonly heartbeatTimeoutMs = 30_000;
  private readonly clientPingIntervalMs = 15_000;
  private readonly sendBuffer: string[] = [];
  private readonly maxBufferSize = 200;

  public constructor(
    private readonly config: ConnectorConfig,
    private readonly executor: LocalTaskExecutor,
    private readonly sessionBridge?: SessionBridge,
  ) {
    this.reconnectDelay = config.reconnectIntervalMs;
  }

  public start(): void {
    this.stopped = false;
    this.connect();
  }

  public stop(): void {
    this.stopped = true;
    this.clearHeartbeat();
    this.clearClientPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client stopping');
      this.ws = undefined;
    }
  }

  private connect(): void {
    if (this.stopped) return;

    console.log(`Connecting to ${this.config.serverUrl}...`);
    this.ws = new WebSocket(this.config.serverUrl);

    this.ws.on('open', () => {
      console.log('Connected, sending registration...');
      this.reconnectDelay = this.config.reconnectIntervalMs;
      this.resetHeartbeat();
      this.startClientPing();
      this.sendRegister();
    });

    this.ws.on('message', (data) => {
      this.resetHeartbeat();
      let envelope: Envelope;
      try {
        envelope = parseEnvelope(data.toString());
      } catch {
        console.error('Failed to parse server message');
        return;
      }
      this.handleMessage(envelope);
    });

    this.ws.on('close', (code, reason) => {
      console.log(`Disconnected: ${code} ${reason.toString()}`);
      this.clearHeartbeat();
      this.clearClientPing();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error(`WebSocket error: ${err.message}`);
    });

    this.ws.on('ping', () => {
      this.resetHeartbeat();
      this.ws?.pong();
    });

    this.ws.on('pong', () => {
      this.resetHeartbeat();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    console.log(`Reconnecting in ${this.reconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.config.maxReconnectIntervalMs);
      this.connect();
    }, this.reconnectDelay);
  }

  private sendRegister(): void {
    const projects = this.config.projects.map((p) => ({
      id: p.id,
      path: p.path,
      opencodeAvailable: true,
    }));

    this.send(
      createEnvelope(MSG.REGISTER, {
        connectorId: this.config.connectorId,
        token: this.config.token,
        hostname: hostname(),
        projects,
      }),
    );
  }

  private handleMessage(envelope: Envelope): void {
    console.log(`[ws-recv] type=${envelope.type} taskId=${envelope.taskId ?? 'none'}`);
    switch (envelope.type) {
      case MSG.REGISTERED:
        console.log('Registration accepted by server');
        this.drainSendBuffer();
        break;
      case MSG.TASK_START:
        this.handleTaskStart(envelope);
        break;
      case MSG.TASK_CONTROL:
        this.handleTaskControl(envelope);
        break;
      case MSG.ERROR:
        console.error('Server error:', envelope.payload);
        break;
      case MSG.PING:
        this.send(createEnvelope(MSG.PONG, {}));
        break;
      default:
        console.warn(`Unknown message type: ${envelope.type}`);
    }
  }

  private handleTaskStart(envelope: Envelope): void {
    let payload: TaskStartPayload;
    try {
      payload = taskStartPayloadSchema.parse(envelope.payload);
    } catch {
      this.send(createEnvelope(MSG.TASK_REJECTED, { taskId: envelope.taskId ?? 'unknown', reason: 'Invalid task payload' }, envelope.taskId));
      return;
    }

    const onOutput = (taskId: string, stream: 'stdout' | 'stderr', chunk: string) => {
      this.send(createEnvelope(MSG.TASK_OUTPUT, { taskId, stream, chunk }, taskId));
    };
    const onComplete = (taskId: string, exitCode: number, stdout: string, stderr: string, startedAt: string, finishedAt: string) => {
      this.send(createEnvelope(MSG.TASK_COMPLETE, { taskId, exitCode, stdout, stderr, startedAt, finishedAt }, taskId));
    };
    const onFail = (taskId: string, error: string) => {
      this.send(createEnvelope(MSG.TASK_FAIL, { taskId, error }, taskId));
    };

    if (this.sessionBridge) {
      this.send(createEnvelope(MSG.TASK_ACCEPTED, { taskId: payload.taskId }, payload.taskId));
      const instruction = payload.rawInstruction ?? payload.instruction;
      this.sessionBridge.prompt(payload.taskId, instruction, onOutput, onComplete, onFail);
      return;
    }

    const accepted = this.executor.execute(
      payload.taskId,
      payload.projectId,
      payload.instruction,
      payload.mode,
      payload.timeoutSeconds,
      onOutput,
      onComplete,
      onFail,
    );

    if (accepted) {
      this.send(createEnvelope(MSG.TASK_ACCEPTED, { taskId: payload.taskId }, payload.taskId));
    }
  }

  private handleTaskControl(envelope: Envelope): void {
    let payload: TaskControlPayload;
    try {
      payload = taskControlPayloadSchema.parse(envelope.payload);
    } catch {
      return;
    }

    if (payload.action === 'cancel') {
      this.executor.cancel(payload.taskId);
    }
  }

  private send(envelope: Envelope): void {
    const data = JSON.stringify(envelope);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      // Buffer non-register messages for re-send after reconnect
      if (envelope.type !== MSG.REGISTER) {
        if (this.sendBuffer.length < this.maxBufferSize) {
          this.sendBuffer.push(data);
        } else {
          console.warn(`Send buffer full (${this.maxBufferSize}), dropping message type=${envelope.type}`);
        }
      }
    }
  }

  private drainSendBuffer(): void {
    if (this.sendBuffer.length === 0) return;
    console.log(`Draining ${this.sendBuffer.length} buffered messages...`);
    while (this.sendBuffer.length > 0) {
      const data = this.sendBuffer.shift()!;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(data);
      } else {
        // Connection lost again during drain, put it back
        this.sendBuffer.unshift(data);
        break;
      }
    }
  }

  private resetHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      console.log('Heartbeat timeout — no activity, reconnecting...');
      this.ws?.terminate();
    }, this.heartbeatTimeoutMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private startClientPing(): void {
    this.clearClientPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.clientPingIntervalMs);
  }

  private clearClientPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }
}
