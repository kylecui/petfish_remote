import type { ExecutionMode } from '../types.js';

export interface RunParams {
  projectPath: string;
  instruction: string;
  mode: ExecutionMode;
  sessionId?: string;
  timeoutSeconds?: number;
}

export interface RunResult {
  output: string;
  exitCode: number;
  sessionId?: string;
}

export interface OpenCodeRunner {
  run(params: RunParams): Promise<RunResult>;
  stop(taskId: string): Promise<void>;
}
