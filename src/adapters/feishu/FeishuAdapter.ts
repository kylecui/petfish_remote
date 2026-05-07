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
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': (data: unknown) => {
        this.handleMessage(data);
      },
      'card.action.trigger': (data: unknown) => {
        this.handleCardAction(data);
        return { toast: { type: 'info', content: '✓' } };
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

    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: response.chat_id,
        msg_type: 'text',
        content,
      },
    });
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

  private handleMessage(data: unknown): void {
    const msg = data as {
      message?: {
        chat_id?: string;
        message_type?: string;
        content?: string;
      };
      sender?: {
        sender_id?: { open_id?: string; user_id?: string };
      };
    };

    if (!msg?.message?.chat_id || msg.message.message_type !== 'text') return;

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

  private handleCardAction(data: unknown): void {
    const action = data as {
      action?: { value?: Record<string, string> };
      open_chat_id?: string;
      operator?: { open_id?: string };
    };

    if (!action?.action?.value) return;
    const value = action.action.value;
    const chatId = action.open_chat_id ?? '';
    const userId = action.operator?.open_id ?? '';

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
    }

    void userId;
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
        value: JSON.stringify({
          type: 'question_answer',
          questionId: payload.questionId,
          questionIndex: qi,
          optionIndex: oi,
          answer: opt.label,
        }),
      }));

      elements.push({
        tag: 'action',
        actions: buttons,
      });
    }

    const card = {
      schema: '2.0',
      header: {
        title: { tag: 'plain_text', content: 'Agent Question' },
        template: 'blue',
      },
      body: { elements },
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
      schema: '2.0',
      header: {
        title: { tag: 'plain_text', content: 'Permission Request' },
        template: 'orange',
      },
      body: {
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
                value: JSON.stringify({
                  type: 'permission_reply',
                  permissionId: payload.permissionId,
                  allowed: 'true',
                }),
              },
              {
                tag: 'button',
                text: { tag: 'plain_text', content: '❌ Deny' },
                type: 'danger',
                value: JSON.stringify({
                  type: 'permission_reply',
                  permissionId: payload.permissionId,
                  allowed: 'false',
                }),
              },
            ],
          },
        ],
      },
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
