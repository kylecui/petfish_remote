import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn().mockResolvedValue({});

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: vi.fn().mockImplementation(() => ({
    im: { message: { create: mockCreate } },
  })),
  WSClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
  })),
  EventDispatcher: vi.fn().mockImplementation(() => ({
    register: vi.fn().mockReturnThis(),
  })),
  Domain: { Feishu: 0, Lark: 1 },
}));

import * as lark from '@larksuiteoapi/node-sdk';
import { FeishuAdapter } from '../src/adapters/feishu/FeishuAdapter.js';
import type { AdapterInboundEvent } from '../src/adapters/types.js';

const MockClient = lark.Client as unknown as ReturnType<typeof vi.fn>;
const MockEventDispatcher = lark.EventDispatcher as unknown as ReturnType<typeof vi.fn>;

function createAdapter(domain?: 'feishu' | 'lark') {
  return new FeishuAdapter({
    appId: 'test-app-id',
    appSecret: 'test-app-secret',
    domain,
  });
}

function getEventHandlers() {
  const dispatcherInstance = MockEventDispatcher.mock.results[
    MockEventDispatcher.mock.results.length - 1
  ].value;
  const registerCall = dispatcherInstance.register.mock.calls[0][0];
  return {
    handleMessage: registerCall['im.message.receive_v1'] as (data: unknown) => void,
    handleCardAction: registerCall['card.action.trigger'] as (data: unknown) => unknown,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({});
});

describe('FeishuAdapter', () => {
  describe('constructor', () => {
    it('creates client with Feishu domain by default', () => {
      createAdapter();

      expect(MockClient).toHaveBeenCalledWith({
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        domain: 0, // Domain.Feishu
      });
    });

    it('creates client with Lark domain when domain="lark"', () => {
      createAdapter('lark');

      expect(MockClient).toHaveBeenCalledWith({
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        domain: 1, // Domain.Lark
      });
    });
  });

  describe('handleMessage', () => {
    it('emits correct ChatEvent for valid text messages', async () => {
      const adapter = createAdapter();
      const events: AdapterInboundEvent[] = [];
      adapter.onEvent((e) => events.push(e));
      await adapter.start();

      const { handleMessage } = getEventHandlers();
      handleMessage({
        message: {
          chat_id: 'chat_123',
          message_type: 'text',
          content: JSON.stringify({ text: 'hello world' }),
        },
        sender: {
          sender_id: { open_id: 'user_456' },
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('message');
      const evt = (events[0] as { type: 'message'; event: { platform: string; chat_id: string; user_id: string; text: string } }).event;
      expect(evt.platform).toBe('feishu');
      expect(evt.chat_id).toBe('chat_123');
      expect(evt.user_id).toBe('user_456');
      expect(evt.text).toBe('hello world');
    });

    it('ignores non-text messages', async () => {
      const adapter = createAdapter();
      const events: AdapterInboundEvent[] = [];
      adapter.onEvent((e) => events.push(e));
      await adapter.start();

      const { handleMessage } = getEventHandlers();
      handleMessage({
        message: {
          chat_id: 'chat_123',
          message_type: 'image',
          content: '{}',
        },
        sender: { sender_id: { open_id: 'user_456' } },
      });

      expect(events).toHaveLength(0);
    });

    it('ignores messages without chat_id', async () => {
      const adapter = createAdapter();
      const events: AdapterInboundEvent[] = [];
      adapter.onEvent((e) => events.push(e));
      await adapter.start();

      const { handleMessage } = getEventHandlers();
      handleMessage({
        message: {
          message_type: 'text',
          content: JSON.stringify({ text: 'hello' }),
        },
        sender: { sender_id: { open_id: 'user_456' } },
      });

      expect(events).toHaveLength(0);
    });
  });

  describe('sendMessage', () => {
    it('calls client.im.message.create with correct params', async () => {
      const adapter = createAdapter();

      await adapter.sendMessage({
        platform: 'feishu',
        chat_id: 'chat_abc',
        message_type: 'text',
        text: 'reply text',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: 'chat_abc',
          msg_type: 'text',
          content: JSON.stringify({ text: 'reply text' }),
        },
      });
    });

    it('throws for non-feishu platform', async () => {
      const adapter = createAdapter();

      await expect(
        adapter.sendMessage({
          platform: 'telegram' as 'feishu',
          chat_id: 'chat_abc',
          message_type: 'text',
          text: 'test',
        }),
      ).rejects.toThrow('Unsupported platform for Feishu adapter: telegram');
    });
  });

  describe('sendTyping', () => {
    it('is a no-op and does not throw', async () => {
      const adapter = createAdapter();

      await expect(adapter.sendTyping('chat_123')).resolves.toBeUndefined();
    });
  });

  describe('hasPendingInteraction', () => {
    it('returns false when no pending interactions', () => {
      const adapter = createAdapter();

      expect(adapter.hasPendingInteraction('chat_xyz')).toBe(false);
    });

    it('returns true after sendQuestion sets pending interaction', async () => {
      const adapter = createAdapter();

      await adapter.sendInteraction({
        type: 'question',
        chatId: 'chat_xyz',
        payload: {
          taskId: 'task_1',
          sessionId: 'sess_1',
          questionId: 'q_1',
          questions: [
            {
              header: 'Test',
              question: 'Pick one',
              options: [{ label: 'A', description: '' }, { label: 'B', description: '' }],
              multiple: false,
              custom: false,
            },
          ],
        },
      });

      expect(adapter.hasPendingInteraction('chat_xyz')).toBe(true);
    });
  });

  describe('handleCardAction', () => {
    it('emits questionReply with correct format', async () => {
      const adapter = createAdapter();
      const events: AdapterInboundEvent[] = [];
      adapter.onEvent((e) => events.push(e));
      await adapter.start();

      await adapter.sendInteraction({
        type: 'question',
        chatId: 'chat_q',
        payload: {
          taskId: 'task_q',
          sessionId: 'sess_q',
          questionId: 'q_42',
          questions: [{ header: '', question: 'Q?', options: [{ label: 'Yes', description: '' }], multiple: false, custom: false }],
        },
      });

      const { handleCardAction } = getEventHandlers();
      handleCardAction({
        action: {
          value: {
            type: 'question_answer',
            questionId: 'q_42',
            answer: 'Yes',
          },
        },
        open_chat_id: 'chat_q',
        operator: { open_id: 'user_op' },
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('questionReply');
      const reply = (events[0] as { type: 'questionReply'; event: { questionId: string; answers: string[][] } }).event;
      expect(reply.questionId).toBe('q_42');
      expect(reply.answers).toEqual([['Yes']]);
    });

    it('emits permissionReply with correct format', async () => {
      const adapter = createAdapter();
      const events: AdapterInboundEvent[] = [];
      adapter.onEvent((e) => events.push(e));
      await adapter.start();

      await adapter.sendInteraction({
        type: 'permission',
        chatId: 'chat_p',
        payload: {
          taskId: 'task_p',
          sessionId: 'sess_p',
          permissionId: 'perm_99',
          tool: 'bash',
          input: { command: 'rm -rf /' },
        },
      });

      const { handleCardAction } = getEventHandlers();
      handleCardAction({
        action: {
          value: {
            type: 'permission_reply',
            permissionId: 'perm_99',
            allowed: 'true',
          },
        },
        open_chat_id: 'chat_p',
        operator: { open_id: 'user_op' },
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('permissionReply');
      const reply = (events[0] as { type: 'permissionReply'; event: { permissionId: string; allowed: boolean } }).event;
      expect(reply.permissionId).toBe('perm_99');
      expect(reply.allowed).toBe(true);
    });

    it('clears pending interaction after card action', async () => {
      const adapter = createAdapter();
      await adapter.start();

      await adapter.sendInteraction({
        type: 'question',
        chatId: 'chat_clear',
        payload: {
          taskId: 'task_c',
          sessionId: 'sess_c',
          questionId: 'q_clear',
          questions: [{ header: '', question: 'Q?', options: [{ label: 'Ok', description: '' }], multiple: false, custom: false }],
        },
      });

      expect(adapter.hasPendingInteraction('chat_clear')).toBe(true);

      const { handleCardAction } = getEventHandlers();
      handleCardAction({
        action: {
          value: {
            type: 'question_answer',
            questionId: 'q_clear',
            answer: 'Ok',
          },
        },
        open_chat_id: 'chat_clear',
        operator: { open_id: 'user_op' },
      });

      expect(adapter.hasPendingInteraction('chat_clear')).toBe(false);
    });
  });
});
