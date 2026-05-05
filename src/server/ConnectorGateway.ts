import { createServer, type Server as HttpServer } from 'node:http';
import { EventEmitter } from 'node:events';

import { WebSocketServer, type WebSocket } from 'ws';

import {
  type Envelope,
  type RegisterPayload,
  MSG,
  createEnvelope,
  parseEnvelope,
  registerPayloadSchema,
  taskCompletePayloadSchema,
  taskFailPayloadSchema,
  taskOutputPayloadSchema,
} from '../protocol/connectorProtocol.js';
import type { ConnectorAuth } from './ConnectorAuth.js';
import { type ConnectorInfo, ConnectorRegistry } from './ConnectorRegistry.js';

export interface GatewayOptions {
  port: number;
  path: string;
  pingIntervalMs: number;
  auth: ConnectorAuth;
}

export class ConnectorGateway extends EventEmitter {
  private readonly httpServer: HttpServer;
  private readonly wss: WebSocketServer;
  public readonly registry = new ConnectorRegistry();
  private pingTimer: NodeJS.Timeout | undefined;
  private readonly lastPongAt = new Map<WebSocket, number>();
  private readonly STALE_TIMEOUT_MS = 30_000;
  private readonly pendingMessages = new Map<string, Envelope[]>();

  public constructor(private readonly options: GatewayOptions) {
    super();
    this.httpServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ service: 'petfish-remote-ws', connectors: this.registry.list().length }));
    });

    this.wss = new WebSocketServer({ server: this.httpServer, path: options.path });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.options.port, () => {
        console.log(`ConnectorGateway listening on :${this.options.port}${this.options.path}`);
        this.startPingLoop();
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }
    for (const client of this.wss.clients) {
      client.close(1001, 'Server shutting down');
    }
    return new Promise((resolve, reject) => {
      this.wss.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        this.httpServer.close((httpErr) => {
          if (httpErr) {
            reject(httpErr);
            return;
          }
          resolve();
        });
      });
    });
  }

  public sendToConnector(connectorId: string, envelope: Envelope): boolean {
    const info = this.registry.get(connectorId);
    if (info && info.ws.readyState === 1) {
      info.ws.send(JSON.stringify(envelope));
      return true;
    }

    if (this.registry.isReconnecting(connectorId)) {
      const queue = this.pendingMessages.get(connectorId) ?? [];
      queue.push(envelope);
      this.pendingMessages.set(connectorId, queue);
      console.log(`[gateway] Queued message for reconnecting connector ${connectorId} (queue size: ${queue.length})`);
      return true;
    }

    return false;
  }

  private handleConnection(ws: WebSocket): void {
    let authenticated = false;
    let connectorId: string | undefined;

    this.lastPongAt.set(ws, Date.now());

    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.close(4001, 'Authentication timeout');
      }
    }, 10_000);

    ws.on('message', (data) => {
      let envelope: Envelope;
      try {
        envelope = parseEnvelope(data.toString());
      } catch {
        this.sendError(ws, 'PARSE_ERROR', 'Invalid message format');
        return;
      }

      if (!authenticated) {
        if (envelope.type !== MSG.REGISTER) {
          this.sendError(ws, 'AUTH_REQUIRED', 'Must register first');
          ws.close(4001, 'Not authenticated');
          return;
        }

        let payload: RegisterPayload;
        try {
          payload = registerPayloadSchema.parse(envelope.payload);
        } catch {
          this.sendError(ws, 'INVALID_PAYLOAD', 'Invalid register payload');
          ws.close(4002, 'Invalid register');
          return;
        }

        if (!this.options.auth.verify(payload.connectorId, payload.token)) {
          this.sendError(ws, 'AUTH_FAILED', 'Invalid connector credentials');
          ws.close(4003, 'Auth failed');
          return;
        }

        clearTimeout(authTimeout);
        authenticated = true;
        connectorId = payload.connectorId;

        const info: ConnectorInfo = {
          connectorId: payload.connectorId,
          hostname: payload.hostname,
          projects: payload.projects,
          connectedAt: new Date().toISOString(),
          ws,
        };
        this.registry.register(info);
        this.emit('connector:change', connectorId, info);
        this.drainPendingMessages(connectorId!, info.ws);

        const ack = createEnvelope(MSG.REGISTERED, {
          connectorId: payload.connectorId,
          serverVersion: '0.1.0',
        });
        ws.send(JSON.stringify(ack));

        console.log(`Connector registered: ${connectorId} (${payload.hostname}, ${payload.projects.length} projects)`);
        return;
      }

      this.handleAuthenticatedMessage(connectorId!, envelope);
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      this.lastPongAt.delete(ws);
      if (connectorId) {
        const current = this.registry.get(connectorId);
        if (current && current.ws === ws) {
          console.log(`Connector ${connectorId} disconnected, starting 60s grace window`);
          this.registry.startGraceWindow(connectorId, () => {
            this.pendingMessages.delete(connectorId!);
            this.emit('connector:change', connectorId, undefined);
          });
        }
      }
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error${connectorId ? ` (${connectorId})` : ''}:`, err.message);
    });

    ws.on('pong', () => {
      this.lastPongAt.set(ws, Date.now());
    });
  }

  private handleAuthenticatedMessage(connectorId: string, envelope: Envelope): void {
    switch (envelope.type) {
      case MSG.TASK_OUTPUT: {
        const payload = taskOutputPayloadSchema.safeParse(envelope.payload);
        if (payload.success) {
          this.emit('task:output', connectorId, payload.data);
        }
        break;
      }
      case MSG.TASK_COMPLETE: {
        const payload = taskCompletePayloadSchema.safeParse(envelope.payload);
        if (payload.success) {
          this.emit('task:complete', connectorId, payload.data);
        }
        break;
      }
      case MSG.TASK_FAIL: {
        const payload = taskFailPayloadSchema.safeParse(envelope.payload);
        if (payload.success) {
          this.emit('task:fail', connectorId, payload.data);
        }
        break;
      }
      case MSG.PONG:
      case MSG.TASK_ACCEPTED:
      case MSG.TASK_REJECTED:
      case MSG.TASK_STATE:
      case MSG.RESUME_RUNNING:
        break;
      default:
        console.warn(`Unknown message type from ${connectorId}: ${envelope.type}`);
    }
  }

  private drainPendingMessages(connectorId: string, ws: WebSocket): void {
    const queue = this.pendingMessages.get(connectorId);
    if (!queue || queue.length === 0) return;
    console.log(`[gateway] Draining ${queue.length} queued messages for ${connectorId}`);
    for (const envelope of queue) {
      ws.send(JSON.stringify(envelope));
    }
    this.pendingMessages.delete(connectorId);
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    const envelope = createEnvelope(MSG.ERROR, { code, message });
    ws.send(JSON.stringify(envelope));
  }

  private startPingLoop(): void {
    this.pingTimer = setInterval(() => {
      const now = Date.now();
      for (const client of this.wss.clients) {
        if (client.readyState !== 1) continue;

        const lastSeen = this.lastPongAt.get(client) ?? now;
        if (now - lastSeen > this.STALE_TIMEOUT_MS) {
          console.log(`Terminating stale WebSocket (no pong for ${now - lastSeen}ms)`);
          client.terminate(); // force-kill — guarantees 'close' event fires
          this.lastPongAt.delete(client);
          continue;
        }

        client.ping();
      }
    }, this.options.pingIntervalMs);
  }
}
