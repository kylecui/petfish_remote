import type { WebSocket } from 'ws';

export interface ConnectorInfo {
  connectorId: string;
  hostname: string;
  projects: Array<{ id: string; path: string; opencodeAvailable: boolean }>;
  connectedAt: string;
  ws: WebSocket;
  userId?: string;
}

export interface PendingReconnect {
  connectorId: string;
  hostname: string;
  projects: Array<{ id: string; path: string; opencodeAvailable: boolean }>;
  connectedAt: string;
  disconnectedAt: number;
  timer: NodeJS.Timeout;
}

const GRACE_WINDOW_MS = 60_000;

export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorInfo>();
  private readonly pendingReconnects = new Map<string, PendingReconnect>();

  public register(info: ConnectorInfo): void {
    const existing = this.connectors.get(info.connectorId);
    if (existing && existing.ws !== info.ws) {
      existing.ws.close(1000, 'Replaced by new connection');
    }

    const pending = this.pendingReconnects.get(info.connectorId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingReconnects.delete(info.connectorId);
      console.log(`Connector ${info.connectorId} reconnected within grace window`);
    }

    this.connectors.set(info.connectorId, info);
  }

  public startGraceWindow(connectorId: string, onExpire: () => void): void {
    const info = this.connectors.get(connectorId);
    if (!info) return;

    this.connectors.delete(connectorId);

    const timer = setTimeout(() => {
      this.pendingReconnects.delete(connectorId);
      console.log(`Grace window expired for ${connectorId}`);
      onExpire();
    }, GRACE_WINDOW_MS);

    this.pendingReconnects.set(connectorId, {
      connectorId: info.connectorId,
      hostname: info.hostname,
      projects: info.projects,
      connectedAt: info.connectedAt,
      disconnectedAt: Date.now(),
      timer,
    });
  }

  public isReconnecting(connectorId: string): boolean {
    return this.pendingReconnects.has(connectorId);
  }

  public unregister(connectorId: string): void {
    this.connectors.delete(connectorId);
    const pending = this.pendingReconnects.get(connectorId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingReconnects.delete(connectorId);
    }
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

  public findPendingByProject(projectId: string): PendingReconnect | undefined {
    for (const pending of this.pendingReconnects.values()) {
      if (pending.projects.some((p) => p.id === projectId)) {
        return pending;
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
