import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

import type { ProjectConfig, RuntimeConfig, UserConfig } from './types.js';
import { type ConnectorToken, connectorTokenSchema } from './server/ConnectorAuth.js';

const executionModeSchema = z.enum(['read_only', 'suggest', 'edit_guarded', 'execute_guarded', 'admin']);
const runtimeTypeSchema = z.enum(['local', 'wsl', 'ssh', 'hyperv', 'vmware', 'docker', 'server', 'connector']);
const runtimePathStyleSchema = z.enum(['linux', 'windows']);

const projectConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  runtime: z.string().min(1),
  path: z.string().min(1),
  default_mode: executionModeSchema,
  default_agent: z.string().min(1).optional(),
  allowed_users: z.array(z.string().min(1)),
  readme_files: z.array(z.string().min(1)).default([]),
  test_commands: z.record(z.string(), z.string()).default({}),
  risk_profile: z.string().min(1),
  secrets_policy: z.string().min(1),
});

const runtimeConfigSchema = z.object({
  id: z.string().min(1),
  type: runtimeTypeSchema,
  name: z.string().min(1),
  shell: z.string().min(1).optional(),
  working_root: z.string().min(1),
  opencode_bin: z.string().min(1).optional(),
  path_style: runtimePathStyleSchema,
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
  user: z.string().min(1).optional(),
  identity_file: z.string().min(1).optional(),
  distro: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
  container: z.string().min(1).optional(),
});

const userConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(['admin', 'operator', 'viewer']),
  allowed_projects: z.array(z.string().min(1)),
  allowed_modes: z.array(executionModeSchema),
});

/**
 * Convert a YAML map `{ key: { ...fields } }` to an array `[{ id: key, ...fields }]`.
 * Also handles: null/undefined → [], already-an-array → pass through.
 */
function mapToArray(value: unknown): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, fields]) => ({
      id: key,
      ...(typeof fields === 'object' && fields !== null ? (fields as Record<string, unknown>) : {}),
    }));
  }
  return [];
}

const mapOrArray = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => mapToArray(v), z.array(schema));

const nullableRecord = () =>
  z.preprocess((v) => v ?? {}, z.record(z.string(), z.unknown()));

const appConfigSchema = z.object({
  projects: mapOrArray(projectConfigSchema).default([]),
  policies: nullableRecord().default({}),
  adapters: nullableRecord().default({}),
  users: mapOrArray(userConfigSchema).default([]),
  runtimes: mapOrArray(runtimeConfigSchema).default([]),
  connector_tokens: mapOrArray(connectorTokenSchema).default([]),
  runtime_settings: nullableRecord().default({}),
  gateway: z.preprocess((v) => v ?? {}, z.object({
    enabled: z.boolean().default(false),
    port: z.number().default(9100),
    path: z.string().default('/ws/connector'),
    pingIntervalMs: z.number().default(15000),
  }).default({})),
});

export interface AppConfig {
  projects: ProjectConfig[];
  policies: Record<string, unknown>;
  adapters: Record<string, unknown>;
  users: UserConfig[];
  runtimes: RuntimeConfig[];
  connector_tokens: ConnectorToken[];
  runtime_settings: Record<string, unknown>;
  gateway: { enabled: boolean; port: number; path: string; pingIntervalMs: number };
}

function mergeRecords(base: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...incoming };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error('Config file root must be a YAML object');
}

export function loadConfig(configDir: string): AppConfig {
  const entries = readdirSync(configDir, { withFileTypes: true });
  const yamlFiles = entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')))
    .map((entry) => entry.name)
    .sort();

  const merged: AppConfig = {
    projects: [],
    policies: {},
    adapters: {},
    users: [],
    runtimes: [],
    connector_tokens: [],
    runtime_settings: {},
    gateway: { enabled: false, port: 9100, path: '/ws/connector', pingIntervalMs: 15000 },
  };

  for (const fileName of yamlFiles) {
    const filePath = path.join(configDir, fileName);
    const raw = readFileSync(filePath, 'utf8');
    const parsed = parse(raw);
    const candidate = appConfigSchema.parse(asObject(parsed));

    merged.projects = [...merged.projects, ...candidate.projects];
    merged.users = [...merged.users, ...candidate.users];
    merged.runtimes = [...merged.runtimes, ...candidate.runtimes];
    merged.connector_tokens = [...merged.connector_tokens, ...candidate.connector_tokens];
    merged.policies = mergeRecords(merged.policies, candidate.policies);
    merged.adapters = mergeRecords(merged.adapters, candidate.adapters);
    merged.runtime_settings = mergeRecords(merged.runtime_settings, candidate.runtime_settings);
    if (candidate.gateway.enabled) {
      merged.gateway = candidate.gateway;
    }
  }

  return merged;
}
