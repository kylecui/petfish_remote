import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBridge } from '../src/connector/bridges/AgentBridge.js';

vi.mock('../src/connector/bridges/GeminiBridge.js', () => {
  const GeminiBridge = vi.fn().mockImplementation((config: { cwd: string }) => ({
    agentType: 'gemini' as const,
    cwd: config.cwd,
    init: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    prompt: vi.fn().mockReturnValue(true),
    cancel: vi.fn(),
    requestNewSession: vi.fn().mockResolvedValue(undefined),
    setQuestionCallback: vi.fn(),
    setPermissionCallback: vi.fn(),
    answerQuestion: vi.fn(),
    answerPermission: vi.fn(),
  }));
  return { GeminiBridge };
});

vi.mock('../src/connector/bridges/CodexBridge.js', () => {
  const CodexBridge = vi.fn().mockImplementation((config: { cwd: string }) => ({
    agentType: 'codex' as const,
    cwd: config.cwd,
    init: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    prompt: vi.fn().mockReturnValue(true),
    cancel: vi.fn(),
    requestNewSession: vi.fn().mockResolvedValue(undefined),
    setQuestionCallback: vi.fn(),
    setPermissionCallback: vi.fn(),
    answerQuestion: vi.fn(),
    answerPermission: vi.fn(),
  }));
  return { CodexBridge };
});

vi.mock('../src/connector/bridges/OpenCodeBridge.js', () => {
  const OpenCodeBridge = vi.fn().mockImplementation(() => ({
    agentType: 'opencode' as const,
    init: vi.fn().mockRejectedValue(new Error('No running opencode session found')),
    stop: vi.fn(),
    prompt: vi.fn().mockReturnValue(false),
    cancel: vi.fn(),
    requestNewSession: vi.fn().mockResolvedValue(undefined),
    setQuestionCallback: vi.fn(),
    setPermissionCallback: vi.fn(),
    answerQuestion: vi.fn(),
    answerPermission: vi.fn(),
  }));
  return { OpenCodeBridge };
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env['OPENCODE_PID'];
});

describe('createBridge — agent routing', () => {
  it('returns GeminiBridge instance when agent="gemini"', async () => {
    const bridge = await createBridge({ agent: 'gemini', cwd: '/tmp/test' });

    expect(bridge).toBeDefined();
    expect(bridge!.agentType).toBe('gemini');
  });

  it('calls init() on GeminiBridge during creation', async () => {
    const bridge = await createBridge({ agent: 'gemini', cwd: '/tmp/test' });

    expect(bridge).toBeDefined();
    expect(bridge!.init).toHaveBeenCalled();
  });

  it('returns CodexBridge instance when agent="codex"', async () => {
    const bridge = await createBridge({ agent: 'codex', cwd: '/tmp/test' });

    expect(bridge).toBeDefined();
    expect(bridge!.agentType).toBe('codex');
  });

  it('calls init() on CodexBridge during creation', async () => {
    const bridge = await createBridge({ agent: 'codex', cwd: '/tmp/test' });

    expect(bridge).toBeDefined();
    expect(bridge!.init).toHaveBeenCalled();
  });

  it('attempts OpenCodeBridge when agent="opencode" and throws on init failure', async () => {
    await expect(
      createBridge({ agent: 'opencode', cwd: '/tmp/test' }),
    ).rejects.toThrow('No running opencode session found');
  });

  it('returns undefined in auto mode when OpenCodeBridge init fails and no fallback exists', async () => {
    const bridge = await createBridge({ agent: 'auto', cwd: '/tmp/test' });

    expect(bridge).toBeUndefined();
  });

  it('defaults undefined agent to auto, which returns undefined when opencode unavailable', async () => {
    const bridge = await createBridge({ agent: undefined, cwd: '/tmp/test' });

    expect(bridge).toBeUndefined();
  });

  it('uses process.cwd() as default cwd when not specified', async () => {
    const bridge = await createBridge({ agent: 'gemini' });

    expect(bridge).toBeDefined();
    expect(bridge!.agentType).toBe('gemini');
  });

  it('attempts OpenCodeBridge when OPENCODE_PID is set in auto mode', async () => {
    process.env['OPENCODE_PID'] = '12345';

    await expect(
      createBridge({ agent: 'auto', cwd: '/tmp/test' }),
    ).rejects.toThrow('No running opencode session found');
  });
});
