import type { Storage } from '../storage/sqlite.js';
import type { ExecutionMode, SessionState } from '../types.js';

export class SessionManager {
  public constructor(private readonly storage: Storage) {}

  public getSession(chatId: string): SessionState | undefined {
    return this.storage.getSession(chatId);
  }

  public bindProject(chatId: string, projectId: string): SessionState {
    const now = new Date().toISOString();
    const existing = this.storage.getSession(chatId);

    if (existing) {
      const updated: SessionState = {
        ...existing,
        project_id: projectId,
        updated_at: now,
      };
      this.storage.upsertSession(updated);
      return updated;
    }

    const created: SessionState = {
      id: `${chatId}:${projectId}`,
      chat_id: chatId,
      project_id: projectId,
      mode: 'suggest',
      updated_at: now,
    };
    this.storage.upsertSession(created);
    return created;
  }

  public updateTask(chatId: string, taskId: string): void {
    const session = this.storage.getSession(chatId);
    if (!session) {
      throw new Error(`Session not found for chat: ${chatId}`);
    }
    this.storage.upsertSession({ ...session, active_task_id: taskId, updated_at: new Date().toISOString() });
  }

  public updateMode(chatId: string, mode: ExecutionMode): void {
    const session = this.storage.getSession(chatId);
    if (!session) {
      throw new Error(`Session not found for chat: ${chatId}`);
    }
    this.storage.upsertSession({ ...session, mode, updated_at: new Date().toISOString() });
  }
}
