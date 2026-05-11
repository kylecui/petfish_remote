import type { MessageRenderPolicy } from '../../render/renderPolicy.js';

export const feishuRenderPolicy: MessageRenderPolicy = {
  maxLength: 30000,

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

  formatSubAgentSummary(summary: string): string {
    return summary;
  },

  formatSubAgentError(agentName: string, error: string): string {
    return `⚠️ Sub-agent failed: ${agentName} — ${error}`;
  },

  truncate(text: string): string {
    if (text.length > 30000 - 100) {
      return text.slice(0, 30000 - 100) + '\n...(truncated)';
    }
    return text;
  },
};
