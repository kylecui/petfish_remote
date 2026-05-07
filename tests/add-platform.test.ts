import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegistrationService } from '../src/server/RegistrationService.js';

function createMockStorage() {
  const projects: Array<{ userId: string; projectId: string; projectName: string; projectPath: string }> = [];
  const tokens: Array<{ userId: string; token: string }> = [];
  return {
    upsertConnectorToken: vi.fn((userId: string, token: string) => {
      tokens.push({ userId, token });
    }),
    upsertRegisteredProject: vi.fn((userId: string, projectId: string, projectName: string, projectPath: string) => {
      projects.push({ userId, projectId, projectName, projectPath });
    }),
    getAllConnectorTokens: vi.fn(() => tokens),
    getAllRegisteredProjects: vi.fn(() => projects),
    _projects: projects,
    _tokens: tokens,
  };
}

describe('RegistrationService.addPlatform', () => {
  let service: RegistrationService;
  let onProjectRegistered: ReturnType<typeof vi.fn>;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    onProjectRegistered = vi.fn();
    storage = createMockStorage();
    service = new RegistrationService({
      onProjectRegistered,
      storage: storage as any,
    });
  });

  function setupExistingUser(userId: string, projectId: string) {
    const regToken = service.generateToken(userId);
    const result = service.register({
      token: regToken,
      projectId,
      projectName: projectId,
      projectPath: `/home/user/${projectId}`,
      hostname: 'test-host',
    });
    if ('error' in result) throw new Error(result.error);
    return result;
  }

  it('adds a new platform user to an existing project', () => {
    const existing = setupExistingUser('telegram:123', 'my-project');

    const feishuToken = service.generateToken('feishu:ou_abc');
    const result = service.addPlatform({
      registrationToken: feishuToken,
      connectorToken: existing.connectorToken,
      projectId: 'my-project',
    });

    expect(result).toEqual({
      success: true,
      userId: 'feishu:ou_abc',
      projectId: 'my-project',
    });
  });

  it('calls onProjectRegistered with new user', () => {
    const existing = setupExistingUser('telegram:123', 'my-project');
    onProjectRegistered.mockClear();

    const feishuToken = service.generateToken('feishu:ou_abc');
    service.addPlatform({
      registrationToken: feishuToken,
      connectorToken: existing.connectorToken,
      projectId: 'my-project',
    });

    expect(onProjectRegistered).toHaveBeenCalledWith(
      'feishu:ou_abc',
      'my-project',
      'my-project',
      '/home/user/my-project',
    );
  });

  it('persists the new user in storage', () => {
    const existing = setupExistingUser('telegram:123', 'my-project');
    storage.upsertRegisteredProject.mockClear();

    const feishuToken = service.generateToken('feishu:ou_abc');
    service.addPlatform({
      registrationToken: feishuToken,
      connectorToken: existing.connectorToken,
      projectId: 'my-project',
    });

    expect(storage.upsertRegisteredProject).toHaveBeenCalledWith(
      'feishu:ou_abc',
      'my-project',
      'my-project',
      '/home/user/my-project',
    );
  });

  it('does NOT generate a new connector token', () => {
    const existing = setupExistingUser('telegram:123', 'my-project');
    storage.upsertConnectorToken.mockClear();

    const feishuToken = service.generateToken('feishu:ou_abc');
    service.addPlatform({
      registrationToken: feishuToken,
      connectorToken: existing.connectorToken,
      projectId: 'my-project',
    });

    expect(storage.upsertConnectorToken).not.toHaveBeenCalled();
    expect(service.getConnectorToken('feishu:ou_abc')).toBeUndefined();
  });

  it('rejects invalid registration token', () => {
    setupExistingUser('telegram:123', 'my-project');

    const result = service.addPlatform({
      registrationToken: 'bad-token',
      connectorToken: 'whatever',
      projectId: 'my-project',
    });

    expect(result).toEqual({ error: 'Invalid or expired registration token' });
  });

  it('rejects invalid connector token', () => {
    setupExistingUser('telegram:123', 'my-project');

    const feishuToken = service.generateToken('feishu:ou_abc');
    const result = service.addPlatform({
      registrationToken: feishuToken,
      connectorToken: 'bad-connector-token',
      projectId: 'my-project',
    });

    expect(result).toEqual({ error: 'Invalid connector token — not associated with any user' });
  });

  it('rejects project not owned by the connector user', () => {
    const existing = setupExistingUser('telegram:123', 'my-project');

    const feishuToken = service.generateToken('feishu:ou_abc');
    const result = service.addPlatform({
      registrationToken: feishuToken,
      connectorToken: existing.connectorToken,
      projectId: 'some-other-project',
    });

    expect(result).toEqual({ error: 'Project some-other-project not found for this connector' });
  });

  it('consumes the registration token (single use)', () => {
    const existing = setupExistingUser('telegram:123', 'my-project');
    const feishuToken = service.generateToken('feishu:ou_abc');

    service.addPlatform({
      registrationToken: feishuToken,
      connectorToken: existing.connectorToken,
      projectId: 'my-project',
    });

    const result = service.addPlatform({
      registrationToken: feishuToken,
      connectorToken: existing.connectorToken,
      projectId: 'my-project',
    });
    expect(result).toEqual({ error: 'Invalid or expired registration token' });
  });

  it('tracks the new user project in memory', () => {
    const existing = setupExistingUser('telegram:123', 'my-project');

    const feishuToken = service.generateToken('feishu:ou_abc');
    service.addPlatform({
      registrationToken: feishuToken,
      connectorToken: existing.connectorToken,
      projectId: 'my-project',
    });

    const feishuProjects = service.getUserProjects('feishu:ou_abc');
    expect(feishuProjects.has('my-project')).toBe(true);
  });

  it('works with multiple projects', () => {
    const telegramToken1 = service.generateToken('telegram:123');
    const result1 = service.register({
      token: telegramToken1,
      projectId: 'project-a',
      projectName: 'Project A',
      projectPath: '/home/user/a',
      hostname: 'host',
    });
    if ('error' in result1) throw new Error(result1.error);

    const telegramToken2 = service.generateToken('telegram:123');
    service.register({
      token: telegramToken2,
      projectId: 'project-b',
      projectName: 'Project B',
      projectPath: '/home/user/b',
      hostname: 'host',
    });

    const feishuToken = service.generateToken('feishu:ou_abc');
    const addResult = service.addPlatform({
      registrationToken: feishuToken,
      connectorToken: result1.connectorToken,
      projectId: 'project-a',
    });

    expect(addResult).toEqual({
      success: true,
      userId: 'feishu:ou_abc',
      projectId: 'project-a',
    });

    expect(service.getUserProjects('feishu:ou_abc').has('project-a')).toBe(true);
    expect(service.getUserProjects('feishu:ou_abc').has('project-b')).toBe(false);
  });
});
