import { randomBytes } from 'node:crypto';

import type { Storage } from '../storage/sqlite.js';

interface PendingToken {
  token: string;
  userId: string;
  createdAt: number;
}

export interface RegisterRequest {
  token: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  hostname: string;
}

export interface RegisterResult {
  connectorToken: string;
  projectId: string;
  serverUrl: string;
}

export class RegistrationService {
  private readonly pendingTokens = new Map<string, PendingToken>();
  private readonly tokenTtlMs = 300_000;
  private readonly connectorTokens = new Map<string, string>();
  private readonly userProjects = new Map<string, Set<string>>();
  private cleanupTimer: NodeJS.Timeout | undefined;
  private readonly storage?: Storage;

  private readonly onProjectRegistered?: (userId: string, projectId: string, projectName: string, projectPath: string) => void;

  public constructor(opts?: {
    onProjectRegistered?: (userId: string, projectId: string, projectName: string, projectPath: string) => void;
    storage?: Storage;
  }) {
    this.onProjectRegistered = opts?.onProjectRegistered;
    this.storage = opts?.storage;
    this.cleanupTimer = setInterval(() => this.pruneExpired(), 60_000);
    this.restoreFromStorage();
  }

  public generateToken(userId: string): string {
    const token = randomBytes(16).toString('hex');
    this.pendingTokens.set(token, { token, userId, createdAt: Date.now() });
    return token;
  }

  public register(req: RegisterRequest): RegisterResult | { error: string } {
    const pending = this.pendingTokens.get(req.token);
    if (!pending) {
      return { error: 'Invalid or expired token' };
    }

    if (Date.now() - pending.createdAt > this.tokenTtlMs) {
      this.pendingTokens.delete(req.token);
      return { error: 'Token expired (5 min TTL)' };
    }

    this.pendingTokens.delete(req.token);

    let connectorToken = this.connectorTokens.get(pending.userId);
    if (!connectorToken) {
      connectorToken = randomBytes(32).toString('base64url');
      this.connectorTokens.set(pending.userId, connectorToken);
      this.storage?.upsertConnectorToken(pending.userId, connectorToken);
    }

    let userProjectSet = this.userProjects.get(pending.userId);
    if (!userProjectSet) {
      userProjectSet = new Set();
      this.userProjects.set(pending.userId, userProjectSet);
    }
    userProjectSet.add(req.projectId);
    this.storage?.upsertRegisteredProject(pending.userId, req.projectId, req.projectName, req.projectPath);

    this.onProjectRegistered?.(pending.userId, req.projectId, req.projectName, req.projectPath);

    return {
      connectorToken,
      projectId: req.projectId,
      serverUrl: process.env.PETFISH_SERVER_URL ?? 'wss://remote.petfish.ai/ws/connector',
    };
  }

  public getConnectorToken(userId: string): string | undefined {
    return this.connectorTokens.get(userId);
  }

  public getUserProjects(userId: string): Set<string> {
    return this.userProjects.get(userId) ?? new Set();
  }

  public isUserToken(token: string, userId: string): boolean {
    return this.connectorTokens.get(userId) === token;
  }

  public stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  public getPersistedTokens(): string[] {
    return [...this.connectorTokens.values()];
  }

  private restoreFromStorage(): void {
    if (!this.storage) return;

    for (const { userId, token } of this.storage.getAllConnectorTokens()) {
      this.connectorTokens.set(userId, token);
    }

    for (const { userId, projectId, projectName, projectPath } of this.storage.getAllRegisteredProjects()) {
      let userProjectSet = this.userProjects.get(userId);
      if (!userProjectSet) {
        userProjectSet = new Set();
        this.userProjects.set(userId, userProjectSet);
      }
      userProjectSet.add(projectId);
      this.onProjectRegistered?.(userId, projectId, projectName, projectPath);
    }

    const tokenCount = this.connectorTokens.size;
    const projectCount = this.storage.getAllRegisteredProjects().length;
    if (tokenCount > 0 || projectCount > 0) {
      console.log(`[registration] Restored ${tokenCount} connector tokens and ${projectCount} registered projects from DB`);
    }
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.pendingTokens) {
      if (now - entry.createdAt > this.tokenTtlMs) {
        this.pendingTokens.delete(key);
      }
    }
  }
}
