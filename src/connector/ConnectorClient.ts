import { hostname } from 'node:os';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  questionReplyPayloadSchema,
  permissionReplyPayloadSchema,
} from '../protocol/connectorProtocol.js';
import type { ConnectorConfig } from './connectorConfig.js';
import type { LocalTaskExecutor } from './LocalTaskExecutor.js';
import type { AgentBridge } from './bridges/AgentBridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localPkgPath = resolve(__dirname, '../../package.json');

function readLocalVersion(): string | undefined {
  try {
    return JSON.parse(readFileSync(localPkgPath, 'utf-8')).version as string;
  } catch {
    return undefined;
  }
}

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
  private readonly localVersion = readLocalVersion();

  public constructor(
    private readonly config: ConnectorConfig,
    private readonly executor: LocalTaskExecutor,
    private readonly bridges: Map<string, AgentBridge> = new Map(),
  ) {
    this.reconnectDelay = config.reconnectIntervalMs;

    for (const bridge of this.bridges.values()) {
      bridge.setQuestionCallback((taskId, payload) => {
        this.send(createEnvelope(MSG.TASK_QUESTION, payload as unknown as Record<string, unknown>, taskId));
      });
      bridge.setPermissionCallback((taskId, payload) => {
        this.send(createEnvelope(MSG.TASK_PERMISSION, payload as unknown as Record<string, unknown>, taskId));
      });
    }
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
      const reasonStr = reason.toString();
      console.log(`Disconnected: ${code} ${reasonStr}`);
      this.clearHeartbeat();
      this.clearClientPing();

      // Don't reconnect if replaced by another connection — prevents reconnect loop
      // when multiple connector processes share the same connectorId.
      if (reasonStr === 'Replaced by new connection') {
        console.error('Another connector took over this connectorId. Shutting down to avoid reconnect loop.');
        console.error('If this is unexpected, check for duplicate connector processes: pgrep -af "connector/main.js"');
        this.stopped = true;
        return;
      }

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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
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
        version: this.localVersion ?? 'unknown',
        projects,
      }),
    );
  }

  private handleMessage(envelope: Envelope): void {
    console.log(`[ws-recv] type=${envelope.type} taskId=${envelope.taskId ?? 'none'}`);
    switch (envelope.type) {
      case MSG.REGISTERED:
        this.handleRegistered(envelope);
        break;
      case MSG.TASK_START:
        this.handleTaskStart(envelope);
        break;
      case MSG.TASK_CONTROL:
        this.handleTaskControl(envelope);
        break;
      case MSG.QUESTION_REPLY:
        this.handleQuestionReply(envelope);
        break;
      case MSG.PERMISSION_REPLY:
        this.handlePermissionReply(envelope);
        break;
      case MSG.SESSION_NEW:
        this.handleSessionNew();
        break;
      case MSG.UPGRADE_AVAILABLE:
        this.handleUpgradeAvailable(envelope);
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

  private handleRegistered(envelope: Envelope): void {
    const serverVersion = (envelope.payload as { serverVersion?: string }).serverVersion;
    console.log(`Registration accepted by server (version: ${serverVersion ?? 'unknown'})`);
    if (serverVersion && this.localVersion && serverVersion !== this.localVersion) {
      console.warn(`⚠️  Version mismatch: local=${this.localVersion} server=${serverVersion}. Run: petfish-connect.sh stop && petfish-connect.sh start`);
    }
    this.drainSendBuffer();
  }

  private handleSessionNew(): void {
    for (const bridge of this.bridges.values()) {
      void bridge.requestNewSession();
    }
  }

  private handleUpgradeAvailable(envelope: Envelope): void {
    const payload = envelope.payload as { version?: string; message?: string };
    console.warn(`⚠️  Upgrade available: ${payload.version ?? 'unknown'} — ${payload.message ?? 'Run petfish-connect.sh stop && petfish-connect.sh start to update'}`);
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
      console.log(`[task] completed taskId=${taskId} exitCode=${exitCode} stdout=${stdout.length}B`);
      this.send(createEnvelope(MSG.TASK_COMPLETE, { taskId, exitCode, stdout, stderr, startedAt, finishedAt }, taskId));
    };
    const onFail = (taskId: string, error: string) => {
      console.log(`[task] failed taskId=${taskId} error=${error}`);
      this.send(createEnvelope(MSG.TASK_FAIL, { taskId, error }, taskId));
    };

    const bridge = this.bridges.get(payload.projectId);
    if (bridge) {
      const instruction = payload.rawInstruction ?? payload.instruction;
      console.log(`[task] routing to ${bridge.agentType} bridge taskId=${payload.taskId} instruction=${instruction.slice(0, 60)}...`);
      this.send(createEnvelope(MSG.TASK_ACCEPTED, { taskId: payload.taskId }, payload.taskId));
      const ok = bridge.prompt(payload.taskId, instruction, onOutput, onComplete, onFail);
      if (!ok) {
        console.warn(`[task] ${bridge.agentType} bridge.prompt returned false for taskId=${payload.taskId}`);
      }
      return;
    }

    console.log(`[task] routing to LocalTaskExecutor taskId=${payload.taskId}`);
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

  private handleQuestionReply(envelope: Envelope): void {
    const result = questionReplyPayloadSchema.safeParse(envelope.payload);
    if (!result.success) return;
    const { questionId, answers } = result.data;
    console.log(`[task] question reply received questionId=${questionId}`);
    for (const bridge of this.bridges.values()) {
      bridge.answerQuestion(questionId, answers);
    }
  }

  private handlePermissionReply(envelope: Envelope): void {
    const result = permissionReplyPayloadSchema.safeParse(envelope.payload);
    if (!result.success) return;
    const { permissionId, allowed } = result.data;
    console.log(`[task] permission reply received permissionId=${permissionId} allowed=${allowed}`);
    for (const bridge of this.bridges.values()) {
      bridge.answerPermission(permissionId, allowed);
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
