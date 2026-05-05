import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'yaml';
import { z } from 'zod';

const projectSchema = z.object({
  id: z.string(),
  path: z.string(),
  opencodeBin: z.string().default('opencode'),
});

const configSchema = z.object({
  connectorId: z.string(),
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
  return configSchema.parse(parsed);
}
