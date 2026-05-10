import { mkdirSync, copyFileSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPolicy, type WritePolicyOptions, type PetfishPolicy } from './policy.js';

const PLUGIN_FILENAME = 'petfish-plugin.ts';
const POLICY_DIR = '.petfish';
const POLICY_FILENAME = 'policy.json';

function getPluginSourcePath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(dirname(thisFile), PLUGIN_FILENAME);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function installPlugin(projectDir: string): boolean {
  const pluginsDir = join(projectDir, 'plugins');
  const dest = join(pluginsDir, PLUGIN_FILENAME);
  const src = getPluginSourcePath();

  if (!existsSync(src)) {
    console.warn(`[plugin-installer] Plugin source not found at ${src}`);
    return false;
  }

  if (existsSync(dest)) {
    const srcContent = readFileSync(src, 'utf-8');
    const destContent = readFileSync(dest, 'utf-8');
    if (srcContent === destContent) {
      return true;
    }
  }

  ensureDir(pluginsDir);
  copyFileSync(src, dest);
  console.log(`[plugin-installer] Installed plugin to ${dest}`);
  return true;
}

export function writePolicy(opts: WritePolicyOptions): PetfishPolicy {
  const policyDir = join(opts.projectDir, POLICY_DIR);
  const policyPath = join(policyDir, POLICY_FILENAME);
  const policy = buildPolicy(opts);

  ensureDir(policyDir);
  writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n', 'utf-8');
  console.log(`[plugin-installer] Wrote policy to ${policyPath} (mode=${policy.mode})`);
  return policy;
}

export function installPluginAndPolicy(opts: WritePolicyOptions): { installed: boolean; policy: PetfishPolicy | null } {
  const installed = installPlugin(opts.projectDir);
  if (!installed) {
    return { installed: false, policy: null };
  }
  const policy = writePolicy(opts);
  return { installed: true, policy };
}
