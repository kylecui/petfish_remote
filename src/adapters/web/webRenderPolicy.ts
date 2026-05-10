import type { MessageRenderPolicy } from '../../render/renderPolicy.js';

export const webRenderPolicy: MessageRenderPolicy = {
  maxLength: 65536,

  formatHeader(projectLabel: string): string {
    return `📂 **${projectLabel}**\n`;
  },

  formatCompletion(taskId, projectLabel, totalChars, messageCount, exitCode): string {
    const status = exitCode === 0 ? '✅ completed' : '❌ failed';
    const prefix = projectLabel ? `📂 **${projectLabel}** · ` : '';
    return `${prefix}Task \`${taskId}\` ${status} (${totalChars} chars, ${messageCount} messages)`;
  },

  formatError(taskId, projectLabel, error): string {
    const prefix = projectLabel ? `📂 **${projectLabel}** · ` : '';
    return `${prefix}Task \`${taskId}\` ❌ error: ${error}`;
  },

  truncate(text: string): string {
    if (text.length > 65536 - 50) {
      return text.slice(0, 65536 - 50) + '\n...(truncated)';
    }
    return text;
  },
};
