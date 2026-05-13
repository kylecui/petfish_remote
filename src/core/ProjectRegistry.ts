import type { ProjectConfig } from '../types.js';

export class ProjectRegistry {
  private readonly projectsById: Map<string, ProjectConfig>;
  private readonly projectToConnector = new Map<string, string>();

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
    if (project.allowed_users.length === 0 || project.allowed_users.includes('*')) {
      return true;
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

  public addProject(project: ProjectConfig, connectorId?: string): void {
    this.projectsById.set(project.id, project);
    if (connectorId) this.projectToConnector.set(project.id, connectorId);
  }

  public setConnectorMapping(projectId: string, connectorId: string): void {
    this.projectToConnector.set(projectId, connectorId);
  }

  public removeProject(id: string): void {
    this.projectsById.delete(id);
    this.projectToConnector.delete(id);
  }

  public removeProjectsByConnector(connectorId: string): string[] {
    const removed: string[] = [];
    for (const [projectId, cid] of this.projectToConnector) {
      if (cid === connectorId) {
        this.projectsById.delete(projectId);
        this.projectToConnector.delete(projectId);
        removed.push(projectId);
      }
    }
    return removed;
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
