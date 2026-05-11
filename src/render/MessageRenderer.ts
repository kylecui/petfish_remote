import type { ProjectConfig, TaskRecord, UserRole } from '../types.js';
import { hasMinimumRole } from '../types.js';

interface SessionEntry {
  id: string;
  slug: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  active: boolean;
}

export class MessageRenderer {
  public renderTaskCreated(task: TaskRecord): string {
    return `Task created: ${task.task_id}\nProject: ${task.project_id}\nMode: ${task.mode}\nStatus: ${task.status}`;
  }

  public renderTaskProgress(task: TaskRecord, summary: string): string {
    return `Task progress: ${task.task_id}\nStatus: ${task.status}\n${summary}`;
  }

  public renderTaskCompleted(task: TaskRecord, result: string): string {
    return `Task completed: ${task.task_id}\nStatus: ${task.status}\nResult:\n${result}`;
  }

  public renderProjectList(projects: ProjectConfig[]): string {
    if (projects.length === 0) {
      return 'No projects configured';
    }
    return projects.map((project) => `- ${project.id}: ${project.name} (${project.path})`).join('\n');
  }

  public renderProjectBound(project: ProjectConfig): string {
    return `Bound to project ${project.id} (${project.name})\nPath: ${project.path}\nDefault mode: ${project.default_mode}`;
  }

  public renderHelp(role: UserRole = 'viewer'): string {
    const lines: string[] = [
      '*📂 Project & Session*',
      '  /pf list — List available projects',
      '  /pf where — Show current binding',
      '  /pf sessions — List opencode sessions',
      '  /pf agents — Show current sub-agent status',
      '  /pf subagents <silent|summary|verbose> — Set sub-agent visibility',
      '  /pf status — Show task status',
      '',
    ];

    if (hasMinimumRole(role, 'operator')) {
      lines.push(
        '*⚡ Task Control*',
        '  /pf ask <msg> — Send instruction (ask mode)',
        '  /pf edit <msg> — Send instruction (edit mode)',
        '  /pf new — Start a new session',
        '  /pf use <project> — Switch project',
        '  /pf switch <slug> — Switch session',
        '  /pf model [provider/model|clear] — List or change model',
        '  /pf stop — Cancel running task',
        '',
        '*🛠️ Development*',
        '  /pf diff — Show file changes',
        '  /pf commit — Commit changes',
        '  /pf pr — Create pull request',
        '  /pf test — Run tests',
        '  /pf doctor — Health check',
        '  /pf log <id> — Show task log',
        '  /pf approve <id> — Approve action',
        '  /pf deny <id> — Deny action',
        '',
      );
    }

    if (hasMinimumRole(role, 'admin')) {
      lines.push(
        '*🔧 Admin*',
        '  /pf users — List users & roles',
        '  /pf role <user> <role> — Set user role',
        '  /pf audit [user] — View audit log',
        '',
      );
    }

    lines.push('/pf — Show menu card');
    return lines.join('\n');
  }

  public renderSessionList(sessions: SessionEntry[]): string {
    if (sessions.length === 0) {
      return 'No sessions found.';
    }
    const lines = [`📋 Sessions (${sessions.length}):`];
    for (const s of sessions) {
      const date = new Date(s.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const marker = s.active ? ' ✅' : '';
      const title = s.title || '(untitled)';
      const label = s.slug || s.id.slice(0, 12);
      lines.push(`  ${label} — ${title} (${date})${marker}`);
    }
    lines.push(`\nUse /pf switch <slug> to switch.`);
    return lines.join('\n');
  }
}
