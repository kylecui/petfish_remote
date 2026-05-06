import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostname } from 'node:os';

import { loadConnectorConfig } from '../src/connector/connectorConfig.js';

function writeTempConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pf-test-'));
  const filePath = join(dir, 'connector.yaml');
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

const tempFiles: string[] = [];

afterEach(() => {
  for (const f of tempFiles) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
  tempFiles.length = 0;
});

describe('connectorConfig — agent field', () => {
  it('defaults agent to "auto" when omitted from project config', () => {
    const yaml = `
serverUrl: "wss://remote.petfish.ai"
token: "test-token-123"
projects:
  - id: my-project
    path: /tmp/project
`;
    const filePath = writeTempConfig(yaml);
    tempFiles.push(filePath);

    const config = loadConnectorConfig(filePath);
    expect(config.projects[0].agent).toBe('auto');
  });

  it('accepts agent="opencode"', () => {
    const yaml = `
serverUrl: "wss://remote.petfish.ai"
token: "test-token-123"
projects:
  - id: my-project
    path: /tmp/project
    agent: opencode
`;
    const filePath = writeTempConfig(yaml);
    tempFiles.push(filePath);

    const config = loadConnectorConfig(filePath);
    expect(config.projects[0].agent).toBe('opencode');
  });

  it('accepts agent="gemini"', () => {
    const yaml = `
serverUrl: "wss://remote.petfish.ai"
token: "test-token-123"
projects:
  - id: my-project
    path: /tmp/project
    agent: gemini
`;
    const filePath = writeTempConfig(yaml);
    tempFiles.push(filePath);

    const config = loadConnectorConfig(filePath);
    expect(config.projects[0].agent).toBe('gemini');
  });

  it('accepts agent="codex"', () => {
    const yaml = `
serverUrl: "wss://remote.petfish.ai"
token: "test-token-123"
projects:
  - id: my-project
    path: /tmp/project
    agent: codex
`;
    const filePath = writeTempConfig(yaml);
    tempFiles.push(filePath);

    const config = loadConnectorConfig(filePath);
    expect(config.projects[0].agent).toBe('codex');
  });

  it('throws zod validation error for invalid agent value', () => {
    const yaml = `
serverUrl: "wss://remote.petfish.ai"
token: "test-token-123"
projects:
  - id: my-project
    path: /tmp/project
    agent: claude
`;
    const filePath = writeTempConfig(yaml);
    tempFiles.push(filePath);

    expect(() => loadConnectorConfig(filePath)).toThrow();
  });
});

describe('connectorConfig — connectorId auto resolution', () => {
  it('resolves connectorId "auto" using hostname and single project id', () => {
    const yaml = `
connectorId: auto
serverUrl: "wss://remote.petfish.ai"
token: "test-token-123"
projects:
  - id: cool-project
    path: /tmp/project
`;
    const filePath = writeTempConfig(yaml);
    tempFiles.push(filePath);

    const config = loadConnectorConfig(filePath);
    const expectedHost = hostname().toLowerCase().replace(/[^a-z0-9-]/g, '');
    expect(config.connectorId).toBe(`${expectedHost}-cool-project`);
  });

  it('defaults connectorId to "auto" when field is omitted and resolves it', () => {
    const yaml = `
serverUrl: "wss://remote.petfish.ai"
token: "test-token-123"
projects:
  - id: alpha
    path: /tmp/alpha
`;
    const filePath = writeTempConfig(yaml);
    tempFiles.push(filePath);

    const config = loadConnectorConfig(filePath);
    const expectedHost = hostname().toLowerCase().replace(/[^a-z0-9-]/g, '');
    expect(config.connectorId).toBe(`${expectedHost}-alpha`);
  });
});

describe('connectorConfig — missing config file', () => {
  it('throws when config file does not exist', () => {
    expect(() => loadConnectorConfig('/nonexistent/path/connector.yaml')).toThrow(
      /Connector config not found/,
    );
  });
});
