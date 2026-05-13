import { describe, it, expect } from 'vitest';
import { CommandRouter, type ParsedCommand } from '../src/core/CommandRouter.js';

describe('CommandRouter.parseCommand', () => {
  const router = new CommandRouter();

  it('should parse a simple /pf command', () => {
    const result = router.parseCommand('/pf help');
    expect(result).toEqual({ name: 'help', args: [], rawText: '/pf help' });
  });

  it('should parse a command with arguments', () => {
    const result = router.parseCommand('/pf use my-project');
    expect(result).toEqual({ name: 'use', args: ['my-project'], rawText: '/pf use my-project' });
  });

  it('should parse a command with multiple arguments', () => {
    const result = router.parseCommand('/pf role user123 admin');
    expect(result).toEqual({ name: 'role', args: ['user123', 'admin'], rawText: '/pf role user123 admin' });
  });

  it('should handle extra whitespace', () => {
    const result = router.parseCommand('  /pf   list  ');
    expect(result.name).toBe('list');
    expect(result.args).toEqual([]);
  });

  it('should lowercase the command name', () => {
    const result = router.parseCommand('/pf HELP');
    expect(result.name).toBe('help');
  });

  it('should throw on invalid prefix', () => {
    expect(() => router.parseCommand('/bot help')).toThrow('Invalid command prefix');
    expect(() => router.parseCommand('help')).toThrow('Invalid command prefix');
  });

  it('should throw on missing command name', () => {
    expect(() => router.parseCommand('/pf')).toThrow('Missing command name');
    expect(() => router.parseCommand('/pf  ')).toThrow('Missing command name');
  });

  it('should throw on unsupported command', () => {
    expect(() => router.parseCommand('/pf foo')).toThrow('Unsupported command: foo');
    expect(() => router.parseCommand('/pf restart')).toThrow('Unsupported command: restart');
  });

  it('should parse all 26 supported commands without error', () => {
    const commands = [
      'help', 'list', 'use', 'where', 'ask', 'edit', 'test', 'status',
      'diff', 'approve', 'deny', 'stop', 'log', 'pr', 'commit', 'new',
      'doctor', 'sessions', 'switch', 'model', 'agents', 'subagents',
      'audit', 'users', 'role',
    ];
    for (const cmd of commands) {
      const result = router.parseCommand(`/pf ${cmd}`);
      expect(result.name).toBe(cmd);
    }
  });
});

describe('CommandRouter.parseNaturalLanguage', () => {
  const router = new CommandRouter();

  it('should match "help"', () => {
    expect(router.parseNaturalLanguage('I need help').name).toBe('help');
  });

  it('should match "list project" / "show projects"', () => {
    expect(router.parseNaturalLanguage('list projects please').name).toBe('list');
    expect(router.parseNaturalLanguage('show projects').name).toBe('list');
  });

  it('should match "use project" / "switch to"', () => {
    const result = router.parseNaturalLanguage('use project my-proj');
    expect(result.name).toBe('use');
    expect(result.args).toEqual(['my-proj']);

    const result2 = router.parseNaturalLanguage('switch to other-proj');
    expect(result2.name).toBe('use');
    expect(result2.args).toEqual(['other-proj']);
  });

  it('should match "where am i" / "current project"', () => {
    expect(router.parseNaturalLanguage('where am i').name).toBe('where');
    expect(router.parseNaturalLanguage('what is the current project').name).toBe('where');
  });

  it('should match "edit" with optional boundProject', () => {
    const result = router.parseNaturalLanguage('edit this file', 'proj-1');
    expect(result.name).toBe('edit');
    expect(result.args).toEqual(['proj-1']);

    const result2 = router.parseNaturalLanguage('edit something');
    expect(result2.name).toBe('edit');
    expect(result2.args).toEqual([]);
  });

  it('should match "run test" / "run tests"', () => {
    expect(router.parseNaturalLanguage('run tests').name).toBe('test');
    expect(router.parseNaturalLanguage('run test suite').name).toBe('test');
  });

  it('should match "status"', () => {
    expect(router.parseNaturalLanguage('show status').name).toBe('status');
  });

  it('should match "show diff"', () => {
    expect(router.parseNaturalLanguage('show diff').name).toBe('diff');
  });

  it('should match "approve" / "deny"', () => {
    expect(router.parseNaturalLanguage('approve task-123').name).toBe('approve');
    expect(router.parseNaturalLanguage('deny task-456').name).toBe('deny');
  });

  it('should match "stop"', () => {
    expect(router.parseNaturalLanguage('stop task now').name).toBe('stop');
    expect(router.parseNaturalLanguage('stop').name).toBe('stop');
  });

  it('should match "show logs" / "log"', () => {
    expect(router.parseNaturalLanguage('show logs').name).toBe('log');
    expect(router.parseNaturalLanguage('log task-1').name).toBe('log');
  });

  it('should match "create pr" / "pull request"', () => {
    expect(router.parseNaturalLanguage('create pr').name).toBe('pr');
    expect(router.parseNaturalLanguage('open a pull request').name).toBe('pr');
  });

  it('should match "commit"', () => {
    expect(router.parseNaturalLanguage('commit changes').name).toBe('commit');
  });

  it('should match "doctor" / "health check" / "diagnostics"', () => {
    expect(router.parseNaturalLanguage('run doctor').name).toBe('doctor');
    expect(router.parseNaturalLanguage('health check').name).toBe('doctor');
    expect(router.parseNaturalLanguage('run diagnostics').name).toBe('doctor');
  });

  it('should match "list sessions" / "show sessions"', () => {
    expect(router.parseNaturalLanguage('list sessions').name).toBe('sessions');
    expect(router.parseNaturalLanguage('show sessions').name).toBe('sessions');
  });

  it('should match "switch session"', () => {
    const result = router.parseNaturalLanguage('switch session abc-123');
    expect(result.name).toBe('switch');
    expect(result.args).toEqual(['abc-123']);
  });

  it('should default to "ask" for unrecognized text', () => {
    expect(router.parseNaturalLanguage('fix the login bug').name).toBe('ask');
    expect(router.parseNaturalLanguage('deploy to production').name).toBe('ask');
    expect(router.parseNaturalLanguage('hello world').name).toBe('ask');
  });
});
