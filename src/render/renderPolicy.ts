export interface MessageRenderPolicy {
  readonly maxLength: number;
  formatHeader(projectLabel: string): string;
  formatCompletion(taskId: string, projectLabel: string | undefined, totalChars: number, messageCount: number, exitCode: number): string;
  formatError(taskId: string, projectLabel: string | undefined, error: string): string;
  formatSubAgentSummary(summary: string): string;
  formatSubAgentError(agentName: string, error: string): string;
  truncate(text: string): string;
}

export const telegramRenderPolicy: MessageRenderPolicy = {
  maxLength: 4096,

  formatHeader(projectLabel: string): string {
    return `📂 *${projectLabel}*\n`;
  },

  formatCompletion(taskId, projectLabel, totalChars, messageCount, exitCode): string {
    const status = exitCode === 0 ? '✅ completed' : '❌ failed';
    const prefix = projectLabel ? `📂 *${projectLabel}* · ` : '';
    return `${prefix}Task \`${taskId}\` ${status} (${totalChars} chars, ${messageCount} messages)`;
  },

  formatError(taskId, projectLabel, error): string {
    const prefix = projectLabel ? `📂 *${projectLabel}* · ` : '';
    return `${prefix}Task \`${taskId}\` ❌ error: ${error}`;
  },

  formatSubAgentSummary(summary: string): string {
    return summary;
  },

  formatSubAgentError(agentName: string, error: string): string {
    return `⚠️ Sub-agent failed: ${agentName} — ${error}`;
  },

  truncate(text: string): string {
    if (text.length > 4096 - 50) {
      return text.slice(0, 4096 - 50) + '\n...(truncated)';
    }
    return text;
  },
};
