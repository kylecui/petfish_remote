import { loadConnectorConfig, type ConnectorProjectConfig } from './connectorConfig.js';
import { ConnectorClient } from './ConnectorClient.js';
import { LocalTaskExecutor } from './LocalTaskExecutor.js';
import { SessionBridge } from './SessionBridge.js';

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

let sessionBridge: SessionBridge | undefined;

async function start() {
  if (process.env['OPENCODE_PID']) {
    sessionBridge = new SessionBridge({});
    try {
      await sessionBridge.init();
      console.log('SessionBridge mode: routing tasks to active opencode session');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`SessionBridge init failed (${msg}), falling back to process spawn mode`);
      sessionBridge = undefined;
    }
  }

  const client = new ConnectorClient(config!, executor, sessionBridge);

  process.once('SIGINT', () => {
    console.log('Shutting down connector...');
    sessionBridge?.stop();
    client.stop();
  });
  process.once('SIGTERM', () => {
    console.log('Shutting down connector...');
    sessionBridge?.stop();
    client.stop();
  });

  console.log(`PetFish Connector starting (${config!.connectorId}, ${config!.projects.length} projects)`);
  client.start();
}

start();
