import { loadConnectorConfig, type ConnectorProjectConfig } from './connectorConfig.js';
import { ConnectorClient } from './ConnectorClient.js';
import { LocalTaskExecutor } from './LocalTaskExecutor.js';
import { createBridge, type AgentBridge } from './bridges/index.js';
import * as fs from 'node:fs';

// --log-file: redirect stdout/stderr to file (enables detached process on Windows)
const logFileIdx = process.argv.indexOf('--log-file');
if (logFileIdx !== -1 && process.argv[logFileIdx + 1]) {
  const logPath = process.argv[logFileIdx + 1];
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  process.stdout.write = logStream.write.bind(logStream);
  process.stderr.write = logStream.write.bind(logStream);
  process.argv.splice(logFileIdx, 2);
}

const configPath = process.argv[2] ?? undefined;

let config;
try {
  config = loadConnectorConfig(configPath);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Failed to load connector config: ${msg}`);
  process.exit(1);
}

const projectMap = new Map<string, ConnectorProjectConfig>(config.projects.map((p) => [p.id, p]));
const executor = new LocalTaskExecutor(projectMap);

const bridges = new Map<string, AgentBridge>();

async function start() {
  for (const project of config!.projects) {
    try {
      const bridge = await createBridge({ agent: project.agent, cwd: project.path });
      if (bridge) {
        bridges.set(project.id, bridge);
        console.log(`[${project.id}] ${bridge.agentType} bridge active`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${project.id}] bridge init failed (${msg}), using process spawn`);
    }
  }

  const client = new ConnectorClient(config!, executor, bridges);

  const shutdown = (reason: string) => {
    console.log(`Shutting down connector: ${reason}`);
    for (const bridge of bridges.values()) bridge.stop();
    client.stop();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err) => {
    console.error(`[FATAL] Uncaught exception: ${err.message}`);
    console.error(err.stack);
    shutdown(`uncaughtException: ${err.message}`);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error(`[FATAL] Unhandled rejection: ${msg}`);
    shutdown(`unhandledRejection: ${msg}`);
    process.exit(1);
  });

  console.log(`PetFish Connector starting (${config!.connectorId}, ${config!.projects.length} projects, ${bridges.size} bridges)`);
  client.start();
}

start();
