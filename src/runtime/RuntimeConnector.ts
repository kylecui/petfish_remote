import type { RuntimeType } from '../types.js';
import type { SubAgentVerbosity } from '../types.js';

export type OutputStream = 'stdout' | 'stderr';

export interface RuntimeCommand {
  cwd: string;
  command: string;
  timeoutSeconds?: number;
  env?: Record<string, string>;
  taskId?: string;
  projectId?: string;
  instruction?: string;
  rawInstruction?: string;
  mode?: string;
  subAgentVerbosity?: SubAgentVerbosity;
  onOutput?: (chunk: string, stream: OutputStream) => void;
}

export interface RuntimeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  files?: Array<{ file: string; additions: number; deletions: number }>;
}

export interface RuntimeHealth {
  ok: boolean;
  runtimeId: string;
  opencodeAvailable: boolean;
  opencodeVersion?: string;
  message?: string;
}

export interface RuntimeConnector {
  id: string;
  type: RuntimeType;
  healthCheck(): Promise<RuntimeHealth>;
  run(command: RuntimeCommand): Promise<RuntimeResult>;
  stop(taskId: string): Promise<void>;
}
