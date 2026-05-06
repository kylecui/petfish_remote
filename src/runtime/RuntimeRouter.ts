import type { RuntimeConfig } from '../types.js';
import type { RuntimeConnector } from './RuntimeConnector.js';

export class RuntimeRouter {
  private readonly connectors: Map<string, RuntimeConnector>;

  public constructor(_runtimes: RuntimeConfig[]) {
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
    this.connectors.set(id, connector);
  }
}
