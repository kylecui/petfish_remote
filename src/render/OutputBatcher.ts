import type { MessageRenderPolicy } from './renderPolicy.js';
import { telegramRenderPolicy } from './renderPolicy.js';

const DEFAULT_FLUSH_INTERVAL_MS = 3000;
const DEFAULT_MAX_BUFFER_SIZE = 3000;

export type SendFn = (text: string, plain?: boolean) => Promise<void>;

export class OutputBatcher {
  private buffer = '';
  private flushTimer: NodeJS.Timeout | undefined;
  private messageCount = 0;
  private totalChars = 0;
  private finished = false;
  private firstFlush = true;

  public constructor(
    private readonly sendFn: SendFn,
    private readonly taskId: string,
    private readonly flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    private readonly maxBufferSize = DEFAULT_MAX_BUFFER_SIZE,
    private readonly projectLabel?: string,
    private readonly policy: MessageRenderPolicy = telegramRenderPolicy,
  ) {}

  public append(chunk: string): void {
    if (this.finished) return;
    this.buffer += chunk;
    this.totalChars += chunk.length;

    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, this.flushIntervalMs);
    }
  }

  public async complete(exitCode: number): Promise<void> {
    this.finished = true;
    this.clearTimer();

    if (this.buffer.length > 0) {
      await this.flush();
    }

    const text = this.policy.formatCompletion(this.taskId, this.projectLabel, this.totalChars, this.messageCount, exitCode);
    try {
      await this.sendFn(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to send completion for task ${this.taskId}: ${msg}`);
    }
  }

  public async fail(error: string): Promise<void> {
    this.finished = true;
    this.clearTimer();

    if (this.buffer.length > 0) {
      await this.flush();
    }

    const text = this.policy.formatError(this.taskId, this.projectLabel, error);
    try {
      await this.sendFn(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to send error for task ${this.taskId}: ${msg}`);
    }
  }

  public dispose(): void {
    this.finished = true;
    this.clearTimer();
  }

  private async flush(): Promise<void> {
    this.clearTimer();
    if (this.buffer.length === 0) return;

    let text = this.policy.truncate(this.buffer);

    if (this.firstFlush && this.projectLabel) {
      text = this.policy.formatHeader(this.projectLabel) + text;
      this.firstFlush = false;
    }

    this.buffer = '';
    this.messageCount++;

    try {
      await this.sendFn(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to send batched output for task ${this.taskId}: ${msg}`);
    }
  }

  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }
}
