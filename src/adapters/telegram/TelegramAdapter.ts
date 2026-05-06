import { Bot, Context, InlineKeyboard } from 'grammy';

import type { ChatEvent, ChatResponse, ProjectConfig } from '../../types.js';
import type { TaskQuestionPayload } from '../../protocol/connectorProtocol.js';
import { telegramContextToChatEvent } from './telegramTypes.js';

export type TelegramEventHandler = (event: ChatEvent) => Promise<void> | void;
export type QuestionReplyHandler = (questionId: string, answers: string[][]) => void;
export type PermissionReplyHandler = (permissionId: string, allowed: boolean) => void;

export interface TelegramDeps {
  listProjects: (userId: string) => ProjectConfig[];
  getBinding: (chatId: string) => { project_id: string } | undefined;
  bindProject: (chatId: string, projectId: string) => void;
  isUserAllowed: (projectId: string, userId: string) => boolean;
  generateRegistrationToken?: (userId: string) => string;
}

interface PendingQuestion {
  questionId: string;
  chatId: string;
  messageIds: number[];
  questions: TaskQuestionPayload['questions'];
  answers: Map<number, string[]>;
  totalQuestions: number;
}

export class TelegramAdapter {
  private readonly bot: Bot<Context>;
  private readonly pendingQuestions = new Map<string, PendingQuestion>();
  private readonly chatToPendingQuestion = new Map<string, string>();
  private onQuestionReply: QuestionReplyHandler | undefined;
  private onPermissionReply: PermissionReplyHandler | undefined;

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
      const userId = `telegram:${ctx.from?.id}`;
      const serverUrl = process.env.PETFISH_SERVER_URL ?? 'https://remote.petfish.ai';
      const tokenSection = this.deps?.generateRegistrationToken
        ? (() => {
            const token = this.deps.generateRegistrationToken(userId);
            return (
              `\n\n📖 *Install guide:* ${serverUrl}/docs/install\n\n` +
              `🔑 *Your token:*\n\`\`\`\n${token}\n\`\`\`\n` +
              '_Token expires in 5 minutes. Supports macOS / Linux / WSL / Windows._'
            );
          })()
        : '\n\nUse /pf to get started.';

      await ctx.reply(
        `><(((^> *PetFish Remote* — 胖鱼遥控器\n\nControl your opencode sessions from Telegram.${tokenSection}`,
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
        .text('🔄 New', 'pf:new')
        .text('🛑 Stop', 'pf:stop')
        .row()
        .text('📝 Diff', 'pf:diff')
        .text('✅ Commit', 'pf:commit')
        .text('🚀 PR', 'pf:pr')
        .row()
        .text('🧪 Test', 'pf:test')
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

    this.bot.callbackQuery('pf:new', async (ctx) => {
      await ctx.answerCallbackQuery();
      const event = this.syntheticEvent(ctx, '/pf new');
      if (event) await this.onEvent(event);
    });

    this.bot.callbackQuery('pf:diff', async (ctx) => {
      await ctx.answerCallbackQuery();
      const event = this.syntheticEvent(ctx, '/pf diff');
      if (event) await this.onEvent(event);
    });

    this.bot.callbackQuery('pf:commit', async (ctx) => {
      await ctx.answerCallbackQuery();
      const event = this.syntheticEvent(ctx, '/pf commit');
      if (event) await this.onEvent(event);
    });

    this.bot.callbackQuery('pf:pr', async (ctx) => {
      await ctx.answerCallbackQuery();
      const event = this.syntheticEvent(ctx, '/pf pr');
      if (event) await this.onEvent(event);
    });

    this.bot.callbackQuery('pf:test', async (ctx) => {
      await ctx.answerCallbackQuery();
      const event = this.syntheticEvent(ctx, '/pf test');
      if (event) await this.onEvent(event);
    });

    this.bot.callbackQuery('pf:back', async (ctx) => {
      await ctx.answerCallbackQuery();
      const binding = this.deps?.getBinding(String(ctx.chatId));
      const keyboard = new InlineKeyboard()
        .text('📋 Projects', 'pf:list')
        .text('📊 Status', 'pf:status')
        .row()
        .text('🔄 New', 'pf:new')
        .text('🛑 Stop', 'pf:stop')
        .row()
        .text('📝 Diff', 'pf:diff')
        .text('✅ Commit', 'pf:commit')
        .text('🚀 PR', 'pf:pr')
        .row()
        .text('🧪 Test', 'pf:test')
        .text('❓ Help', 'pf:help');

      const boundText = binding
        ? `\nBound to: *${binding.project_id}*\nSend any message to ask.`
        : '\nNo project bound yet. Tap Projects to start.';

      await ctx.editMessageText(
        `><(((^> *PetFish Remote*${boundText}`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    });

    this.bot.callbackQuery(/^q:(.+):(\d+):(\d+)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      const [, questionId, qiStr, oiStr] = ctx.match!;
      const qi = Number(qiStr);
      const oi = Number(oiStr);

      const pending = this.pendingQuestions.get(questionId);
      if (!pending) return;

      const question = pending.questions[qi];
      if (!question) return;
      const option = question.options[oi];
      if (!option) return;

      pending.answers.set(qi, [option.label]);

      await ctx.editMessageText(
        `✅ *${question.header || question.question}*\nAnswered: *${option.label}*`,
        { parse_mode: 'Markdown' },
      );

      if (pending.answers.size >= pending.totalQuestions) {
        this.pendingQuestions.delete(questionId);
        this.chatToPendingQuestion.delete(pending.chatId);

        const answers: string[][] = pending.questions.map((_, i) => {
          return pending.answers.get(i) ?? [];
        });

        if (this.onQuestionReply) {
          this.onQuestionReply(questionId, answers);
        }
      }
    });

    this.bot.callbackQuery(/^perm:(.+):(allow|deny)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      const [, permissionId, action] = ctx.match!;
      const allowed = action === 'allow';

      await ctx.editMessageText(
        allowed ? '🔐 ✅ Permission *granted*' : '🔐 ❌ Permission *denied*',
        { parse_mode: 'Markdown' },
      );

      if (this.onPermissionReply) {
        this.onPermissionReply(permissionId, allowed);
      }
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

  public async sendTyping(chatId: string): Promise<void> {
    const id = Number(chatId);
    if (Number.isNaN(id)) return;
    await this.bot.api.sendChatAction(id, 'typing').catch(() => {});
  }

  public setQuestionReplyHandler(handler: QuestionReplyHandler): void {
    this.onQuestionReply = handler;
  }

  public setPermissionReplyHandler(handler: PermissionReplyHandler): void {
    this.onPermissionReply = handler;
  }

  public async sendQuestion(chatId: string, payload: TaskQuestionPayload): Promise<void> {
    const id = Number(chatId);
    if (Number.isNaN(id)) return;

    const pending: PendingQuestion = {
      questionId: payload.questionId,
      chatId,
      messageIds: [],
      questions: payload.questions,
      answers: new Map(),
      totalQuestions: payload.questions.length,
    };

    for (let qi = 0; qi < payload.questions.length; qi++) {
      const q = payload.questions[qi];
      const keyboard = new InlineKeyboard();

      for (let oi = 0; oi < q.options.length; oi++) {
        const opt = q.options[oi];
        keyboard.text(opt.label, `q:${payload.questionId}:${qi}:${oi}`);
        if (oi % 2 === 1) keyboard.row();
      }

      if (q.options.length % 2 === 1) keyboard.row();

      let text = `🤔 *Agent is asking (${qi + 1}/${payload.questions.length}):*\n\n`;
      if (q.header) text += `*${q.header}*\n`;
      text += q.question;
      if (q.custom) text += '\n\n💬 Or reply with your own answer.';

      const sent = await this.bot.api.sendMessage(id, text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });

      pending.messageIds.push(sent.message_id);
    }

    this.pendingQuestions.set(payload.questionId, pending);
    this.chatToPendingQuestion.set(chatId, payload.questionId);
  }

  public async sendPermission(chatId: string, _taskId: string, permissionId: string, tool: string, input: Record<string, unknown>): Promise<void> {
    const id = Number(chatId);
    if (Number.isNaN(id)) return;

    const keyboard = new InlineKeyboard()
      .text('✅ Allow', `perm:${permissionId}:allow`)
      .text('❌ Deny', `perm:${permissionId}:deny`);

    let inputSummary = '';
    if (input['command']) {
      inputSummary = `\`${String(input['command'])}\``;
    } else if (input['filePath']) {
      inputSummary = `file: \`${String(input['filePath'])}\``;
    } else {
      const keys = Object.keys(input).slice(0, 3);
      inputSummary = keys.map(k => `${k}: ${JSON.stringify(input[k]).slice(0, 60)}`).join('\n');
    }

    const text = `🔐 *Agent wants to run:*\n\n\`${tool}\`${inputSummary ? `\n${inputSummary}` : ''}`;

    await this.bot.api.sendMessage(id, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  public hasPendingQuestion(chatId: string): boolean {
    return this.chatToPendingQuestion.has(chatId);
  }

  public handleCustomTextAnswer(chatId: string, text: string): boolean {
    const questionId = this.chatToPendingQuestion.get(chatId);
    if (!questionId) return false;

    const pending = this.pendingQuestions.get(questionId);
    if (!pending) return false;

    let targetQi = -1;
    for (let i = 0; i < pending.totalQuestions; i++) {
      if (!pending.answers.has(i)) {
        targetQi = i;
        break;
      }
    }

    if (targetQi === -1) return false;

    pending.answers.set(targetQi, [text]);

    const question = pending.questions[targetQi];
    const msgId = pending.messageIds[targetQi];
    if (msgId) {
      void this.bot.api.editMessageText(
        Number(chatId), msgId,
        `✅ *${question.header || question.question}*\nAnswered: *${text}*`,
        { parse_mode: 'Markdown' },
      ).catch(() => {});
    }

    if (pending.answers.size >= pending.totalQuestions) {
      this.pendingQuestions.delete(questionId);
      this.chatToPendingQuestion.delete(chatId);

      const answers: string[][] = pending.questions.map((_, i) => {
        return pending.answers.get(i) ?? [];
      });

      if (this.onQuestionReply) {
        this.onQuestionReply(questionId, answers);
      }
    }

    return true;
  }
}
