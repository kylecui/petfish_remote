import type { ExecutionMode } from '../types.js';

export interface BuildTaskPromptParams {
  project_name: string;
  project_path: string;
  mode: ExecutionMode;
  instruction: string;
}

export class PromptBuilder {
  public buildTaskPrompt(params: BuildTaskPromptParams): string {
    return [
      'You are OpenCode, operating under PetFish Remote.',
      `Project: ${params.project_name}`,
      `Path: ${params.project_path}`,
      `Mode: ${params.mode}`,
      'Instruction:',
      params.instruction,
      'Constraints: follow project rules, keep changes minimal, and report result clearly.',
    ].join('\n');
  }
}
