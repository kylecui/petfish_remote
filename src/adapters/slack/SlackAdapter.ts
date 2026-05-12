import { App, LogLevel } from '@slack/bolt';
import type { ButtonAction } from '@slack/bolt';
import type { GenericMessageEvent } from '@slack/types';
import type { KnownBlock } from '@slack/types';

import type { ChatResponse, UserRole } from '../../types.js';
import { hasMinimumRole } from '../../types.js';
import type { TaskQuestionPayload, TaskPermissionPayload } from '../../protocol/connectorProtocol.js';
import { BaseIMAdapter } from '../types.js';
import type { AdapterDeps, OutboundInteraction } from '../types.js';

export interface SlackConfig {
  botToken: string;
  appToken: string;
}

export class SlackAdapter extends BaseIMAdapter {
  readonly platform = 'slack' as const;

  private app: App;
  private readonly pendingInteractions = new Map<string, string>();
  private readonly recentMessageIds = new Set<string>();
  private readonly DEDUP_CACHE_SIZE = 200;
  private readonly dedupQueue: string[] = [];
  private readonly userChatMap = new Map<string, string>();

  public constructor(config: SlackConfig, readonly deps?: AdapterDeps) {
    super();
    this.app = new App({
      token: config.botToken,
      socketMode: true,
      appToken: config.appToken,
      logLevel: LogLevel.INFO,
    });
    this.registerHandlers();
  }

  public async start(): Promise<void> {
    this.loadUserChatMap();
    await this.app.start();
    console.log('[slack] Socket Mode connected');
  }

  public async stop(): Promise<void> {
    await this.app.stop();
    console.log('[slack] App stopped');
  }

  public async sendMessage(response: ChatResponse): Promise<void> {
    if (response.platform !== 'slack') {
      throw new Error(`Unsupported platform for Slack adapter: ${response.platform}`);
    }
    try {
      await this.app.client.chat.postMessage({
        channel: response.chat_id,
        text: response.text,
        mrkdwn: true,
      });
    } catch (err) {
      console.error(`[slack] sendMessage error for channel=${response.chat_id}:`, err);
      throw err;
    }
  }

  public async sendTyping(_chatId: string): Promise<void> {
    void _chatId;
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

  private registerHandlers(): void {
    this.app.message(async ({ message }) => {
      const msg = message as GenericMessageEvent;
      if (msg.subtype || msg.bot_id) return;
      this.handleMessage(msg);
    });

    this.app.action(/^pf_(.+)$/, async ({ ack, action, body }) => {
      await ack();
      if (action.type !== 'button') return;
      const actionId = (action as ButtonAction).action_id;
      const userId = body.user.id;
      const channel = ('channel' in body && body.channel) ? (body.channel as { id: string }).id : '';
      if (!channel) return;
      this.handleAction(actionId, userId, channel);
    });

    this.app.command('/pf', async ({ command, ack }) => {
      await ack();
      const text = command.text.trim();
      const chatId = command.channel_id;
      const userId = command.user_id;
      this.cacheUserChat(userId, chatId);

      if (!text || text === 'menu') {
        void this.sendMenuCard(chatId, userId);
      } else if (text === 'list') {
        void this.sendProjectListCard(chatId, userId);
      } else if (text === 'sessions') {
        void this.sendSessionListCard(chatId, userId);
      } else if (text === 'start') {
        void this.sendStartCard(chatId, userId);
      } else {
        this.emitSyntheticCommand(chatId, userId, `/pf ${text}`);
      }
    });
  }

  private handleMessage(msg: GenericMessageEvent): void {
    const messageId = msg.ts ?? '';
    if (this.isDuplicate(messageId)) return;

    const chatId = msg.channel;
    const userId = msg.user ?? '';
    const text = msg.text ?? '';
    if (!text || !chatId) return;

    this.cacheUserChat(userId, chatId);

    console.log(`[slack] Message received: channel=${chatId} user=${userId} ts=${messageId} text=${JSON.stringify(text)}`);

    if (text.trim() === '/start') {
      void this.sendStartCard(chatId, userId);
      return;
    }

    if (text.trim() === '/pf' || text.trim() === '/menu') {
      void this.sendMenuCard(chatId, userId);
      return;
    }

    if (text.trim() === '/pf list') {
      void this.sendProjectListCard(chatId, userId);
      return;
    }

    if (text.trim() === '/pf sessions') {
      void this.sendSessionListCard(chatId, userId);
      return;
    }

    this.emit({
      type: 'message',
      event: {
        platform: 'slack',
        chat_id: chatId,
        user_id: userId,
        username: '',
        message_id: messageId,
        text,
        attachments: [],
        timestamp: new Date().toISOString(),
      },
    });
  }

  private handleAction(actionId: string, userId: string, chatId: string): void {
    this.cacheUserChat(userId, chatId);

    if (actionId.startsWith('pf_q:')) {
      const parts = actionId.split(':');
      const questionId = parts[1] ?? '';
      const answer = parts.slice(4).join(':');
      this.pendingInteractions.delete(chatId);
      this.emit({
        type: 'questionReply',
        event: { questionId, answers: [[answer]] },
      });
      return;
    }

    if (actionId.startsWith('pf_perm:')) {
      const parts = actionId.split(':');
      const permissionId = parts[1] ?? '';
      const allowed = parts[2] === 'allow';
      this.pendingInteractions.delete(chatId);
      this.emit({
        type: 'permissionReply',
        event: { permissionId, allowed },
      });
      return;
    }

    if (actionId.startsWith('pf_menu:')) {
      const command = actionId.slice(8);
      if (command === 'list') {
        void this.sendProjectListCard(chatId, userId);
      } else if (command === 'sessions') {
        void this.sendSessionListCard(chatId, userId);
      } else if (command.startsWith('use:')) {
        const projectId = command.slice(4);
        this.emitSyntheticCommand(chatId, userId, `/pf use ${projectId}`);
      } else if (command.startsWith('switch:')) {
        const slug = command.slice(7);
        this.emitSyntheticCommand(chatId, userId, `/pf switch ${slug}`);
      } else if (command) {
        this.emitSyntheticCommand(chatId, userId, `/pf ${command}`);
      }
      return;
    }
  }

  private emitSyntheticCommand(chatId: string, userId: string, text: string): void {
    this.emit({
      type: 'message',
      event: {
        platform: 'slack',
        chat_id: chatId,
        user_id: userId,
        username: '',
        message_id: '',
        text,
        attachments: [],
        timestamp: new Date().toISOString(),
      },
    });
  }

  private async sendStartCard(chatId: string, userId: string): Promise<void> {
    const fullUserId = `slack:${userId}`;
    const serverUrl = process.env.PETFISH_SERVER_URL ?? 'https://remote.petfish.ai';

    const docsBase = serverUrl.replace(/\/$/, '');
    let tokenSection: string;
    if (this.deps?.generateRegistrationToken) {
      const token = this.deps.generateRegistrationToken(fullUserId);
      tokenSection =
        `📋 *Copy one of these to your AI coding assistant:*\n\n` +
        `🆕 *New install:*\nInstall PetFish Remote connector by following ${docsBase}/docs/agent-install — use setup token: \`${token}\`\n\n` +
        `⬆️ *Already installed? Upgrade:*\nUpgrade PetFish Remote connector by following ${docsBase}/docs/agent-upgrade\n\n` +
        `_Token expires in 5 minutes._`;
    } else {
      tokenSection = 'Use the control panel to get started.';
    }

    const blocks = [
      { type: 'section' as const, text: { type: 'mrkdwn' as const, text: `*><(((^> PetFish Remote — 胖鱼遥控器*\n\nControl your opencode sessions from Slack.\n\n${tokenSection}` } },
      { type: 'actions' as const, elements: [this.menuButton('🎛️ Control Panel', 'menu')] },
    ];

    try {
      await this.app.client.chat.postMessage({ channel: chatId, text: 'PetFish Remote', blocks });
    } catch (err) {
      console.error('[slack] sendStartCard error:', err);
    }
  }

  private async sendMenuCard(chatId: string, userId?: string): Promise<void> {
    const binding = this.deps?.getBinding('slack', chatId);
    const boundText = binding
      ? `Bound to: *${binding.project_id}*\nSend any message to ask.`
      : 'No project bound yet. Tap Projects to start.';

    const fullUserId = userId ? `slack:${userId}` : undefined;
    const role: UserRole = fullUserId
      ? (this.deps?.getUserRole?.(fullUserId) ?? 'viewer')
      : 'viewer';

    const blocks = [
      { type: 'section' as const, text: { type: 'mrkdwn' as const, text: `*><(((^> PetFish Remote*\n\n${boundText}` } },
      { type: 'actions' as const, elements: [
        this.menuButton('📋 Projects', 'list'),
        this.menuButton('📂 Sessions', 'sessions'),
        this.menuButton('📍 Where', 'where'),
      ] },
      { type: 'actions' as const, elements: [
        this.menuButton('🔄 New', 'new'),
        this.menuButton('📊 Status', 'status'),
        this.menuButton('🛑 Stop', 'stop'),
      ] },
      { type: 'actions' as const, elements: [
        this.menuButton('📝 Diff', 'diff'),
        this.menuButton('✅ Commit', 'commit'),
        this.menuButton('🚀 PR', 'pr'),
        this.menuButton('🧪 Test', 'test'),
      ] },
    ];

    if (hasMinimumRole(role, 'admin')) {
      blocks.push({ type: 'actions' as const, elements: [
        this.menuButton('👥 Users', 'users'),
        this.menuButton('📊 Audit', 'audit'),
        this.menuButton('🩺 Doctor', 'doctor'),
      ] });
    }

    blocks.push({ type: 'actions' as const, elements: [
      this.menuButton('❓ Help', 'help'),
    ] });

    try {
      await this.app.client.chat.postMessage({ channel: chatId, text: 'PetFish Remote Menu', blocks });
    } catch (err) {
      console.error('[slack] sendMenuCard error:', err);
    }
  }

  private async sendProjectListCard(chatId: string, userId: string): Promise<void> {
    const fullUserId = `slack:${userId}`;
    const projects = this.deps?.listProjects(fullUserId) ?? [];

    if (projects.length === 0) {
      await this.app.client.chat.postMessage({ channel: chatId, text: 'No projects available.' });
      return;
    }

    const binding = this.deps?.getBinding('slack', chatId);
    const elements = projects.map((p) => {
      const prefix = binding?.project_id === p.id ? '✅ ' : '';
      return this.menuButton(`${prefix}${p.id}`, `use:${p.id}`);
    });

    const blocks = [
      { type: 'section' as const, text: { type: 'mrkdwn' as const, text: '*Select a project*' } },
      { type: 'actions' as const, elements },
    ];

    try {
      await this.app.client.chat.postMessage({ channel: chatId, text: 'Select a project', blocks });
    } catch (err) {
      console.error('[slack] sendProjectListCard error:', err);
    }
  }

  private async sendSessionListCard(chatId: string, _userId: string): Promise<void> {
    const sessions = await this.deps?.listSessions?.('slack', chatId);

    if (!sessions || sessions.length === 0) {
      await this.app.client.chat.postMessage({ channel: chatId, text: 'No sessions found (or request timed out).' });
      return;
    }

    const elements = sessions.map((s) =>
      this.menuButton(`${s.active ? '✅' : '🔹'} ${s.slug} — ${s.title || '(untitled)'}`, `switch:${s.slug}`),
    );

    const blocks = [
      { type: 'section' as const, text: { type: 'mrkdwn' as const, text: '*Select a session*' } },
      { type: 'actions' as const, elements },
    ];

    try {
      await this.app.client.chat.postMessage({ channel: chatId, text: 'Select a session', blocks });
    } catch (err) {
      console.error('[slack] sendSessionListCard error:', err);
    }
  }

  private isDuplicate(messageId: string): boolean {
    if (!messageId) return false;
    if (this.recentMessageIds.has(messageId)) return true;
    this.recentMessageIds.add(messageId);
    this.dedupQueue.push(messageId);
    if (this.dedupQueue.length > this.DEDUP_CACHE_SIZE) {
      const evicted = this.dedupQueue.shift()!;
      this.recentMessageIds.delete(evicted);
    }
    return false;
  }

  private loadUserChatMap(): void {
    const stored = this.deps?.getAllUserChatIds?.('slack');
    if (stored) {
      for (const [userId, chatId] of stored) {
        this.userChatMap.set(userId, chatId);
      }
    }
  }

  private cacheUserChat(userId: string, chatId: string): void {
    this.userChatMap.set(userId, chatId);
    this.deps?.setUserChatId?.('slack', userId, chatId);
  }

  private menuButton(label: string, command: string): Record<string, unknown> {
    return {
      type: 'button',
      text: { type: 'plain_text', text: label, emoji: true },
      action_id: `pf_menu:${command}`,
      value: command,
    };
  }

  private async sendQuestion(chatId: string, payload: TaskQuestionPayload): Promise<void> {
    this.pendingInteractions.set(chatId, payload.questionId);

    const blocks: KnownBlock[] = [];

    for (let qi = 0; qi < payload.questions.length; qi++) {
      const q = payload.questions[qi];
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `🤔 *Agent is asking (${qi + 1}/${payload.questions.length}):*\n_⚡ Forwarded from TUI session — ignore if already answered there._\n\n${q.header ? `*${q.header}*\n` : ''}${q.question}` },
      });

      const buttons = q.options.map((opt, oi) => ({
        type: 'button' as const,
        text: { type: 'plain_text' as const, text: opt.label, emoji: true },
        action_id: `pf_q:${payload.questionId}:${qi}:${oi}:${opt.label}`,
        value: opt.label,
        style: 'primary' as const,
      }));

      blocks.push({ type: 'actions', elements: buttons });
    }

    try {
      await this.app.client.chat.postMessage({
        channel: chatId,
        text: 'Agent Question',
        blocks,
      });
    } catch (err) {
      this.pendingInteractions.delete(chatId);
      console.error(`[slack] sendQuestion failed, cleared pending for channel=${chatId}:`, err);
    }
  }

  private async sendPermission(chatId: string, payload: TaskPermissionPayload): Promise<void> {
    this.pendingInteractions.set(chatId, payload.permissionId);

    let inputSummary = '';
    if (payload.input['command']) {
      inputSummary = `\`${String(payload.input['command'])}\``;
    } else if (payload.input['filePath']) {
      inputSummary = `file: \`${String(payload.input['filePath'])}\``;
    } else {
      const keys = Object.keys(payload.input).slice(0, 3);
      inputSummary = keys.map(k => `${k}: ${JSON.stringify(payload.input[k]).slice(0, 60)}`).join('\n');
    }

    const blocks = [
      {
        type: 'section' as const,
        text: { type: 'mrkdwn' as const, text: `🔐 *Agent wants to run:*\n\n\`${payload.tool}\`${inputSummary ? `\n${inputSummary}` : ''}` },
      },
      {
        type: 'actions' as const,
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Allow', emoji: true },
            action_id: `pf_perm:${payload.permissionId}:allow`,
            value: 'allow',
            style: 'primary' as const,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Deny', emoji: true },
            action_id: `pf_perm:${payload.permissionId}:deny`,
            value: 'deny',
            style: 'danger' as const,
          },
        ],
      },
    ];

    try {
      await this.app.client.chat.postMessage({
        channel: chatId,
        text: 'Permission Request',
        blocks,
      });
    } catch (err) {
      this.pendingInteractions.delete(chatId);
      console.error(`[slack] sendPermission failed, cleared pending for channel=${chatId}:`, err);
    }
  }
}
