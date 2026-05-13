import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectRegistry } from '../src/core/ProjectRegistry.js';
import type { ProjectConfig } from '../src/types.js';

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: 'proj-1',
    name: 'Test Project',
    runtime: 'local',
    path: '/home/user/project',
    default_mode: 'read_only',
    allowed_users: ['user-a', 'user-b'],
    readme_files: [],
    test_commands: {},
    risk_profile: 'default',
    secrets_policy: 'deny',
    ...overrides,
  };
}

describe('ProjectRegistry', () => {
  let registry: ProjectRegistry;
  const proj1 = makeProject({ id: 'proj-1', name: 'Project One', path: '/path/one' });
  const proj2 = makeProject({ id: 'proj-2', name: 'Project Two', path: '/path/two', allowed_users: ['user-c'] });

  beforeEach(() => {
    registry = new ProjectRegistry([proj1, proj2]);
  });

  describe('getProject', () => {
    it('should return a project by id', () => {
      expect(registry.getProject('proj-1')).toEqual(proj1);
    });

    it('should return undefined for unknown id', () => {
      expect(registry.getProject('nonexistent')).toBeUndefined();
    });
  });

  describe('listProjects', () => {
    it('should return all projects', () => {
      const projects = registry.listProjects();
      expect(projects).toHaveLength(2);
      expect(projects.map((p) => p.id).sort()).toEqual(['proj-1', 'proj-2']);
    });
  });

  describe('isUserAllowed', () => {
    it('should return true for allowed user', () => {
      expect(registry.isUserAllowed('proj-1', 'user-a')).toBe(true);
      expect(registry.isUserAllowed('proj-1', 'user-b')).toBe(true);
    });

    it('should return false for disallowed user', () => {
      expect(registry.isUserAllowed('proj-1', 'user-x')).toBe(false);
    });

    it('should return false for nonexistent project', () => {
      expect(registry.isUserAllowed('nonexistent', 'user-a')).toBe(false);
    });

    it('should allow any user when allowed_users is empty', () => {
      const openProject = makeProject({ id: 'open', allowed_users: [] });
      const reg = new ProjectRegistry([openProject]);
      expect(reg.isUserAllowed('open', 'anyone')).toBe(true);
    });

    it('should allow any user when allowed_users contains wildcard "*"', () => {
      const wildcardProject = makeProject({ id: 'wild', allowed_users: ['*'] });
      const reg = new ProjectRegistry([wildcardProject]);
      expect(reg.isUserAllowed('wild', 'anyone')).toBe(true);
    });
  });

  describe('getProjectPath', () => {
    it('should return the project path', () => {
      expect(registry.getProjectPath('proj-1')).toBe('/path/one');
    });

    it('should throw for nonexistent project', () => {
      expect(() => registry.getProjectPath('nonexistent')).toThrow('Project not found: nonexistent');
    });
  });

  describe('addProject', () => {
    it('should add a new project', () => {
      const proj3 = makeProject({ id: 'proj-3', path: '/path/three' });
      registry.addProject(proj3);
      expect(registry.getProject('proj-3')).toEqual(proj3);
      expect(registry.listProjects()).toHaveLength(3);
    });

    it('should set connector mapping when connectorId is provided', () => {
      const proj3 = makeProject({ id: 'proj-3' });
      registry.addProject(proj3, 'conn-1');
      expect(registry.getProject('proj-3')).toEqual(proj3);
    });
  });

  describe('removeProject', () => {
    it('should remove a project by id', () => {
      registry.removeProject('proj-1');
      expect(registry.getProject('proj-1')).toBeUndefined();
      expect(registry.listProjects()).toHaveLength(1);
    });

    it('should not throw when removing nonexistent project', () => {
      expect(() => registry.removeProject('nonexistent')).not.toThrow();
    });
  });

  describe('setConnectorMapping and removeProjectsByConnector', () => {
    it('should remove projects associated with a connector', () => {
      registry.setConnectorMapping('proj-1', 'conn-A');
      registry.setConnectorMapping('proj-2', 'conn-A');
      const removed = registry.removeProjectsByConnector('conn-A');
      expect(removed.sort()).toEqual(['proj-1', 'proj-2']);
      expect(registry.listProjects()).toHaveLength(0);
    });

    it('should only remove projects for the specified connector', () => {
      registry.setConnectorMapping('proj-1', 'conn-A');
      registry.setConnectorMapping('proj-2', 'conn-B');
      const removed = registry.removeProjectsByConnector('conn-A');
      expect(removed).toEqual(['proj-1']);
      expect(registry.listProjects()).toHaveLength(1);
      expect(registry.getProject('proj-2')).toBeDefined();
    });

    it('should return empty array for unknown connector', () => {
      const removed = registry.removeProjectsByConnector('conn-unknown');
      expect(removed).toEqual([]);
      expect(registry.listProjects()).toHaveLength(2);
    });
  });

  describe('addUserToProject', () => {
    it('should add a user to a project', () => {
      const result = registry.addUserToProject('proj-2', 'new-user');
      expect(result).toBe(true);
      expect(registry.isUserAllowed('proj-2', 'new-user')).toBe(true);
    });

    it('should not duplicate existing user', () => {
      registry.addUserToProject('proj-1', 'user-a');
      const project = registry.getProject('proj-1')!;
      const count = project.allowed_users.filter((u) => u === 'user-a').length;
      expect(count).toBe(1);
    });

    it('should return false for nonexistent project', () => {
      expect(registry.addUserToProject('nonexistent', 'user-x')).toBe(false);
    });
  });
});
