import type { ProjectConfig } from '../types.js';

export class ProjectRegistry {
  private readonly projectsById: Map<string, ProjectConfig>;

  public constructor(projects: ProjectConfig[]) {
    this.projectsById = new Map(projects.map((project) => [project.id, project]));
  }

  public getProject(id: string): ProjectConfig | undefined {
    return this.projectsById.get(id);
  }

  public listProjects(): ProjectConfig[] {
    return Array.from(this.projectsById.values());
  }

  public isUserAllowed(projectId: string, userId: string): boolean {
    const project = this.projectsById.get(projectId);
    if (!project) {
      return false;
    }
    return project.allowed_users.includes(userId);
  }

  public getProjectPath(id: string): string {
    const project = this.projectsById.get(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }
    return project.path;
  }

  public addProject(project: ProjectConfig): void {
    this.projectsById.set(project.id, project);
  }

  public addUserToProject(projectId: string, userId: string): boolean {
    const project = this.projectsById.get(projectId);
    if (!project) return false;
    if (!project.allowed_users.includes(userId)) {
      project.allowed_users.push(userId);
    }
    return true;
  }
}
