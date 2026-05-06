import type { TaskQuestionPayload, TaskPermissionPayload } from '../../protocol/connectorProtocol.js';

export type OutputCallback = (taskId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
export type CompleteCallback = (taskId: string, exitCode: number, stdout: string, stderr: string, startedAt: string, finishedAt: string) => void;
export type FailCallback = (taskId: string, error: string) => void;
export type QuestionCallback = (taskId: string, payload: TaskQuestionPayload) => void;
export type PermissionCallback = (taskId: string, payload: TaskPermissionPayload) => void;

export type AgentType = 'opencode' | 'gemini' | 'codex';

export interface AgentBridge {
  readonly agentType: AgentType;

  init(): Promise<void>;
  stop(): void;

  prompt(
    taskId: string,
    instruction: string,
    onOutput: OutputCallback,
    onComplete: CompleteCallback,
    onFail: FailCallback,
  ): boolean;

  cancel(taskId: string): void;
  requestNewSession(): Promise<void>;

  setQuestionCallback(cb: QuestionCallback): void;
  setPermissionCallback(cb: PermissionCallback): void;
  answerQuestion(questionId: string, answers: string[][]): void;
  answerPermission(permissionId: string, allowed: boolean): void;
}

export interface BridgeConfig {
  agent?: 'auto' | AgentType;
}

export async function createBridge(config: BridgeConfig): Promise<AgentBridge | undefined> {
  const agent = config.agent ?? 'auto';

  if (agent === 'opencode' || agent === 'auto') {
    if (process.env['OPENCODE_PID'] || agent === 'opencode') {
      const { OpenCodeBridge } = await import('./OpenCodeBridge.js');
      const bridge = new OpenCodeBridge({});
      await bridge.init();
      return bridge;
    }
  }

  if (agent === 'gemini') {
    throw new Error('Gemini bridge not yet implemented');
  }

  if (agent === 'codex') {
    throw new Error('Codex bridge not yet implemented');
  }

  return undefined;
}
