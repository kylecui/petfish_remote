import { describe, it, expect } from 'vitest';
import { PolicyEngine, type PolicyAction, type PolicyConfig } from '../src/core/PolicyEngine.js';
import type { SupportedCommandName } from '../src/core/CommandRouter.js';

function makeConfig(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    blockedTargets: [],
    highRiskProfiles: [],
    requireApprovalActions: [],
    ...overrides,
  };
}

function makeAction(overrides: Partial<PolicyAction> = {}): PolicyAction {
  return {
    type: 'read',
    target: '/tmp/safe.txt',
    project_profile: 'default',
    ...overrides,
  };
}

describe('PolicyEngine.evaluate', () => {
  it('should allow safe actions by default', () => {
    const engine = new PolicyEngine(makeConfig());
    expect(engine.evaluate(makeAction())).toBe('allow');
  });

  it('should deny actions targeting blocked targets', () => {
    const engine = new PolicyEngine(makeConfig({ blockedTargets: ['.env', 'id_rsa', 'secret'] }));
    expect(engine.evaluate(makeAction({ target: '/home/user/.env' }))).toBe('deny');
    expect(engine.evaluate(makeAction({ target: '/root/.ssh/id_rsa' }))).toBe('deny');
    expect(engine.evaluate(makeAction({ target: '/app/secret.json' }))).toBe('deny');
  });

  it('should allow actions that do not match blocked targets', () => {
    const engine = new PolicyEngine(makeConfig({ blockedTargets: ['.env', 'id_rsa'] }));
    expect(engine.evaluate(makeAction({ target: '/app/src/main.ts' }))).toBe('allow');
  });

  it('should require approval for high-risk profiles', () => {
    const engine = new PolicyEngine(makeConfig({ highRiskProfiles: ['production', 'staging'] }));
    expect(engine.evaluate(makeAction({ project_profile: 'production' }))).toBe('require_approval');
    expect(engine.evaluate(makeAction({ project_profile: 'staging' }))).toBe('require_approval');
    expect(engine.evaluate(makeAction({ project_profile: 'development' }))).toBe('allow');
  });

  it('should require approval for specified action types', () => {
    const engine = new PolicyEngine(makeConfig({ requireApprovalActions: ['write', 'exec', 'docker'] }));
    expect(engine.evaluate(makeAction({ type: 'write' }))).toBe('require_approval');
    expect(engine.evaluate(makeAction({ type: 'exec' }))).toBe('require_approval');
    expect(engine.evaluate(makeAction({ type: 'docker' }))).toBe('require_approval');
    expect(engine.evaluate(makeAction({ type: 'read' }))).toBe('allow');
    expect(engine.evaluate(makeAction({ type: 'git' }))).toBe('allow');
  });

  it('should prioritize deny over require_approval (blocked target checked first)', () => {
    const engine = new PolicyEngine(makeConfig({
      blockedTargets: ['.env'],
      highRiskProfiles: ['production'],
      requireApprovalActions: ['write'],
    }));
    expect(engine.evaluate(makeAction({ target: '.env', project_profile: 'production', type: 'write' }))).toBe('deny');
  });

  it('should check high-risk profile before action type', () => {
    const engine = new PolicyEngine(makeConfig({
      highRiskProfiles: ['production'],
      requireApprovalActions: ['write'],
    }));
    expect(engine.evaluate(makeAction({ project_profile: 'production', type: 'read' }))).toBe('require_approval');
  });
});

describe('PolicyEngine.evaluateCommand', () => {
  it('should allow any command when no whitelist is set', () => {
    const engine = new PolicyEngine(makeConfig());
    expect(engine.evaluateCommand('help')).toBe('allow');
    expect(engine.evaluateCommand('commit')).toBe('allow');
    expect(engine.evaluateCommand('role')).toBe('allow');
  });

  it('should deny commands not in the whitelist', () => {
    const engine = new PolicyEngine(makeConfig({
      commandWhitelist: ['help', 'list', 'status'] as SupportedCommandName[],
    }));
    expect(engine.evaluateCommand('help')).toBe('allow');
    expect(engine.evaluateCommand('list')).toBe('allow');
    expect(engine.evaluateCommand('commit')).toBe('deny');
    expect(engine.evaluateCommand('role')).toBe('deny');
  });

  it('should require approval for specified commands', () => {
    const engine = new PolicyEngine(makeConfig({
      approvalRequiredCommands: ['commit', 'pr', 'role'] as SupportedCommandName[],
    }));
    expect(engine.evaluateCommand('commit')).toBe('require_approval');
    expect(engine.evaluateCommand('pr')).toBe('require_approval');
    expect(engine.evaluateCommand('role')).toBe('require_approval');
    expect(engine.evaluateCommand('help')).toBe('allow');
  });

  it('should deny over require_approval when whitelist excludes command', () => {
    const engine = new PolicyEngine(makeConfig({
      commandWhitelist: ['help'] as SupportedCommandName[],
      approvalRequiredCommands: ['commit'] as SupportedCommandName[],
    }));
    expect(engine.evaluateCommand('commit')).toBe('deny');
  });
});
