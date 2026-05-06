import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { hostname } from 'node:os';

import { parse } from 'yaml';
import { z } from 'zod';

const agentSchema = z.enum(['auto', 'opencode', 'gemini', 'codex']).default('auto');

const projectSchema = z.object({
  id: z.string(),
  path: z.string(),
  opencodeBin: z.string().default('opencode'),
  agent: agentSchema,
});

const configSchema = z.object({
  connectorId: z.string().default('auto'),
  serverUrl: z.string(),
  token: z.string(),
  reconnectIntervalMs: z.number().default(5000),
  maxReconnectIntervalMs: z.number().default(60000),
  projects: z.array(projectSchema),
});

export type ConnectorConfig = z.infer<typeof configSchema>;
export type ConnectorProjectConfig = z.infer<typeof projectSchema>;

export function loadConnectorConfig(configPath?: string): ConnectorConfig {
  const filePath = configPath ?? resolve(process.cwd(), 'connector.yaml');
  if (!existsSync(filePath)) {
    throw new Error(`Connector config not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  const parsed: unknown = parse(raw);
  const config = configSchema.parse(parsed);

  if (config.connectorId === 'auto') {
    const host = hostname().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const projectSuffix = config.projects.length === 1
      ? config.projects[0].id
      : basename(process.cwd());
    config.connectorId = `${host}-${projectSuffix}`;
  }

  return config;
}
