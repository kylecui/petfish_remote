import type { TaskQuestionPayload, TaskPermissionPayload } from '../../protocol/connectorProtocol.js';

export type OutputCallback = (taskId: string, stream: 'stdout' | 'stderr', chunk: string) => void;
export interface FileChange {
  file: string;
  additions: number;
  deletions: number;
}

export type CompleteCallback = (taskId: string, exitCode: number, stdout: string, stderr: string, startedAt: string, finishedAt: string, files?: FileChange[]) => void;
export type FailCallback = (taskId: string, error: string) => void;
export type QuestionCallback = (taskId: string, payload: TaskQuestionPayload) => void;
export type PermissionCallback = (taskId: string, payload: TaskPermissionPayload) => void;

export type AgentType = 'opencode' | 'gemini' | 'codex';

export interface SessionInfo {
  id: string;
  slug: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

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
  listSessions(): Promise<SessionInfo[]>;
  switchSession(sessionId: string): Promise<void>;

  setQuestionCallback(cb: QuestionCallback): void;
  setPermissionCallback(cb: PermissionCallback): void;
  answerQuestion(questionId: string, answers: string[][]): void;
  answerPermission(permissionId: string, allowed: boolean): void;
}

export interface BridgeConfig {
  agent?: 'auto' | AgentType;
  cwd?: string;
}

export async function createBridge(config: BridgeConfig): Promise<AgentBridge | undefined> {
  const agent = config.agent ?? 'auto';
  const cwd = config.cwd ?? process.cwd();

  if (agent === 'opencode' || agent === 'auto') {
    if (process.env['OPENCODE_PID'] || agent === 'opencode') {
      const { OpenCodeBridge } = await import('./OpenCodeBridge.js');
      const bridge = new OpenCodeBridge({ cwd });
      await bridge.init();
      return bridge;
    }
    try {
      const { OpenCodeBridge } = await import('./OpenCodeBridge.js');
      const bridge = new OpenCodeBridge({ cwd });
      await bridge.init();
      return bridge;
    } catch { /* no opencode found in auto mode, continue */ }
  }

  if (agent === 'gemini') {
    const { GeminiBridge } = await import('./GeminiBridge.js');
    const bridge = new GeminiBridge({ cwd });
    await bridge.init();
    return bridge;
  }

  if (agent === 'codex') {
    const { CodexBridge } = await import('./CodexBridge.js');
    const bridge = new CodexBridge({ cwd });
    await bridge.init();
    return bridge;
  }

  return undefined;
}
