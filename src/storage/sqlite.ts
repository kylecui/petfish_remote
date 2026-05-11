import Database from 'better-sqlite3';

import type { ApprovalRecord, AuditEvent, Platform, SessionState, TaskRecord, UserConfig, UserRole } from '../types.js';

export class Storage {
  private readonly db: Database.Database;

  public constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  public init(): void {
    const schema = `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        allowed_projects TEXT NOT NULL,
        allowed_modes TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT 'telegram',
        chat_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        opencode_session_id TEXT,
        active_task_id TEXT,
        mode TEXT NOT NULL,
        sub_agent_verbosity TEXT NOT NULL DEFAULT 'summary',
        updated_at TEXT NOT NULL,
        UNIQUE(platform, chat_id)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        instruction TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        risk_level TEXT,
        opencode_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        approval_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        action_payload TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        decided_at TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        user_id TEXT,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS connector_tokens (
        user_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS registered_projects (
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        project_path TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        PRIMARY KEY (project_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS user_chat_map (
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (platform, user_id)
      );
    `;

    this.db.exec(schema);
    this.migrate();
  }

  private migrate(): void {
    // Migration: add platform column to sessions (for DBs created before multi-platform support)
    const columns = this.db.pragma('table_info(sessions)') as Array<{ name: string }>;
    const hasPlatform = columns.some((c) => c.name === 'platform');
    if (!hasPlatform) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN platform TEXT NOT NULL DEFAULT 'telegram'`);
      // Recreate unique constraint: drop old UNIQUE on chat_id, add composite
      // SQLite doesn't support DROP CONSTRAINT, so we rebuild the table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions_new (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL DEFAULT 'telegram',
          chat_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          opencode_session_id TEXT,
          active_task_id TEXT,
          mode TEXT NOT NULL,
          sub_agent_verbosity TEXT NOT NULL DEFAULT 'summary',
          updated_at TEXT NOT NULL,
          UNIQUE(platform, chat_id)
        );
        INSERT INTO sessions_new SELECT id, platform, chat_id, project_id, opencode_session_id, active_task_id, mode, 'summary', updated_at FROM sessions;
        DROP TABLE sessions;
        ALTER TABLE sessions_new RENAME TO sessions;
      `);
    }

    const columnsAfterPlatform = this.db.pragma('table_info(sessions)') as Array<{ name: string }>;
    const hasSubAgentVerbosity = columnsAfterPlatform.some((c) => c.name === 'sub_agent_verbosity');
    if (!hasSubAgentVerbosity) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN sub_agent_verbosity TEXT NOT NULL DEFAULT 'summary'`);
    }
  }

  public upsertUser(user: UserConfig): void {
    const stmt = this.db.prepare(`
      INSERT INTO users (id, name, role, allowed_projects, allowed_modes)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        role = excluded.role,
        allowed_projects = excluded.allowed_projects,
        allowed_modes = excluded.allowed_modes
    `);

    stmt.run(user.id, user.name, user.role, JSON.stringify(user.allowed_projects), JSON.stringify(user.allowed_modes));
  }

  public getUser(id: string): UserConfig | undefined {
    const row = this.db
      .prepare('SELECT id, name, role, allowed_projects, allowed_modes FROM users WHERE id = ?')
      .get(id) as
      | {
          id: string;
          name: string;
          role: string;
          allowed_projects: string;
          allowed_modes: string;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      name: row.name,
      role: row.role as UserRole,
      allowed_projects: JSON.parse(row.allowed_projects) as string[],
      allowed_modes: JSON.parse(row.allowed_modes) as UserConfig['allowed_modes'],
    };
  }

  public hasAnyUser(): boolean {
    const row = this.db.prepare('SELECT 1 FROM users LIMIT 1').get();
    return row !== undefined;
  }

  public getAllUsers(): UserConfig[] {
    const rows = this.db.prepare('SELECT id, name, role, allowed_projects, allowed_modes FROM users ORDER BY id').all() as Array<{
      id: string;
      name: string;
      role: string;
      allowed_projects: string;
      allowed_modes: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role as UserRole,
      allowed_projects: JSON.parse(row.allowed_projects) as string[],
      allowed_modes: JSON.parse(row.allowed_modes) as UserConfig['allowed_modes'],
    }));
  }

  public upsertSession(session: SessionState): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, platform, chat_id, project_id, opencode_session_id, active_task_id, mode, sub_agent_verbosity, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        platform = excluded.platform,
        chat_id = excluded.chat_id,
        project_id = excluded.project_id,
        opencode_session_id = excluded.opencode_session_id,
        active_task_id = excluded.active_task_id,
        mode = excluded.mode,
        sub_agent_verbosity = excluded.sub_agent_verbosity,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      session.id,
      session.platform,
      session.chat_id,
      session.project_id,
      session.opencode_session_id ?? null,
      session.active_task_id ?? null,
      session.mode,
      session.sub_agent_verbosity,
      session.updated_at,
    );
  }

  public getSession(platform: Platform, chatId: string): SessionState | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE platform = ? AND chat_id = ?').get(platform, chatId) as SessionState | undefined;
    return row;
  }

  public getChatIdByProject(projectId: string): { platform: Platform; chatId: string } | undefined {
    const row = this.db
      .prepare('SELECT platform, chat_id FROM sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(projectId) as { platform: string; chat_id: string } | undefined;
    return row ? { platform: row.platform as Platform, chatId: row.chat_id } : undefined;
  }

  public setUserChatId(platform: Platform, userId: string, chatId: string): void {
    this.db.prepare(`
      INSERT INTO user_chat_map (platform, user_id, chat_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(platform, user_id) DO UPDATE SET
        chat_id = excluded.chat_id,
        updated_at = excluded.updated_at
    `).run(platform, userId, chatId, new Date().toISOString());
  }

  public getUserChatId(platform: Platform, userId: string): string | undefined {
    const row = this.db.prepare('SELECT chat_id FROM user_chat_map WHERE platform = ? AND user_id = ?')
      .get(platform, userId) as { chat_id: string } | undefined;
    return row?.chat_id;
  }

  public getAllUserChatIds(platform: Platform): Map<string, string> {
    const rows = this.db.prepare('SELECT user_id, chat_id FROM user_chat_map WHERE platform = ?')
      .all(platform) as Array<{ user_id: string; chat_id: string }>;
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.user_id, row.chat_id);
    }
    return map;
  }

  public createTask(task: TaskRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        task_id, project_id, user_id, instruction, mode, status,
        risk_level, opencode_session_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.task_id,
      task.project_id,
      task.user_id,
      task.instruction,
      task.mode,
      task.status,
      task.risk_level ?? null,
      task.opencode_session_id ?? null,
      task.created_at,
      task.updated_at,
    );
  }

  public getTask(taskId: string): TaskRecord | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as TaskRecord | undefined;
    return row;
  }

  public updateTask(task: TaskRecord): void {
    const stmt = this.db.prepare(`
      UPDATE tasks SET
        project_id = ?,
        user_id = ?,
        instruction = ?,
        mode = ?,
        status = ?,
        risk_level = ?,
        opencode_session_id = ?,
        created_at = ?,
        updated_at = ?
      WHERE task_id = ?
    `);

    stmt.run(
      task.project_id,
      task.user_id,
      task.instruction,
      task.mode,
      task.status,
      task.risk_level ?? null,
      task.opencode_session_id ?? null,
      task.created_at,
      task.updated_at,
      task.task_id,
    );
  }

  public createApproval(approval: ApprovalRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO approvals (
        approval_id, task_id, action_type, action_payload,
        risk_level, status, requested_at, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      approval.approval_id,
      approval.task_id,
      approval.action_type,
      approval.action_payload,
      approval.risk_level,
      approval.status,
      approval.requested_at,
      approval.decided_at ?? null,
    );
  }

  public getApproval(approvalId: string): ApprovalRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM approvals WHERE approval_id = ?')
      .get(approvalId) as ApprovalRecord | undefined;
    return row;
  }

  public updateApproval(approval: ApprovalRecord): void {
    const stmt = this.db.prepare(`
      UPDATE approvals SET
        task_id = ?,
        action_type = ?,
        action_payload = ?,
        risk_level = ?,
        status = ?,
        requested_at = ?,
        decided_at = ?
      WHERE approval_id = ?
    `);

    stmt.run(
      approval.task_id,
      approval.action_type,
      approval.action_payload,
      approval.risk_level,
      approval.status,
      approval.requested_at,
      approval.decided_at ?? null,
      approval.approval_id,
    );
  }

  public getPendingApproval(taskId: string): ApprovalRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM approvals WHERE task_id = ? AND status = ? ORDER BY requested_at DESC LIMIT 1')
      .get(taskId, 'pending') as ApprovalRecord | undefined;
    return row;
  }

  public createAuditLog(event: AuditEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (id, task_id, user_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(event.id, event.task_id ?? null, event.user_id ?? null, event.event_type, event.payload, event.created_at);
  }

  public getTaskAuditLogs(taskId: string): AuditEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_logs WHERE task_id = ? ORDER BY created_at ASC')
      .all(taskId) as AuditEvent[];
    return rows;
  }

  public getUserAuditLogs(userId: string, limit = 50): AuditEvent[] {
    return this.db
      .prepare('SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit) as AuditEvent[];
  }

  public getRecentAuditLogs(limit = 50): AuditEvent[] {
    return this.db
      .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as AuditEvent[];
  }

  public upsertConnectorToken(userId: string, token: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO connector_tokens (user_id, token, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET token = excluded.token
    `);
    stmt.run(userId, token, new Date().toISOString());
  }

  public getConnectorToken(userId: string): string | undefined {
    const row = this.db
      .prepare('SELECT token FROM connector_tokens WHERE user_id = ?')
      .get(userId) as { token: string } | undefined;
    return row?.token;
  }

  public getAllConnectorTokens(): Array<{ userId: string; token: string }> {
    const rows = this.db
      .prepare('SELECT user_id, token FROM connector_tokens')
      .all() as Array<{ user_id: string; token: string }>;
    return rows.map((r) => ({ userId: r.user_id, token: r.token }));
  }

  public upsertRegisteredProject(userId: string, projectId: string, projectName: string, projectPath: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO registered_projects (project_id, user_id, project_name, project_path, registered_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, user_id) DO UPDATE SET
        project_name = excluded.project_name,
        project_path = excluded.project_path
    `);
    stmt.run(projectId, userId, projectName, projectPath, new Date().toISOString());
  }

  public getAllRegisteredProjects(): Array<{ userId: string; projectId: string; projectName: string; projectPath: string }> {
    const rows = this.db
      .prepare('SELECT user_id, project_id, project_name, project_path FROM registered_projects')
      .all() as Array<{ user_id: string; project_id: string; project_name: string; project_path: string }>;
    return rows.map((r) => ({ userId: r.user_id, projectId: r.project_id, projectName: r.project_name, projectPath: r.project_path }));
  }
}
