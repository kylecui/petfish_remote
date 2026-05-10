import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

import { WebSocketServer, type WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../../package.json');
const SERVER_VERSION = JSON.parse(readFileSync(pkgPath, 'utf-8')).version as string;

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
  taskQuestionPayloadSchema,
  taskPermissionPayloadSchema,
  sessionListResponsePayloadSchema,
} from '../protocol/connectorProtocol.js';
import type { ConnectorAuth } from './ConnectorAuth.js';
import { type ConnectorInfo, ConnectorRegistry } from './ConnectorRegistry.js';
import type { RegistrationService, RegisterRequest, AddPlatformRequest } from './RegistrationService.js';

export interface GatewayOptions {
  port: number;
  path: string;
  pingIntervalMs: number;
  auth: ConnectorAuth;
  registrationService?: RegistrationService;
}

export class ConnectorGateway extends EventEmitter {
  private readonly httpServer: HttpServer;
  private readonly wss: WebSocketServer;
  public readonly registry = new ConnectorRegistry();
  private pingTimer: NodeJS.Timeout | undefined;
  private readonly lastPongAt = new Map<WebSocket, number>();
  private readonly STALE_TIMEOUT_MS = 90_000;
  private readonly pendingMessages = new Map<string, Envelope[]>();
  private readonly recentlySentIds = new Map<string, Set<string>>();
  private readonly adapterStatuses = new Map<string, string>();
  private readonly startedAt = Date.now();
  private projectListProvider?: () => Array<{ id: string; name: string; runtime: string; path: string; allowed_users: string[] }>;

  private staticHandler?: (url: string) => { contentType: string; body: string } | undefined;
  private readonly wsRoutes = new Map<string, WebSocketServer>();

  public constructor(private readonly options: GatewayOptions) {
    super();
    this.httpServer = createServer((req, res) => this.handleHttp(req, res));

    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
    this.wsRoutes.set(options.path, this.wss);

    this.httpServer.on('upgrade', (req, socket, head) => {
      const pathname = req.url?.split('?')[0];
      for (const [route, wss] of this.wsRoutes) {
        if (pathname === route) {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
          });
          return;
        }
      }
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
    });
  }

  public get server(): HttpServer {
    return this.httpServer;
  }

  public registerWsRoute(path: string, wss: WebSocketServer): void {
    this.wsRoutes.set(path, wss);
  }

  public setStaticHandler(handler: (url: string) => { contentType: string; body: string } | undefined): void {
    this.staticHandler = handler;
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'POST' && req.url === '/api/register') {
      this.handleRegisterApi(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/add-platform') {
      this.handleAddPlatformApi(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/webhook/card') {
      this.handleWebhookCard(req, res);
      return;
    }

    if (req.url === '/install' || req.url === '/install.sh') {
      this.handleInstallScript(req, res);
      return;
    }

    if (req.url === '/api/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: SERVER_VERSION }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/status') {
      this.handleStatusApi(req, res);
      return;
    }

    if (req.url && this.staticHandler) {
      const result = this.staticHandler(req.url);
      if (result) {
        res.writeHead(200, { 'Content-Type': result.contentType });
        res.end(result.body);
        return;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ service: 'petfish-remote-ws', version: SERVER_VERSION, connectors: this.registry.list().length }));
  }

  private cardActionHandler: ((payload: unknown) => unknown) | undefined;

  public setCardActionHandler(handler: (payload: unknown) => unknown): void {
    this.cardActionHandler = handler;
  }

  public setAdapterStatus(name: string, status: string): void {
    this.adapterStatuses.set(name, status);
  }

  public getDiagnostics(): { uptimeMs: number; adapters: Record<string, string>; connectors: ReturnType<ConnectorRegistry['list']>; pending: ReturnType<ConnectorRegistry['listPending']> } {
    return {
      uptimeMs: Date.now() - this.startedAt,
      adapters: Object.fromEntries(this.adapterStatuses),
      connectors: this.registry.list(),
      pending: this.registry.listPending(),
    };
  }

  public setProjectListProvider(fn: () => Array<{ id: string; name: string; runtime: string; path: string; allowed_users: string[] }>): void {
    this.projectListProvider = fn;
  }

  private handleWebhookCard(req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (payload.type === 'url_verification') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ challenge: payload.challenge }));
          return;
        }
        const eventData = payload.event ?? payload;
        console.log('[webhook/card] operator:', eventData.operator?.open_id, 'chat:', eventData.open_chat_id);
        const result = this.cardActionHandler?.(eventData) ?? {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
    });
  }

  private handleStatusApi(req: IncomingMessage, res: ServerResponse): void {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Status endpoint not configured (ADMIN_API_KEY not set)' }));
      return;
    }

    const providedKey = req.headers['x-admin-key'];
    if (providedKey !== adminKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const connectors = this.registry.list().map(({ ws: _, ...rest }) => rest);
    const pendingReconnects = this.registry.listPending();
    const registeredUsers = this.options.registrationService?.getRegisteredUsers() ?? [];

    const adapters: Record<string, string> = {};
    for (const [name, status] of this.adapterStatuses) {
      adapters[name] = status;
    }

    const body = {
      version: SERVER_VERSION,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      adapters,
      connectors,
      projects: this.projectListProvider?.() ?? [],
      registeredUsers,
      pendingReconnects,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body, null, 2));
  }

  private handleRegisterApi(req: IncomingMessage, res: ServerResponse): void {
    const registrationService = this.options.registrationService;
    if (!registrationService) {
      res.writeHead(501, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Registration not enabled' }));
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      let payload: RegisterRequest;
      try {
        payload = JSON.parse(body) as RegisterRequest;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      if (!payload.token || !payload.projectId || !payload.projectName || !payload.projectPath || !payload.hostname) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields: token, projectId, projectName, projectPath, hostname' }));
        return;
      }

      const result = registrationService.register(payload);

      if ('error' in result) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }

      // Dynamically add the connector token to auth so it can connect via WS
      this.options.auth.addWildcardToken(result.connectorToken);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
  }

  private handleAddPlatformApi(req: IncomingMessage, res: ServerResponse): void {
    const registrationService = this.options.registrationService;
    if (!registrationService) {
      res.writeHead(501, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Registration not enabled' }));
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      let payload: AddPlatformRequest;
      try {
        payload = JSON.parse(body) as AddPlatformRequest;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      if (!payload.registrationToken || !payload.connectorToken || !payload.projectId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields: registrationToken, connectorToken, projectId' }));
        return;
      }

      const result = registrationService.addPlatform(payload);

      if ('error' in result) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
  }

  private handleInstallScript(_req: IncomingMessage, res: ServerResponse): void {
    const scriptPath = resolve(__dirname, '../../scripts/install.sh');
    const fallbackUrl = 'https://raw.githubusercontent.com/kylecui/petfish_remote/main/scripts/install.sh';

    let script: string;
    try {
      script = readFileSync(scriptPath, 'utf-8');
    } catch {
      res.writeHead(302, { Location: fallbackUrl });
      res.end();
      return;
    }

    const serverUrl = process.env.PETFISH_SERVER_URL ?? 'https://remote.petfish.ai';
    script = script.replace('__PETFISH_SERVER_URL__', serverUrl);

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'inline; filename="install.sh"',
      'Cache-Control': 'no-cache',
    });
    res.end(script);
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

  public sendQuestionReply(connectorId: string, taskId: string, questionId: string, answers: string[][]): boolean {
    const envelope = createEnvelope(MSG.QUESTION_REPLY, { taskId, questionId, answers }, taskId);
    return this.sendToConnector(connectorId, envelope);
  }

  public sendPermissionReply(connectorId: string, taskId: string, permissionId: string, allowed: boolean): boolean {
    const envelope = createEnvelope(MSG.PERMISSION_REPLY, { taskId, permissionId, allowed }, taskId);
    return this.sendToConnector(connectorId, envelope);
  }

  public sendSessionListRequest(connectorId: string, projectId: string, requestId: string): boolean {
    const envelope = createEnvelope(MSG.SESSION_LIST, { projectId, requestId });
    return this.sendToConnector(connectorId, envelope);
  }

  public sendSessionSwitch(connectorId: string, projectId: string, sessionId: string): boolean {
    const envelope = createEnvelope(MSG.SESSION_SWITCH, { projectId, sessionId });
    return this.sendToConnector(connectorId, envelope);
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
          const isOneTimeToken = /^[0-9a-f]{32}$/.test(payload.token);
          const detail = isOneTimeToken
            ? 'Invalid connector credentials. It looks like you used a one-time setup token (from /start) instead of a connector token. Run the installer again with your /start token to register properly, or check that connector.yaml was generated correctly.'
            : 'Invalid connector credentials';
          this.sendError(ws, 'AUTH_FAILED', detail);
          ws.close(4003, 'Auth failed');
          return;
        }

        clearTimeout(authTimeout);
        authenticated = true;
        connectorId = payload.connectorId;

        const userId = this.options.registrationService?.resolveUserByToken(payload.token);
        if (!userId && this.options.registrationService) {
          this.sendError(ws, 'AUTH_FAILED', 'Token not associated with any user. Please re-register via /start.');
          ws.close(4003, 'No user for token');
          return;
        }

        const info: ConnectorInfo = {
          connectorId: payload.connectorId,
          hostname: payload.hostname,
          projects: payload.projects,
          connectedAt: new Date().toISOString(),
          ws,
          userId,
        };
        this.registry.register(info);
        this.emit('connector:change', connectorId, info);
        this.drainPendingMessages(connectorId!, info.ws);

        const ack = createEnvelope(MSG.REGISTERED, {
          connectorId: payload.connectorId,
          serverVersion: SERVER_VERSION,
        });
        ws.send(JSON.stringify(ack));

        if (payload.version && payload.version !== SERVER_VERSION) {
          const upgradeMsg = createEnvelope(MSG.UPGRADE_AVAILABLE, {
            version: SERVER_VERSION,
            currentVersion: payload.version,
            message: `Update available: ${payload.version} → ${SERVER_VERSION}. Run: petfish-connect.sh stop && petfish-connect.sh start`,
          });
          ws.send(JSON.stringify(upgradeMsg));
        }

        console.log(`Connector registered: ${connectorId} (${payload.hostname}, v${payload.version ?? '?'}, ${payload.projects.length} projects)`);
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
      case MSG.TASK_QUESTION: {
        const payload = taskQuestionPayloadSchema.safeParse(envelope.payload);
        if (payload.success) {
          this.emit('task:question', connectorId, payload.data);
        }
        break;
      }
      case MSG.TASK_PERMISSION: {
        const payload = taskPermissionPayloadSchema.safeParse(envelope.payload);
        if (payload.success) {
          this.emit('task:permission', connectorId, payload.data);
        }
        break;
      }
      case MSG.SESSION_LIST_RESPONSE: {
        const payload = sessionListResponsePayloadSchema.safeParse(envelope.payload);
        if (payload.success) {
          this.emit('session:list', connectorId, payload.data);
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

    let sent = 0;
    let skipped = 0;
    const seen = this.recentlySentIds.get(connectorId) ?? new Set<string>();

    for (const envelope of queue) {
      if (seen.has(envelope.id)) {
        skipped++;
        continue;
      }
      seen.add(envelope.id);
      ws.send(JSON.stringify(envelope));
      sent++;
    }

    this.recentlySentIds.set(connectorId, seen);
    this.pendingMessages.delete(connectorId);

    if (sent > 0 || skipped > 0) {
      console.log(`[gateway] Drained ${sent} messages for ${connectorId} (${skipped} deduped)`);
    }

    // Prevent unbounded growth: trim old IDs after drain (keep last 500)
    if (seen.size > 500) {
      const arr = [...seen];
      const trimmed = new Set(arr.slice(arr.length - 500));
      this.recentlySentIds.set(connectorId, trimmed);
    }
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
