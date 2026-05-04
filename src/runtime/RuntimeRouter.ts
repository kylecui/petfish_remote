import type { RuntimeConfig } from '../types.js';
import type { RuntimeConnector } from './RuntimeConnector.js';

export class RuntimeRouter {
  private readonly runtimeConfigs: Map<string, RuntimeConfig>;
  private readonly connectors: Map<string, RuntimeConnector>;

  public constructor(runtimes: RuntimeConfig[]) {
    this.runtimeConfigs = new Map(runtimes.map((runtime) => [runtime.id, runtime]));
    this.connectors = new Map();
  }

  public getConnector(runtimeId: string): RuntimeConnector {
    const connector = this.connectors.get(runtimeId);
    if (!connector) {
      throw new Error(`Runtime connector not registered: ${runtimeId}`);
    }
    return connector;
  }

  public registerConnector(id: string, connector: RuntimeConnector): void {
    const runtime = this.runtimeConfigs.get(id);
    if (!runtime) {
      throw new Error(`Unknown runtime id: ${id}`);
    }
    this.connectors.set(id, connector);
  }
}
