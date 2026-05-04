import type { ProjectConfig, TaskRecord } from '../types.js';

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

  public renderHelp(): string {
    return [
      '/pf help',
      '/pf list',
      '/pf use <project>',
      '/pf where',
      '/pf ask <instruction>',
      '/pf edit <instruction>',
      '/pf test',
      '/pf status',
      '/pf diff',
      '/pf approve <approval_id>',
      '/pf deny <approval_id>',
      '/pf stop',
      '/pf log <task_id>',
      '/pf pr',
      '/pf commit',
    ].join('\n');
  }
}
