import { loadConnectorConfig, type ConnectorProjectConfig } from './connectorConfig.js';
import { ConnectorClient } from './ConnectorClient.js';
import { LocalTaskExecutor } from './LocalTaskExecutor.js';

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
const client = new ConnectorClient(config, executor);

process.once('SIGINT', () => {
  console.log('Shutting down connector...');
  client.stop();
});
process.once('SIGTERM', () => {
  console.log('Shutting down connector...');
  client.stop();
});

console.log(`PetFish Connector starting (${config.connectorId}, ${config.projects.length} projects)`);
client.start();
