import type { RuntimeConnector } from '../runtime/RuntimeConnector.js';
import { buildCommand } from '../utils/shell.js';
import type { OpenCodeRunner, RunParams, RunResult } from './OpenCodeRunner.js';
import { PromptBuilder } from './PromptBuilder.js';

export class OpenCodeCliRunner implements OpenCodeRunner {
  private readonly promptBuilder = new PromptBuilder();

  public constructor(private readonly runtime: RuntimeConnector, private readonly opencodeBin = 'opencode') {}

  public async run(params: RunParams): Promise<RunResult> {
    const prompt = this.promptBuilder.buildTaskPrompt({
      project_name: params.projectPath,
      project_path: params.projectPath,
      mode: params.mode,
      instruction: params.instruction,
    });

    const command = buildCommand(this.opencodeBin, ['run', prompt]);
    const result = await this.runtime.run({
      cwd: params.projectPath,
      command,
      timeoutSeconds: params.timeoutSeconds,
      taskId: params.sessionId,
      projectId: params.projectId,
      onOutput: params.onOutput,
    });

    return {
      output: [result.stdout, result.stderr].filter((part) => part.length > 0).join('\n'),
      exitCode: result.exitCode,
      sessionId: params.sessionId,
    };
  }

  public async stop(taskId: string): Promise<void> {
    await this.runtime.stop(taskId);
  }
}
