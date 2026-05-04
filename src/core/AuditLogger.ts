import { nanoid } from 'nanoid';

import type { Storage } from '../storage/sqlite.js';
import type { AuditEvent } from '../types.js';

export class AuditLogger {
  public constructor(private readonly storage: Storage) {}

  public log(event: Omit<AuditEvent, 'id' | 'created_at'>): void {
    const fullEvent: AuditEvent = {
      ...event,
      id: nanoid(),
      created_at: new Date().toISOString(),
    };
    this.storage.createAuditLog(fullEvent);
  }

  public getTaskLogs(taskId: string): AuditEvent[] {
    return this.storage.getTaskAuditLogs(taskId);
  }
}
