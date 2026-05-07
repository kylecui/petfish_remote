import * as lark from '@larksuiteoapi/node-sdk';

import type { ChatResponse } from '../../types.js';
import type { TaskQuestionPayload, TaskPermissionPayload } from '../../protocol/connectorProtocol.js';
import { BaseIMAdapter } from '../types.js';
import type { AdapterDeps, OutboundInteraction } from '../types.js';

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  domain?: 'feishu' | 'lark';
}

export class FeishuAdapter extends BaseIMAdapter {
  readonly platform = 'feishu' as const;

  private readonly client: InstanceType<typeof lark.Client>;
  private wsClient: InstanceType<typeof lark.WSClient> | undefined;
  private readonly pendingInteractions = new Map<string, string>();

  private readonly recentMessageIds = new Set<string>();
  private readonly DEDUP_CACHE_SIZE = 200;
  private readonly dedupQueue: string[] = [];
  private readonly userChatMap = new Map<string, string>();

  public constructor(
    private readonly config: FeishuConfig,
    readonly deps?: AdapterDeps,
  ) {
    super();
    const domain = config.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;
    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      domain,
    });
  }

  public async start(): Promise<void> {
    this.loadUserChatMap();

    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': (data: unknown) => {
        this.handleMessage(data);
      },
      'im.chat.access_event.bot_p2p_chat_entered_v1': (data: unknown) => {
        this.handleChatEntered(data);
      },
      'application.bot.menu_v6': (data: unknown) => {
        this.handleBotMenu(data);
      },
      'card.action.trigger': (data: unknown) => {
        return this.handleCardAction(data);
      },
    });

    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: this.config.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu,
    });

    await this.wsClient.start({ eventDispatcher });
    console.log('[feishu] WebSocket client connected');
  }

  public async stop(): Promise<void> {
    // WSClient doesn't expose a stop method in current SDK
    this.wsClient = undefined;
  }

  public async sendMessage(response: ChatResponse): Promise<void> {
    if (response.platform !== 'feishu') {
      throw new Error(`Unsupported platform for Feishu adapter: ${response.platform}`);
    }

    const content = JSON.stringify({ text: response.text });

    try {
      const result = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: response.chat_id,
          msg_type: 'text',
          content,
        },
      });
      if (result?.code && result.code !== 0) {
        console.error(`[feishu] sendMessage failed: code=${result.code} msg=${result.msg}`);
      }
    } catch (err) {
      console.error(`[feishu] sendMessage error for chat_id=${response.chat_id}:`, err);
      throw err;
    }
  }

  public async sendTyping(chatId: string): Promise<void> {
    // Feishu has no typing indicator API — send a placeholder that gets updated
    void chatId;
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

  private handleMessage(data: unknown): void {
    const msg = data as {
      message?: {
        message_id?: string;
        chat_id?: string;
        message_type?: string;
        content?: string;
      };
      sender?: {
        sender_id?: { open_id?: string; user_id?: string };
      };
    };

    if (!msg?.message?.chat_id || msg.message.message_type !== 'text') return;

    const messageId = msg.message.message_id ?? '';
    if (this.isDuplicate(messageId)) {
      console.log(`[feishu] Duplicate message skipped: ${messageId}`);
      return;
    }

    let text = '';
    try {
      const content = JSON.parse(msg.message.content ?? '{}');
      text = content.text ?? '';
    } catch {
      return;
    }

    if (!text) return;

    const chatId = msg.message.chat_id;
    const userId = msg.sender?.sender_id?.open_id ?? msg.sender?.sender_id?.user_id ?? 'unknown';
    this.cacheUserChat(userId, chatId);

    console.log(`[feishu] Message received: chat_id=${chatId} user_id=${userId} message_id=${messageId} text=${JSON.stringify(text)}`);

    if (text.trim() === '/start') {
      void this.sendStartCard(chatId, 'chat_id', userId);
      return;
    }

    if (text.trim() === '/pf' || text.trim() === '/menu') {
      void this.sendMenuCard(chatId);
      return;
    }

    if (text.trim() === '/pf list') {
      void this.sendProjectListCard(chatId, userId);
      return;
    }

    this.emit({
      type: 'message',
      event: {
        platform: 'feishu',
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

  private handleChatEntered(data: unknown): void {
    const event = data as {
      chat_id?: string;
      operator_id?: { open_id?: string };
    };
    const chatId = event?.chat_id;
    const userId = event?.operator_id?.open_id;
    if (chatId && userId) {
      this.cacheUserChat(userId, chatId);
    }
  }

  private handleBotMenu(data: unknown): void {
    const event = data as {
      event_key?: string;
      operator?: { operator_id?: { open_id?: string } };
    };

    const eventKey = event?.event_key;
    const userId = event?.operator?.operator_id?.open_id ?? '';
    if (!eventKey || !userId) return;

    const chatId = this.userChatMap.get(userId) ?? '';

    if (!chatId) {
      console.log(`[feishu] bot_menu: no chat_id cached for user ${userId}, using open_id`);
      switch (eventKey) {
        case 'pf_start':
          void this.sendStartCard(userId, 'open_id');
          break;
        case 'pf_menu':
          void this.sendMenuCard(userId, 'open_id');
          break;
        default:
          void this.sendCardMessage(userId, 'open_id', {
            header: { title: { tag: 'plain_text', content: '><(((^> PetFish Remote' }, template: 'blue' },
            elements: [{ tag: 'markdown', content: 'Send any message to activate all commands, then try again.' }],
          });
          break;
      }
      return;
    }

    switch (eventKey) {
      case 'pf_start':
        void this.sendStartCard(chatId, 'chat_id', userId);
        break;
      case 'pf_menu':
        void this.sendMenuCard(chatId);
        break;
      case 'pf_list':
        void this.sendProjectListCard(chatId, userId);
        break;
      default: {
        const command = eventKey.startsWith('pf_') ? eventKey.slice(3) : eventKey;
        this.emitSyntheticCommand(chatId, userId, `/pf ${command}`);
        break;
      }
    }
  }

  public handleCardAction(data: unknown): Record<string, unknown> {
    const action = data as {
      action?: { value?: Record<string, string> };
      open_chat_id?: string;
      open_message_id?: string;
      operator?: { open_id?: string };
    };

    if (!action?.action?.value) return {};
    const value = action.action.value;
    const userId = action.operator?.open_id ?? '';
    const chatId = action.open_chat_id || this.userChatMap.get(userId) || '';

    console.log(`[feishu] cardAction: userId=${userId} chatId=${chatId} open_chat_id=${action.open_chat_id ?? 'undefined'} value=${JSON.stringify(value)}`);

    if (!chatId) {
      console.warn('[feishu] cardAction: cannot resolve chat_id, skipping');
      return {};
    }

    if (value['type'] === 'question_answer') {
      const questionId = value['questionId'] ?? '';
      const answer = value['answer'] ?? '';
      this.pendingInteractions.delete(chatId);
      this.emit({
        type: 'questionReply',
        event: { questionId, answers: [[answer]] },
      });
    } else if (value['type'] === 'permission_reply') {
      const permissionId = value['permissionId'] ?? '';
      const allowed = value['allowed'] === 'true';
      this.pendingInteractions.delete(chatId);
      this.emit({
        type: 'permissionReply',
        event: { permissionId, allowed },
      });
    } else if (value['type'] === 'menu_action') {
      const command = value['command'] ?? '';
      if (command === 'list') {
        void this.sendProjectListCard(chatId, userId);
      } else if (command.startsWith('use:')) {
        const projectId = command.slice(4);
        this.emitSyntheticCommand(chatId, userId, `/pf use ${projectId}`);
      } else if (command) {
        this.emitSyntheticCommand(chatId, userId, `/pf ${command}`);
      }
    }
    return { toast: { type: 'info', content: '✓' } };
  }

  private emitSyntheticCommand(chatId: string, userId: string, text: string): void {
    this.emit({
      type: 'message',
      event: {
        platform: 'feishu',
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

  private async sendStartCard(
    receiveId: string,
    receiveIdType: 'chat_id' | 'open_id' = 'chat_id',
    userId?: string,
  ): Promise<void> {
    const openId = userId ?? (receiveIdType === 'open_id' ? receiveId : '');
    const fullUserId = `feishu:${openId}`;
    const serverUrl = process.env.PETFISH_SERVER_URL ?? 'https://remote.petfish.ai';

    let tokenSection: string;
    if (this.deps?.generateRegistrationToken) {
      const token = this.deps.generateRegistrationToken(fullUserId);
      tokenSection =
        `📖 **Install guide:** ${serverUrl}/docs/install\n\n` +
        `🔑 **Your token:**\n\`${token}\`\n\n` +
        '_Token expires in 5 minutes. Supports macOS / Linux / WSL / Windows._';
    } else {
      tokenSection = 'Use the control panel to get started.';
    }

    const card = {
      header: {
        title: { tag: 'plain_text', content: '><(((^> PetFish Remote — 胖鱼遥控器' },
        template: 'blue',
      },
      elements: [
        {
          tag: 'markdown',
          content: `Control your opencode sessions from Feishu.\n\n${tokenSection}`,
        },
        {
          tag: 'action',
          actions: [this.menuButton('🎛️ Control Panel', 'menu')],
        },
      ],
    };

    await this.sendCardMessage(receiveId, receiveIdType, card);
  }

  private async sendMenuCard(
    receiveId: string,
    receiveIdType: 'chat_id' | 'open_id' = 'chat_id',
  ): Promise<void> {
    const binding = receiveIdType === 'chat_id'
      ? this.deps?.getBinding('feishu', receiveId)
      : undefined;
    const boundText = binding
      ? `Bound to: **${binding.project_id}**\nSend any message to ask.`
      : 'No project bound yet. Tap Projects to start.';

    const card = {
      header: {
        title: { tag: 'plain_text', content: '><(((^> PetFish Remote' },
        template: 'blue',
      },
      elements: [
        { tag: 'markdown', content: boundText },
        {
          tag: 'action',
          actions: [
            this.menuButton('📋 Projects', 'list'),
            this.menuButton('📊 Status', 'status'),
          ],
        },
        {
          tag: 'action',
          actions: [
            this.menuButton('🔄 New', 'new'),
            this.menuButton('🛑 Stop', 'stop'),
          ],
        },
        {
          tag: 'action',
          actions: [
            this.menuButton('📝 Diff', 'diff'),
            this.menuButton('✅ Commit', 'commit'),
            this.menuButton('🚀 PR', 'pr'),
          ],
        },
        {
          tag: 'action',
          actions: [
            this.menuButton('🧪 Test', 'test'),
            this.menuButton('❓ Help', 'help'),
          ],
        },
      ],
    };

    await this.sendCardMessage(receiveId, receiveIdType, card);
  }

  private async sendProjectListCard(chatId: string, userId: string): Promise<void> {
    const fullUserId = `feishu:${userId}`;
    const projects = this.deps?.listProjects(fullUserId) ?? [];

    if (projects.length === 0) {
      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: 'No projects available.' }),
        },
      });
      return;
    }

    const binding = this.deps?.getBinding('feishu', chatId);
    const buttons = projects.map((p) => {
      const prefix = binding?.project_id === p.id ? '✅ ' : '';
      return this.menuButton(`${prefix}${p.id}`, `use:${p.id}`);
    });

    const card = {
      header: {
        title: { tag: 'plain_text', content: 'Select a project' },
        template: 'blue',
      },
      elements: [
        {
          tag: 'action',
          actions: buttons,
        },
      ],
    };

    try {
      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });
    } catch (err) {
      console.error(`[feishu] sendProjectListCard error:`, err);
    }
  }

  private loadUserChatMap(): void {
    const stored = this.deps?.getAllUserChatIds?.('feishu');
    if (stored) {
      for (const [userId, chatId] of stored) {
        this.userChatMap.set(userId, chatId);
      }
    }
  }

  private cacheUserChat(userId: string, chatId: string): void {
    this.userChatMap.set(userId, chatId);
    this.deps?.setUserChatId?.('feishu', userId, chatId);
  }

  private menuButton(label: string, command: string): Record<string, unknown> {
    return {
      tag: 'button',
      text: { tag: 'plain_text', content: label },
      type: 'default',
      value: { type: 'menu_action', command },
    };
  }

  private async sendCardMessage(
    receiveId: string,
    receiveIdType: 'chat_id' | 'open_id',
    card: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: receiveId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });
    } catch (err) {
      console.error(`[feishu] sendCardMessage error (${receiveIdType}=${receiveId}):`, err);
    }
  }

  private async sendQuestion(chatId: string, payload: TaskQuestionPayload): Promise<void> {
    this.pendingInteractions.set(chatId, payload.questionId);

    const elements: unknown[] = [];

    for (let qi = 0; qi < payload.questions.length; qi++) {
      const q = payload.questions[qi];
      elements.push({
        tag: 'markdown',
        content: `🤔 **Agent is asking (${qi + 1}/${payload.questions.length}):**\n\n${q.header ? `**${q.header}**\n` : ''}${q.question}`,
      });

      const buttons = q.options.map((opt, oi) => ({
        tag: 'button',
        text: { tag: 'plain_text', content: opt.label },
        type: 'primary',
        value: {
          type: 'question_answer',
          questionId: payload.questionId,
          questionIndex: String(qi),
          optionIndex: String(oi),
          answer: opt.label,
        },
      }));

      elements.push({
        tag: 'action',
        actions: buttons,
      });
    }

    const card = {
      header: {
        title: { tag: 'plain_text', content: 'Agent Question' },
        template: 'blue',
      },
      elements,
    };

    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
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

    const card = {
      header: {
        title: { tag: 'plain_text', content: 'Permission Request' },
        template: 'orange',
      },
      elements: [
        {
          tag: 'markdown',
          content: `🔐 **Agent wants to run:**\n\n\`${payload.tool}\`${inputSummary ? `\n${inputSummary}` : ''}`,
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '✅ Allow' },
              type: 'primary',
              value: {
                type: 'permission_reply',
                permissionId: payload.permissionId,
                allowed: 'true',
              },
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '❌ Deny' },
              type: 'danger',
              value: {
                type: 'permission_reply',
                permissionId: payload.permissionId,
                allowed: 'false',
              },
            },
          ],
        },
      ],
    };

    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
  }
}
