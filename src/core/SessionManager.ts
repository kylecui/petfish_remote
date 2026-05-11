import type { Storage } from '../storage/sqlite.js';
import type { ExecutionMode, Platform, SessionState, SubAgentVerbosity } from '../types.js';

export class SessionManager {
  public constructor(private readonly storage: Storage) {}

  public getSession(platform: Platform, chatId: string): SessionState | undefined {
    return this.storage.getSession(platform, chatId);
  }

  public bindProject(platform: Platform, chatId: string, projectId: string): SessionState {
    const now = new Date().toISOString();
    const existing = this.storage.getSession(platform, chatId);

    if (existing) {
      const updated: SessionState = {
        ...existing,
        project_id: projectId,
        updated_at: now,
        sub_agent_verbosity: existing.sub_agent_verbosity ?? 'summary',
      };
      this.storage.upsertSession(updated);
      return updated;
    }

    const created: SessionState = {
      id: `${platform}:${chatId}:${projectId}`,
      platform,
      chat_id: chatId,
        project_id: projectId,
        mode: 'suggest',
        sub_agent_verbosity: 'summary',
        updated_at: now,
      };
    this.storage.upsertSession(created);
    return created;
  }

  public updateTask(platform: Platform, chatId: string, taskId: string): void {
    const session = this.storage.getSession(platform, chatId);
    if (!session) {
      throw new Error(`Session not found for ${platform}:${chatId}`);
    }
    this.storage.upsertSession({ ...session, active_task_id: taskId, updated_at: new Date().toISOString() });
  }

  public updateMode(platform: Platform, chatId: string, mode: ExecutionMode): void {
    const session = this.storage.getSession(platform, chatId);
    if (!session) {
      throw new Error(`Session not found for ${platform}:${chatId}`);
    }
    this.storage.upsertSession({ ...session, mode, updated_at: new Date().toISOString() });
  }

  public updateSubAgentVerbosity(platform: Platform, chatId: string, subAgentVerbosity: SubAgentVerbosity): void {
    const session = this.storage.getSession(platform, chatId);
    if (!session) {
      throw new Error(`Session not found for ${platform}:${chatId}`);
    }
    this.storage.upsertSession({ ...session, sub_agent_verbosity: subAgentVerbosity, updated_at: new Date().toISOString() });
  }
}
