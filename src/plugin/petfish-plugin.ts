/**
 * PetFish opencode plugin — runs INSIDE opencode's Bun runtime.
 *
 * This file is self-contained: it cannot import from petfish_remote's codebase.
 * The connector copies this file into target project's `plugins/` directory.
 * It reads policy from `.petfish/policy.json` in the project root.
 *
 * @module petfish-plugin
 */

type ExecutionMode = 'read_only' | 'suggest' | 'edit_guarded' | 'execute_guarded' | 'admin';

interface ToolPolicy {
  blocked: string[];
  requireApproval: string[];
}

interface PermissionPolicy {
  autoAllow: string[];
  autoDeny: string[];
}

interface PetfishPolicy {
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

type PluginFn = (input: { directory: string; [k: string]: unknown }) => Promise<Record<string, unknown>>;

const DEFAULT_POLICY: PetfishPolicy = {
  version: 1,
  mode: 'edit_guarded',
  tools: {
    blocked: [],
    requireApproval: ['bash', 'shell'],
  },
  permissions: {
    autoAllow: ['read', 'glob', 'grep', 'lsp_diagnostics'],
    autoDeny: [],
  },
};

const MODE_TOOL_OVERRIDES: Record<ExecutionMode, Partial<ToolPolicy>> = {
  read_only: {
    blocked: ['bash', 'shell', 'write', 'edit', 'patch'],
    requireApproval: [],
  },
  suggest: {
    blocked: ['bash', 'shell'],
    requireApproval: ['write', 'edit', 'patch'],
  },
  edit_guarded: {
    blocked: [],
    requireApproval: ['bash', 'shell'],
  },
  execute_guarded: {
    blocked: [],
    requireApproval: [],
  },
  admin: {
    blocked: [],
    requireApproval: [],
  },
};

const MODE_PERMISSION_OVERRIDES: Record<ExecutionMode, Partial<PermissionPolicy>> = {
  read_only: {
    autoAllow: ['read', 'glob', 'grep', 'lsp_diagnostics'],
    autoDeny: ['write', 'edit', 'bash', 'shell', 'patch'],
  },
  suggest: {
    autoAllow: ['read', 'glob', 'grep', 'lsp_diagnostics'],
    autoDeny: ['bash', 'shell'],
  },
  edit_guarded: {
    autoAllow: ['read', 'glob', 'grep', 'lsp_diagnostics', 'write', 'edit', 'patch'],
    autoDeny: [],
  },
  execute_guarded: {
    autoAllow: ['read', 'glob', 'grep', 'lsp_diagnostics', 'write', 'edit', 'patch', 'bash', 'shell'],
    autoDeny: [],
  },
  admin: {
    autoAllow: [],
    autoDeny: [],
  },
};

function resolvePolicy(raw: PetfishPolicy): PetfishPolicy {
  const toolOverrides = MODE_TOOL_OVERRIDES[raw.mode];
  const permOverrides = MODE_PERMISSION_OVERRIDES[raw.mode];
  return {
    ...raw,
    tools: {
      blocked: toolOverrides?.blocked ?? raw.tools.blocked,
      requireApproval: toolOverrides?.requireApproval ?? raw.tools.requireApproval,
    },
    permissions: {
      autoAllow: permOverrides?.autoAllow ?? raw.permissions.autoAllow,
      autoDeny: permOverrides?.autoDeny ?? raw.permissions.autoDeny,
    },
  };
}

async function loadPolicy(directory: string): Promise<PetfishPolicy> {
  const policyPath = `${directory}/.petfish/policy.json`;
  try {
    const file = Bun.file(policyPath);
    if (await file.exists()) {
      const raw = (await file.json()) as PetfishPolicy;
      return resolvePolicy(raw);
    }
  } catch (err) {
    console.warn(`[petfish-plugin] Failed to read policy at ${policyPath}:`, err);
  }
  return resolvePolicy(DEFAULT_POLICY);
}

const plugin: PluginFn = async (input) => {
  const policy = await loadPolicy(input.directory);
  console.log(`[petfish-plugin] Loaded policy: mode=${policy.mode} project=${policy.projectId ?? 'unknown'}`);

  return {
    'tool.execute.before': async ({ tool }: { tool: { name: string } }, output: Record<string, unknown>) => {
      const toolName = tool.name;

      if (policy.tools.blocked.some((t) => toolName.includes(t))) {
        output.abort = true;
        output.metadata = {
          ...((output.metadata as Record<string, unknown>) ?? {}),
          petfish_blocked: true,
          petfish_reason: `Tool "${toolName}" blocked by PetFish policy (mode: ${policy.mode})`,
        };
        console.log(`[petfish-plugin] BLOCKED tool: ${toolName}`);
        return;
      }

      if (policy.tools.requireApproval.some((t) => toolName.includes(t))) {
        output.metadata = {
          ...((output.metadata as Record<string, unknown>) ?? {}),
          petfish_requires_approval: true,
        };
        console.log(`[petfish-plugin] Tool requires approval: ${toolName}`);
      }
    },

    'tool.execute.after': async ({ tool }: { tool: { name: string } }) => {
      console.log(`[petfish-plugin] Tool completed: ${tool.name}`);
    },

    'permission.ask': async ({ permission }: { permission: { type?: string } }, output: Record<string, unknown>) => {
      const permType = permission.type ?? '';

      if (policy.permissions.autoAllow.some((p) => permType.includes(p))) {
        output.allow = true;
        console.log(`[petfish-plugin] AUTO-ALLOW permission: ${permType}`);
        return;
      }

      if (policy.permissions.autoDeny.some((p) => permType.includes(p))) {
        output.allow = false;
        console.log(`[petfish-plugin] AUTO-DENY permission: ${permType}`);
        return;
      }
    },

    'experimental.chat.system.transform': async (_input: unknown, output: { system?: string }) => {
      const suffix = policy.context?.systemPromptSuffix;
      if (suffix && output.system) {
        output.system = `${output.system}\n\n${suffix}`;
      }
    },

    tool: {
      petfish_status: {
        description: 'Get current PetFish Remote execution policy and status',
        parameters: {},
        execute: async () => ({
          mode: policy.mode,
          userId: policy.userId ?? 'unknown',
          projectId: policy.projectId ?? 'unknown',
          connectorId: policy.connectorId ?? 'unknown',
          blockedTools: policy.tools.blocked,
          autoAllowPermissions: policy.permissions.autoAllow,
          autoDenyPermissions: policy.permissions.autoDeny,
        }),
      },
    },
  };
};

export default { id: 'petfish', server: plugin };
