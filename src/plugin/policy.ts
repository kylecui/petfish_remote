import type { ExecutionMode } from '../types.js';

export interface ToolPolicy {
  blocked: string[];
  requireApproval: string[];
}

export interface PermissionPolicy {
  autoAllow: string[];
  autoDeny: string[];
}

export interface PetfishPolicy {
  version: 1;
  mode: ExecutionMode;
  userId?: string;
  projectId?: string;
  connectorId?: string;
  tools: ToolPolicy;
  permissions: PermissionPolicy;
  context?: {
    systemPromptSuffix?: string;
  };
}

export interface WritePolicyOptions {
  projectDir: string;
  mode: ExecutionMode;
  userId?: string;
  projectId?: string;
  connectorId?: string;
  systemPromptSuffix?: string;
}

export function buildPolicy(opts: WritePolicyOptions): PetfishPolicy {
  return {
    version: 1,
    mode: opts.mode,
    userId: opts.userId,
    projectId: opts.projectId,
    connectorId: opts.connectorId,
    tools: {
      blocked: [],
      requireApproval: ['bash', 'shell'],
    },
    permissions: {
      autoAllow: ['read', 'glob', 'grep', 'lsp_diagnostics'],
      autoDeny: [],
    },
    context: opts.systemPromptSuffix
      ? { systemPromptSuffix: opts.systemPromptSuffix }
      : undefined,
  };
}
