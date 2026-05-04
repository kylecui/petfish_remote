import { Bot, Context } from 'grammy';

import type { ChatEvent, ChatResponse } from '../../types.js';
import { telegramContextToChatEvent } from './telegramTypes.js';

export type TelegramEventHandler = (event: ChatEvent) => Promise<void> | void;

export class TelegramAdapter {
  private readonly bot: Bot<Context>;

  public constructor(token: string, private readonly onEvent: TelegramEventHandler) {
    this.bot = new Bot<Context>(token);
    this.bot.on('message', async (ctx) => {
      const event = telegramContextToChatEvent(ctx);
      if (!event) {
        return;
      }
      await this.onEvent(event);
    });
  }

  public async start(): Promise<void> {
    await this.bot.start();
  }

  public async stop(): Promise<void> {
    await this.bot.stop();
  }

  public async sendMessage(response: ChatResponse): Promise<void> {
    if (response.platform !== 'telegram') {
      throw new Error(`Unsupported platform for Telegram adapter: ${response.platform}`);
    }

    const chatId = Number(response.chat_id);
    if (Number.isNaN(chatId)) {
      throw new Error(`Invalid Telegram chat id: ${response.chat_id}`);
    }

    await this.bot.api.sendMessage(chatId, response.text, {
      parse_mode: response.message_type === 'markdown' ? 'Markdown' : undefined,
      reply_parameters: response.reply_to ? { message_id: Number(response.reply_to) } : undefined,
    });
  }
}
