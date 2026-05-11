import AiBot from '@wecom/aibot-node-sdk';
import type { WsFrame, TemplateCard } from '@wecom/aibot-node-sdk';

import type { ChatResponse, UserRole } from '../../types.js';
import { hasMinimumRole } from '../../types.js';
import type { TaskQuestionPayload, TaskPermissionPayload } from '../../protocol/connectorProtocol.js';
import { BaseIMAdapter } from '../types.js';
import type { AdapterDeps, OutboundInteraction } from '../types.js';

export interface WeComConfig {
  botId: string;
  secret: string;
}

export class WeComAdapter extends BaseIMAdapter {
  readonly platform = 'wecom' as const;

  private wsClient: AiBot.WSClient;
  private readonly pendingInteractions = new Map<string, string>();
  private readonly recentMessageIds = new Set<string>();
  private readonly DEDUP_CACHE_SIZE = 200;
  private readonly dedupQueue: string[] = [];
  private readonly userChatMap = new Map<string, string>();

  public constructor(config: WeComConfig, readonly deps?: AdapterDeps) {
    super();
    this.wsClient = new AiBot.WSClient({
      botId: config.botId,
      secret: config.secret,
      maxReconnectAttempts: -1,
      heartbeatInterval: 30000,
    });
    this.registerHandlers();
  }

  public async start(): Promise<void> {
    this.loadUserChatMap();
    this.wsClient.connect();
    return new Promise<void>((resolve) => {
      this.wsClient.on('authenticated', () => {
        console.log('[wecom] WebSocket authenticated');
        resolve();
      });
      this.wsClient.on('error', (err: Error) => {
        console.error('[wecom] Connection error:', err.message);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    this.wsClient.disconnect();
    console.log('[wecom] Disconnected');
  }

  public async sendMessage(response: ChatResponse): Promise<void> {
    if (response.platform !== 'wecom') {
      throw new Error(`Unsupported platform for WeCom adapter: ${response.platform}`);
    }
    try {
      await this.wsClient.sendMessage(response.chat_id, {
        msgtype: 'markdown',
        markdown: { content: response.text },
      });
    } catch (err) {
      console.error(`[wecom] sendMessage error for chatId=${response.chat_id}:`, err);
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
    this.wsClient.on('connected', () => {
      console.log('[wecom] WebSocket connected');
    });

    this.wsClient.on('disconnected', (reason: string) => {
      console.log(`[wecom] WebSocket disconnected: ${reason}`);
    });

    this.wsClient.on('error', (err: Error) => {
      console.error('[wecom] Error:', err.message);
    });

    this.wsClient.on('message.text', (frame: WsFrame) => {
      this.handleMessage(frame);
    });

    this.wsClient.on('event.enter_chat', (frame: WsFrame) => {
      void this.wsClient.replyWelcome(frame, {
        msgtype: 'text',
        text: { content: '><(((^> PetFish Remote — 胖鱼遥控器\n\nSend /pf to open the control panel.\n发送 /pf 打开控制面板。' },
      }).catch((err: unknown) => console.error('[wecom] replyWelcome error:', err));
    });

    this.wsClient.on('event.template_card_event', (frame: WsFrame) => {
      this.handleCardEvent(frame);
    });
  }

  private handleMessage(frame: WsFrame): void {
    const body = frame.body;
    if (!body) return;

    const messageId = body.msgid ?? '';
    if (this.isDuplicate(messageId)) return;

    const chatId = this.resolveChatId(frame);
    const userId = body.from?.userid ?? '';
    const text = body.text?.content ?? '';
    if (!text || !chatId) return;

    this.cacheUserChat(userId, chatId);

    console.log(`[wecom] Message received: chatId=${chatId} user=${userId} msgId=${messageId} text=${JSON.stringify(text)}`);

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
        platform: 'wecom',
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

  private handleCardEvent(frame: WsFrame): void {
    const body = frame.body;
    if (!body?.event) return;

    const eventKey: string = body.event.event_key ?? '';
    const taskId: string = body.event.task_id ?? '';
    const userId = body.from?.userid ?? '';
    const chatId = this.resolveChatId(frame);

    if (chatId) this.cacheUserChat(userId, chatId);

    if (eventKey.startsWith('pf_q_')) {
      const parts = eventKey.split('_');
      const questionId = parts[2] ?? '';
      const answer = parts.slice(5).join('_');
      if (chatId) this.pendingInteractions.delete(chatId);
      this.emit({
        type: 'questionReply',
        event: { questionId, answers: [[answer]] },
      });
      void this.updateCardDone(frame, taskId, `Answer: ${answer}`);
      return;
    }

    if (eventKey.startsWith('pf_perm_')) {
      const parts = eventKey.split('_');
      const permissionId = parts[2] ?? '';
      const allowed = parts[3] === 'allow';
      if (chatId) this.pendingInteractions.delete(chatId);
      this.emit({
        type: 'permissionReply',
        event: { permissionId, allowed },
      });
      void this.updateCardDone(frame, taskId, allowed ? '✅ Allowed' : '❌ Denied');
      return;
    }

    if (eventKey.startsWith('pf_menu_')) {
      const command = eventKey.slice(8);
      if (!chatId) return;
      if (command === 'list') {
        void this.sendProjectListCard(chatId, userId);
      } else if (command === 'sessions') {
        void this.sendSessionListCard(chatId, userId);
      } else if (command.startsWith('use_')) {
        const projectId = command.slice(4);
        this.emitSyntheticCommand(chatId, userId, `/pf use ${projectId}`);
      } else if (command.startsWith('switch_')) {
        const slug = command.slice(7);
        this.emitSyntheticCommand(chatId, userId, `/pf switch ${slug}`);
      } else if (command) {
        this.emitSyntheticCommand(chatId, userId, `/pf ${command}`);
      }
      void this.updateCardDone(frame, taskId, `→ ${command}`);
      return;
    }
  }

  private async updateCardDone(frame: WsFrame, taskId: string, result: string): Promise<void> {
    try {
      await this.wsClient.updateTemplateCard(frame, {
        card_type: 'text_notice',
        main_title: { title: result },
        task_id: taskId,
      } as TemplateCard);
    } catch (err) {
      console.error('[wecom] updateTemplateCard error:', err);
    }
  }

  private emitSyntheticCommand(chatId: string, userId: string, text: string): void {
    this.emit({
      type: 'message',
      event: {
        platform: 'wecom',
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
    const fullUserId = `wecom:${userId}`;
    const serverUrl = process.env.PETFISH_SERVER_URL ?? 'https://remote.petfish.ai';

    let tokenText: string;
    if (this.deps?.generateRegistrationToken) {
      const token = this.deps.generateRegistrationToken(fullUserId);
      tokenText =
        `📖 Install guide: ${serverUrl}/docs/install\n\n` +
        `🔑 Your token:\n\`${token}\`\n\n` +
        'Token expires in 5 minutes. Supports macOS / Linux / WSL / Windows.';
    } else {
      tokenText = 'Use the control panel to get started.';
    }

    try {
      await this.wsClient.sendMessage(chatId, {
        msgtype: 'markdown',
        markdown: { content: `**><(((^> PetFish Remote — 胖鱼遥控器**\n\nControl your opencode sessions from WeCom.\n\n${tokenText}` },
      });
      await this.sendMenuCard(chatId, userId);
    } catch (err) {
      console.error('[wecom] sendStartCard error:', err);
    }
  }

  private async sendMenuCard(chatId: string, userId?: string): Promise<void> {
    const binding = this.deps?.getBinding('wecom', chatId);
    const desc = binding
      ? `Bound to: **${binding.project_id}**\nSend any message to ask.`
      : 'No project bound yet. Tap Projects to start.';

    const fullUserId = userId ? `wecom:${userId}` : undefined;
    const role: UserRole = fullUserId
      ? (this.deps?.getUserRole?.(fullUserId) ?? 'viewer')
      : 'viewer';

    const card1: TemplateCard = {
      card_type: 'button_interaction',
      main_title: { title: '><(((^> PetFish Remote', desc },
      button_list: [
        { text: '📋 Projects', key: 'pf_menu_list', style: 1 },
        { text: '📂 Sessions', key: 'pf_menu_sessions', style: 1 },
        { text: '📍 Where', key: 'pf_menu_where', style: 1 },
        { text: '🔄 New', key: 'pf_menu_new', style: 2 },
        { text: '📊 Status', key: 'pf_menu_status', style: 2 },
        { text: '🛑 Stop', key: 'pf_menu_stop', style: 2 },
      ],
      task_id: `pf_menu_${Date.now()}`,
    };

    const card2: TemplateCard = {
      card_type: 'button_interaction',
      main_title: { title: 'Development' },
      button_list: [
        { text: '📝 Diff', key: 'pf_menu_diff', style: 2 },
        { text: '✅ Commit', key: 'pf_menu_commit', style: 2 },
        { text: '🚀 PR', key: 'pf_menu_pr', style: 2 },
        { text: '🧪 Test', key: 'pf_menu_test', style: 2 },
        { text: '❓ Help', key: 'pf_menu_help', style: 2 },
      ],
      task_id: `pf_menu2_${Date.now()}`,
    };

    try {
      await this.wsClient.sendMessage(chatId, { msgtype: 'template_card', template_card: card1 });
      await this.wsClient.sendMessage(chatId, { msgtype: 'template_card', template_card: card2 });

      if (hasMinimumRole(role, 'admin')) {
        const card3: TemplateCard = {
          card_type: 'button_interaction',
          main_title: { title: 'Admin' },
          button_list: [
            { text: '👥 Users', key: 'pf_menu_users', style: 2 },
            { text: '📊 Audit', key: 'pf_menu_audit', style: 2 },
            { text: '🩺 Doctor', key: 'pf_menu_doctor', style: 2 },
          ],
          task_id: `pf_menu3_${Date.now()}`,
        };
        await this.wsClient.sendMessage(chatId, { msgtype: 'template_card', template_card: card3 });
      }
    } catch (err) {
      console.error('[wecom] sendMenuCard error:', err);
    }
  }

  private async sendProjectListCard(chatId: string, userId: string): Promise<void> {
    const fullUserId = `wecom:${userId}`;
    const projects = this.deps?.listProjects(fullUserId) ?? [];

    if (projects.length === 0) {
      await this.wsClient.sendMessage(chatId, {
        msgtype: 'markdown',
        markdown: { content: 'No projects available.' },
      }).catch((err: unknown) => console.error('[wecom] sendProjectListCard empty error:', err));
      return;
    }

    const binding = this.deps?.getBinding('wecom', chatId);
    const buttons = projects.slice(0, 6).map((p) => {
      const prefix = binding?.project_id === p.id ? '✅ ' : '';
      return { text: `${prefix}${p.id}`, key: `pf_menu_use_${p.id}`, style: (binding?.project_id === p.id ? 1 : 2) as 1 | 2 };
    });

    const card: TemplateCard = {
      card_type: 'button_interaction',
      main_title: { title: 'Select a project' },
      button_list: buttons,
      task_id: `pf_proj_${Date.now()}`,
    };

    try {
      await this.wsClient.sendMessage(chatId, { msgtype: 'template_card', template_card: card });
    } catch (err) {
      console.error('[wecom] sendProjectListCard error:', err);
    }
  }

  private async sendSessionListCard(chatId: string, _userId: string): Promise<void> {
    const sessions = await this.deps?.listSessions?.('wecom', chatId);

    if (!sessions || sessions.length === 0) {
      await this.wsClient.sendMessage(chatId, {
        msgtype: 'markdown',
        markdown: { content: 'No sessions found (or request timed out).' },
      }).catch((err: unknown) => console.error('[wecom] sendSessionListCard empty error:', err));
      return;
    }

    const buttons = sessions.slice(0, 6).map((s) => ({
      text: `${s.active ? '✅' : '🔹'} ${s.slug} — ${s.title || '(untitled)'}`,
      key: `pf_menu_switch_${s.slug}`,
      style: (s.active ? 1 : 2) as 1 | 2,
    }));

    const card: TemplateCard = {
      card_type: 'button_interaction',
      main_title: { title: 'Select a session' },
      button_list: buttons,
      task_id: `pf_sess_${Date.now()}`,
    };

    try {
      await this.wsClient.sendMessage(chatId, { msgtype: 'template_card', template_card: card });
    } catch (err) {
      console.error('[wecom] sendSessionListCard error:', err);
    }
  }

  private async sendQuestion(chatId: string, payload: TaskQuestionPayload): Promise<void> {
    this.pendingInteractions.set(chatId, payload.questionId);

    for (let qi = 0; qi < payload.questions.length; qi++) {
      const q = payload.questions[qi];
      const questionTitle = q.header
        ? `${q.header} (${qi + 1}/${payload.questions.length})`
        : `Question ${qi + 1}/${payload.questions.length}`;

      const buttons = q.options.slice(0, 6).map((opt, oi) => ({
        text: opt.label,
        key: `pf_q_${payload.questionId}_${qi}_${oi}_${opt.label.replace(/[^a-zA-Z0-9_@-]/g, '')}`,
        style: 1 as const,
      }));

      const card: TemplateCard = {
        card_type: 'button_interaction',
        main_title: { title: `🤔 ${questionTitle}`, desc: q.question },
        button_list: buttons,
        task_id: `pf_q_${payload.questionId}_${qi}`,
      };

      try {
        await this.wsClient.sendMessage(chatId, { msgtype: 'template_card', template_card: card });
      } catch (err) {
        this.pendingInteractions.delete(chatId);
        console.error(`[wecom] sendQuestion failed for chatId=${chatId}:`, err);
      }
    }
  }

  private async sendPermission(chatId: string, payload: TaskPermissionPayload): Promise<void> {
    this.pendingInteractions.set(chatId, payload.permissionId);

    let inputSummary = '';
    if (payload.input['command']) {
      inputSummary = `\n${String(payload.input['command'])}`;
    } else if (payload.input['filePath']) {
      inputSummary = `\nfile: ${String(payload.input['filePath'])}`;
    } else {
      const keys = Object.keys(payload.input).slice(0, 3);
      inputSummary = keys.map(k => `\n${k}: ${JSON.stringify(payload.input[k]).slice(0, 60)}`).join('');
    }

    const card: TemplateCard = {
      card_type: 'button_interaction',
      main_title: { title: `🔐 ${payload.tool}`, desc: `Agent wants to run:${inputSummary}` },
      button_list: [
        { text: '✅ Allow', key: `pf_perm_${payload.permissionId}_allow`, style: 1 },
        { text: '❌ Deny', key: `pf_perm_${payload.permissionId}_deny`, style: 2 },
      ],
      task_id: `pf_perm_${payload.permissionId}`,
    };

    try {
      await this.wsClient.sendMessage(chatId, { msgtype: 'template_card', template_card: card });
    } catch (err) {
      this.pendingInteractions.delete(chatId);
      console.error(`[wecom] sendPermission failed for chatId=${chatId}:`, err);
    }
  }

  private resolveChatId(frame: WsFrame): string {
    return frame.body?.chatid ?? frame.body?.from?.userid ?? '';
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
    const stored = this.deps?.getAllUserChatIds?.('wecom');
    if (stored) {
      for (const [userId, chatId] of stored) {
        this.userChatMap.set(userId, chatId);
      }
    }
  }

  private cacheUserChat(userId: string, chatId: string): void {
    this.userChatMap.set(userId, chatId);
    this.deps?.setUserChatId?.('wecom', userId, chatId);
  }
}
