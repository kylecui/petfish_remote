import type { OutputStream } from '../runtime/RuntimeConnector.js';
import type { ExecutionMode, SubAgentVerbosity } from '../types.js';

export interface RunParams {
  projectPath: string;
  projectId?: string;
  instruction: string;
  mode: ExecutionMode;
  subAgentVerbosity?: SubAgentVerbosity;
  sessionId?: string;
  timeoutSeconds?: number;
  onOutput?: (chunk: string, stream: OutputStream) => void;
}

export interface RunResult {
  output: string;
  exitCode: number;
  sessionId?: string;
  files?: Array<{ file: string; additions: number; deletions: number }>;
}

export interface OpenCodeRunner {
  run(params: RunParams): Promise<RunResult>;
  stop(taskId: string): Promise<void>;
}
