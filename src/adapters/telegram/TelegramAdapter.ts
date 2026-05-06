import { Bot, Context, InlineKeyboard } from 'grammy';

import type { ChatEvent, ChatResponse, ProjectConfig } from '../../types.js';
import { telegramContextToChatEvent } from './telegramTypes.js';

export type TelegramEventHandler = (event: ChatEvent) => Promise<void> | void;

export interface TelegramDeps {
  listProjects: (userId: string) => ProjectConfig[];
  getBinding: (chatId: string) => { project_id: string } | undefined;
  bindProject: (chatId: string, projectId: string) => void;
  isUserAllowed: (projectId: string, userId: string) => boolean;
}

export class TelegramAdapter {
  private readonly bot: Bot<Context>;

  public constructor(
    token: string,
    private readonly onEvent: TelegramEventHandler,
    private readonly deps?: TelegramDeps,
  ) {
    this.bot = new Bot<Context>(token);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.command('start', async (ctx) => {
      await ctx.reply(
        '><(((^> *PetFish Remote* — 胖鱼遥控器\n\n' +
        'Control your opencode sessions from Telegram.\n\n' +
        'Use /pf to get started.',
        { parse_mode: 'Markdown' },
      );
    });

    this.bot.command('pf', async (ctx) => {
      const args = ctx.match?.trim();
      if (args) {
        const event = telegramContextToChatEvent(ctx);
        if (event) {
          event.text = `/pf ${args}`;
          await this.onEvent(event);
        }
        return;
      }

      const binding = this.deps?.getBinding(String(ctx.chat.id));
      const keyboard = new InlineKeyboard()
        .text('📋 Projects', 'pf:list')
        .text('📊 Status', 'pf:status')
        .row()
        .text('🛑 Stop', 'pf:stop')
        .text('❓ Help', 'pf:help');

      const boundText = binding
        ? `\nBound to: *${binding.project_id}*\nSend any message to ask.`
        : '\nNo project bound yet. Tap Projects to start.';

      await ctx.reply(
        `><(((^> *PetFish Remote*${boundText}`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    });

    this.bot.callbackQuery('pf:list', async (ctx) => {
      await ctx.answerCallbackQuery();
      const userId = `telegram:${ctx.from.id}`;
      const projects = this.deps?.listProjects(userId) ?? [];

      if (projects.length === 0) {
        await ctx.editMessageText('No projects available.');
        return;
      }

      const keyboard = new InlineKeyboard();
      for (let i = 0; i < projects.length; i++) {
        const p = projects[i];
        const binding = this.deps?.getBinding(String(ctx.chatId));
        const prefix = binding?.project_id === p.id ? '✅ ' : '';
        keyboard.text(`${prefix}${p.name}`, `pf:use:${p.id}`);
        if (i % 2 === 1) keyboard.row();
      }
      keyboard.row().text('⬅️ Back', 'pf:back');

      await ctx.editMessageText('Select a project:', { reply_markup: keyboard });
    });

    this.bot.callbackQuery(/^pf:use:(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      const projectId = ctx.match![1];
      const userId = `telegram:${ctx.from.id}`;
      const chatId = String(ctx.chatId);

      if (!this.deps?.isUserAllowed(projectId, userId)) {
        await ctx.editMessageText(`Access denied: ${projectId}`);
        return;
      }

      this.deps.bindProject(chatId, projectId);
      await ctx.editMessageText(
        `✅ Bound to *${projectId}*\n\nNow just send any message to ask.`,
        { parse_mode: 'Markdown' },
      );
    });

    this.bot.callbackQuery('pf:status', async (ctx) => {
      await ctx.answerCallbackQuery();
      const event = this.syntheticEvent(ctx, '/pf status');
      if (event) await this.onEvent(event);
    });

    this.bot.callbackQuery('pf:stop', async (ctx) => {
      await ctx.answerCallbackQuery();
      const event = this.syntheticEvent(ctx, '/pf stop');
      if (event) await this.onEvent(event);
    });

    this.bot.callbackQuery('pf:help', async (ctx) => {
      await ctx.answerCallbackQuery();
      const event = this.syntheticEvent(ctx, '/pf help');
      if (event) await this.onEvent(event);
    });

    this.bot.callbackQuery('pf:back', async (ctx) => {
      await ctx.answerCallbackQuery();
      const binding = this.deps?.getBinding(String(ctx.chatId));
      const keyboard = new InlineKeyboard()
        .text('📋 Projects', 'pf:list')
        .text('📊 Status', 'pf:status')
        .row()
        .text('🛑 Stop', 'pf:stop')
        .text('❓ Help', 'pf:help');

      const boundText = binding
        ? `\nBound to: *${binding.project_id}*\nSend any message to ask.`
        : '\nNo project bound yet. Tap Projects to start.';

      await ctx.editMessageText(
        `><(((^> *PetFish Remote*${boundText}`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    });

    this.bot.on('callback_query:data', async (ctx) => {
      await ctx.answerCallbackQuery();
    });

    this.bot.on('message', async (ctx) => {
      const event = telegramContextToChatEvent(ctx);
      if (!event) return;
      await this.onEvent(event);
    });
  }

  private syntheticEvent(ctx: Context, text: string): ChatEvent | undefined {
    if (!ctx.from || !ctx.chatId) return undefined;
    return {
      platform: 'telegram',
      chat_id: String(ctx.chatId),
      user_id: String(ctx.from.id),
      username: ctx.from.username ?? '',
      message_id: String(ctx.callbackQuery?.message?.message_id ?? '0'),
      text,
      attachments: [],
      timestamp: new Date().toISOString(),
    };
  }

  public async start(): Promise<void> {
    await this.bot.api.setMyCommands([
      { command: 'pf', description: 'PetFish Remote control panel' },
      { command: 'start', description: 'Welcome & setup' },
    ]);
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
