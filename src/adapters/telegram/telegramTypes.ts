import type { Context } from 'grammy';

import type { ChatEvent } from '../../types.js';

export interface TelegramAdapterConfig {
  token: string;
  allowedChatIds?: string[];
}

export function telegramContextToChatEvent(ctx: Context): ChatEvent | undefined {
  const message = ctx.message;
  if (!message || !('text' in message)) {
    return undefined;
  }
  if (typeof message.text !== 'string') {
    return undefined;
  }

  const attachments: string[] = [];
  if ('photo' in message && Array.isArray(message.photo) && message.photo.length > 0) {
    attachments.push(...message.photo.map((photo) => photo.file_id));
  }
  if ('document' in message && message.document) {
    attachments.push(message.document.file_id);
  }

  return {
    platform: 'telegram',
    chat_id: String(message.chat.id),
    user_id: String(message.from?.id ?? ''),
    username: message.from?.username ?? '',
    message_id: String(message.message_id),
    text: message.text,
    attachments,
    timestamp: new Date(message.date * 1000).toISOString(),
  };
}
