import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import type { ChatResponse, UserRole } from '../../types.js';
import { hasMinimumRole } from '../../types.js';
import type { TaskQuestionPayload, TaskPermissionPayload } from '../../protocol/connectorProtocol.js';
import { BaseIMAdapter } from '../types.js';
import type { AdapterDeps, OutboundInteraction } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WebConfig {
  apiKey: string;
  httpServer: import('node:http').Server;
  wsPath?: string;
  registerWsRoute?: (path: string, wss: import('ws').WebSocketServer) => void;
}

interface WebClient {
  ws: WebSocket;
  chatId: string;
  userId: string;
  authenticated: boolean;
}

interface WsInbound {
  type: string;
  text?: string;
  questionId?: string;
  answers?: string[][];
  permissionId?: string;
  allowed?: boolean;
}

export class WebAdapter extends BaseIMAdapter {
  readonly platform = 'web' as const;

  private wss: WebSocketServer | undefined;
  private readonly clients = new Map<WebSocket, WebClient>();
  private readonly chatIdToWs = new Map<string, WebSocket>();
  private readonly pendingInteractions = new Map<string, string>();
  private readonly apiKey: string;
  private readonly httpServer: import('node:http').Server;
  private readonly wsPath: string;
  private readonly registerWsRoute?: (path: string, wss: import('ws').WebSocketServer) => void;

  public constructor(config: WebConfig, readonly deps?: AdapterDeps) {
    super();
    this.apiKey = config.apiKey;
    this.httpServer = config.httpServer;
    this.wsPath = config.wsPath ?? '/ws/web';
    this.registerWsRoute = config.registerWsRoute;
  }

  public async start(): Promise<void> {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    if (this.registerWsRoute) {
      this.registerWsRoute(this.wsPath, this.wss);
    } else {
      this.httpServer.on('upgrade', (req, socket, head) => {
        const pathname = req.url?.split('?')[0];
        if (pathname !== this.wsPath) return;
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.wss!.emit('connection', ws, req);
        });
      });
    }

    console.log(`[web] WebSocket server listening on path ${this.wsPath}`);
  }

  public async stop(): Promise<void> {
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close(1001, 'Server shutting down');
      }
      this.wss.close();
    }
    this.clients.clear();
    this.chatIdToWs.clear();
    console.log('[web] Adapter stopped');
  }

  public async sendMessage(response: ChatResponse): Promise<void> {
    if (response.platform !== 'web') return;
    const ws = this.chatIdToWs.get(response.chat_id);
    if (!ws || ws.readyState !== ws.OPEN) return;
    this.wsSend(ws, { type: 'message', text: response.text });
  }

  public async sendTyping(chatId: string): Promise<void> {
    const ws = this.chatIdToWs.get(chatId);
    if (!ws || ws.readyState !== ws.OPEN) return;
    this.wsSend(ws, { type: 'typing' });
  }

  public async sendInteraction(request: OutboundInteraction): Promise<void> {
    switch (request.type) {
      case 'question':
        return this.sendQuestion(request.chatId, request.payload);
      case 'permission':
        return this.sendPermission(request.chatId, request.payload);
    }
  }

  public hasPendingInteraction(chatId: string): boolean {
    return this.pendingInteractions.has(chatId);
  }

  public clearPendingInteraction(chatId: string): void {
    this.pendingInteractions.delete(chatId);
  }

  public serveStaticFile(url: string): { contentType: string; body: string } | undefined {
    const prefix = '/web/';
    if (!url.startsWith(prefix) && url !== '/web') return undefined;

    let filePath = url === '/web' || url === '/web/' ? 'index.html' : url.slice(prefix.length);
    if (filePath.includes('..') || filePath.includes('\0')) return undefined;
    if (!filePath) filePath = 'index.html';

    const ext = filePath.split('.').pop() ?? '';
    const mimeMap: Record<string, string> = {
      html: 'text/html; charset=utf-8',
      css: 'text/css; charset=utf-8',
      js: 'application/javascript; charset=utf-8',
      svg: 'image/svg+xml',
      png: 'image/png',
      ico: 'image/x-icon',
    };

    const contentType = mimeMap[ext] ?? 'application/octet-stream';
    const absolutePath = resolve(__dirname, 'static', filePath);

    try {
      const body = readFileSync(absolutePath, 'utf-8');
      return { contentType, body };
    } catch {
      return undefined;
    }
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '', 'http://localhost');
    const key = url.searchParams.get('key');

    if (key !== this.apiKey) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const chatId = `web:${randomUUID().slice(0, 8)}`;
    const userId = 'web:user';

    const client: WebClient = { ws, chatId, userId, authenticated: true };
    this.clients.set(ws, client);
    this.chatIdToWs.set(chatId, ws);

    console.log(`[web] Client connected: ${chatId}`);

    this.wsSend(ws, {
      type: 'connected',
      chatId,
      projects: (this.deps?.listProjects(userId) ?? []).map(p => ({ id: p.id, name: p.name })),
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WsInbound;
        this.handleClientMessage(client, msg);
      } catch (err) {
        console.error('[web] Failed to parse client message:', err);
      }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      this.chatIdToWs.delete(chatId);
      this.pendingInteractions.delete(chatId);
      console.log(`[web] Client disconnected: ${chatId}`);
    });

    ws.on('error', (err) => {
      console.error(`[web] WebSocket error for ${chatId}:`, err);
    });
  }

  private handleClientMessage(client: WebClient, msg: WsInbound): void {
    const { chatId, userId } = client;

    switch (msg.type) {
      case 'message': {
        const text = msg.text?.trim();
        if (!text) return;

        if (text === '/start') {
          this.sendWelcome(client);
          return;
        }

        if (text === '/pf' || text === '/menu') {
          this.sendMenuPayload(client);
          return;
        }

        if (text === '/pf list') {
          this.sendProjectList(client);
          return;
        }

        if (text === '/pf sessions') {
          void this.sendSessionList(client);
          return;
        }

        this.emit({
          type: 'message',
          event: {
            platform: 'web',
            chat_id: chatId,
            user_id: userId,
            username: '',
            message_id: randomUUID(),
            text,
            attachments: [],
            timestamp: new Date().toISOString(),
          },
        });
        break;
      }

      case 'command': {
        const text = msg.text?.trim();
        if (!text) return;
        this.emit({
          type: 'message',
          event: {
            platform: 'web',
            chat_id: chatId,
            user_id: userId,
            username: '',
            message_id: '',
            text,
            attachments: [],
            timestamp: new Date().toISOString(),
          },
        });
        break;
      }

      case 'questionReply': {
        if (msg.questionId && msg.answers) {
          this.pendingInteractions.delete(chatId);
          this.emit({
            type: 'questionReply',
            event: { questionId: msg.questionId, answers: msg.answers },
          });
        }
        break;
      }

      case 'permissionReply': {
        if (msg.permissionId != null) {
          this.pendingInteractions.delete(chatId);
          this.emit({
            type: 'permissionReply',
            event: { permissionId: msg.permissionId, allowed: !!msg.allowed },
          });
        }
        break;
      }
    }
  }

  private sendWelcome(client: WebClient): void {
    this.wsSend(client.ws, {
      type: 'welcome',
      text: '><(((^> PetFish Remote — Web Console\n\nConnected. Send a message to start.',
    });
  }

  private sendMenuPayload(client: WebClient): void {
    const binding = this.deps?.getBinding('web', client.chatId);
    const role: UserRole = this.deps?.getUserRole?.(client.userId) ?? 'viewer';

    const groups: { label: string; commands: { id: string; label: string }[] }[] = [
      {
        label: 'Project & Session',
        commands: [
          { id: 'list', label: '📋 Projects' },
          { id: 'sessions', label: '📂 Sessions' },
          { id: 'where', label: '📍 Where' },
        ],
      },
      {
        label: 'Task Control',
        commands: [
          { id: 'new', label: '🔄 New' },
          { id: 'status', label: '📊 Status' },
          { id: 'stop', label: '🛑 Stop' },
        ],
      },
      {
        label: 'Development',
        commands: [
          { id: 'diff', label: '📝 Diff' },
          { id: 'commit', label: '✅ Commit' },
          { id: 'pr', label: '🚀 PR' },
          { id: 'test', label: '🧪 Test' },
        ],
      },
    ];

    if (hasMinimumRole(role, 'admin')) {
      groups.push({
        label: 'Admin',
        commands: [
          { id: 'users', label: '👥 Users' },
          { id: 'audit', label: '📊 Audit' },
          { id: 'doctor', label: '🩺 Doctor' },
        ],
      });
    }

    groups.push({
      label: '',
      commands: [{ id: 'help', label: '❓ Help' }],
    });

    this.wsSend(client.ws, {
      type: 'menu',
      bound: binding?.project_id ?? null,
      role,
      groups,
      commands: groups.flatMap(g => g.commands),
    });
  }

  private sendProjectList(client: WebClient): void {
    const projects = this.deps?.listProjects(client.userId) ?? [];
    const binding = this.deps?.getBinding('web', client.chatId);
    this.wsSend(client.ws, {
      type: 'projectList',
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        active: binding?.project_id === p.id,
      })),
    });
  }

  private async sendSessionList(client: WebClient): Promise<void> {
    const sessions = await this.deps?.listSessions?.('web', client.chatId);
    this.wsSend(client.ws, {
      type: 'sessionList',
      sessions: (sessions ?? []).map(s => ({
        slug: s.slug,
        title: s.title,
        active: s.active,
      })),
    });
  }

  private sendQuestion(chatId: string, payload: TaskQuestionPayload): void {
    const ws = this.chatIdToWs.get(chatId);
    if (!ws || ws.readyState !== ws.OPEN) return;
    this.pendingInteractions.set(chatId, payload.questionId);
    this.wsSend(ws, { type: 'question', payload });
  }

  private sendPermission(chatId: string, payload: TaskPermissionPayload): void {
    const ws = this.chatIdToWs.get(chatId);
    if (!ws || ws.readyState !== ws.OPEN) return;
    this.pendingInteractions.set(chatId, payload.permissionId);
    this.wsSend(ws, { type: 'permission', payload });
  }

  private wsSend(ws: WebSocket, data: unknown): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(data));
  }
}
