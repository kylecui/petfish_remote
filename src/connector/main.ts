import { loadConnectorConfig, type ConnectorProjectConfig } from './connectorConfig.js';
import { ConnectorClient } from './ConnectorClient.js';
import { LocalTaskExecutor } from './LocalTaskExecutor.js';
import { createBridge, type AgentBridge } from './bridges/index.js';

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

  process.once('SIGINT', () => {
    console.log('Shutting down connector...');
    for (const bridge of bridges.values()) bridge.stop();
    client.stop();
  });
  process.once('SIGTERM', () => {
    console.log('Shutting down connector...');
    for (const bridge of bridges.values()) bridge.stop();
    client.stop();
  });

  console.log(`PetFish Connector starting (${config!.connectorId}, ${config!.projects.length} projects, ${bridges.size} bridges)`);
  client.start();
}

start();
