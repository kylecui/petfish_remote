import type { WebSocket } from 'ws';

export interface ConnectorInfo {
  connectorId: string;
  hostname: string;
  projects: Array<{ id: string; path: string; opencodeAvailable: boolean }>;
  connectedAt: string;
  ws: WebSocket;
}

export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorInfo>();

  public register(info: ConnectorInfo): void {
    const existing = this.connectors.get(info.connectorId);
    if (existing && existing.ws !== info.ws) {
      existing.ws.close(1000, 'Replaced by new connection');
    }
    this.connectors.set(info.connectorId, info);
  }

  public unregister(connectorId: string): void {
    this.connectors.delete(connectorId);
  }

  public get(connectorId: string): ConnectorInfo | undefined {
    return this.connectors.get(connectorId);
  }

  public findByProject(projectId: string): ConnectorInfo | undefined {
    for (const info of this.connectors.values()) {
      if (info.projects.some((p) => p.id === projectId)) {
        return info;
      }
    }
    return undefined;
  }

  public list(): ConnectorInfo[] {
    return [...this.connectors.values()];
  }

  public removeBySocket(ws: WebSocket): string | undefined {
    for (const [id, info] of this.connectors.entries()) {
      if (info.ws === ws) {
        this.connectors.delete(id);
        return id;
      }
    }
    return undefined;
  }
}
