import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenCodeBridge } from '../src/connector/bridges/OpenCodeBridge.js';

/**
 * Tests for OpenCodeBridge sessionBusy state management.
 *
 * These tests verify the critical bugfix (commit 6f0e2ea) where
 * handleSessionError() now correctly resets sessionBusy=false and
 * calls scheduleIdleDrain(), preventing permanent queue stalls
 * after errors like MessageAbortedError.
 */

function createBridge(): OpenCodeBridge {
  const bridge = new OpenCodeBridge({ cwd: '/tmp/test' });
  // Set up minimal internal state to avoid null-reference errors
  const b = bridge as any;
  b.client = {};
  b.sessionId = 'test-session';
  b.opencodePort = '12345';
  return bridge;
}

function addPendingTask(bridge: OpenCodeBridge, taskId: string, onFail?: (id: string, err: string) => void) {
  const b = bridge as any;
  b.pending.set(taskId, {
    taskId,
    userMessageId: `msg-${taskId}`,
    assistantMessageId: undefined,
    onOutput: vi.fn(),
    onComplete: vi.fn(),
    onFail: onFail ?? vi.fn(),
    startedAt: new Date().toISOString(),
    stdout: '',
    sentTextLengths: new Map(),
    settled: false,
    subAgentVerbosity: 'summary',
  });
}

function addQueuedTask(bridge: OpenCodeBridge, taskId: string) {
  const b = bridge as any;
  b.localQueue.push({
    taskId,
    instruction: `instruction for ${taskId}`,
    onOutput: vi.fn(),
    onComplete: vi.fn(),
    onFail: vi.fn(),
    options: {},
  });
}

describe('OpenCodeBridge sessionBusy', () => {
  let bridge: OpenCodeBridge;

  beforeEach(() => {
    bridge = createBridge();
    vi.useFakeTimers();
  });

  describe('isSessionBusy', () => {
    it('should return false when no pending tasks and sessionBusy is false', () => {
      const b = bridge as any;
      expect(b.isSessionBusy()).toBe(false);
    });

    it('should return true when sessionBusy flag is set', () => {
      const b = bridge as any;
      b.sessionBusy = true;
      expect(b.isSessionBusy()).toBe(true);
    });

    it('should return true when there are pending tasks', () => {
      addPendingTask(bridge, 'task-1');
      const b = bridge as any;
      expect(b.isSessionBusy()).toBe(true);
    });
  });

  describe('handleSessionStatus', () => {
    it('should set sessionBusy=true when status is busy', () => {
      const b = bridge as any;
      b.handleSessionStatus({ sessionID: 'test-session', status: { type: 'busy' } });
      expect(b.sessionBusy).toBe(true);
    });

    it('should set sessionBusy=false when status is not busy', () => {
      const b = bridge as any;
      b.sessionBusy = true;
      b.handleSessionStatus({ sessionID: 'test-session', status: { type: 'idle' } });
      expect(b.sessionBusy).toBe(false);
    });

    it('should ignore status for different session', () => {
      const b = bridge as any;
      b.sessionBusy = false;
      b.handleSessionStatus({ sessionID: 'other-session', status: { type: 'busy' } });
      expect(b.sessionBusy).toBe(false);
    });

    it('should ignore undefined props', () => {
      const b = bridge as any;
      b.handleSessionStatus(undefined);
      expect(b.sessionBusy).toBe(false);
    });
  });

  describe('handleSessionError (the bugfix)', () => {
    it('should reset sessionBusy to false after error', () => {
      const b = bridge as any;
      b.sessionBusy = true;
      addPendingTask(bridge, 'task-1');

      b.handleSessionError({ sessionID: 'test-session', error: { message: 'MessageAbortedError' } });

      expect(b.sessionBusy).toBe(false);
    });

    it('should settle all pending tasks with error message', () => {
      const onFail1 = vi.fn();
      const onFail2 = vi.fn();
      addPendingTask(bridge, 'task-1', onFail1);
      addPendingTask(bridge, 'task-2', onFail2);

      const b = bridge as any;
      b.handleSessionError({ sessionID: 'test-session', error: { message: 'Some error' } });

      expect(onFail1).toHaveBeenCalledWith('task-1', expect.stringContaining('Some error'));
      expect(onFail2).toHaveBeenCalledWith('task-2', expect.stringContaining('Some error'));
    });

    it('should call scheduleIdleDrain after error to drain queued tasks', () => {
      const b = bridge as any;
      b.sessionBusy = true;
      addPendingTask(bridge, 'task-1');
      addQueuedTask(bridge, 'task-2');

      b.handleSessionError({ sessionID: 'test-session', error: { message: 'fail' } });

      expect(b.sessionBusy).toBe(false);
      expect(b.idleDrainTimer).toBeDefined();
    });

    it('should not settle already-settled tasks', () => {
      const onFail = vi.fn();
      addPendingTask(bridge, 'task-1', onFail);
      const b = bridge as any;
      b.pending.get('task-1').settled = true;

      b.handleSessionError({ sessionID: 'test-session', error: { message: 'fail' } });

      expect(onFail).not.toHaveBeenCalled();
    });

    it('should ignore errors for different session (sub-agent errors)', () => {
      const b = bridge as any;
      b.sessionBusy = true;
      addPendingTask(bridge, 'task-1');

      b.handleSessionError({ sessionID: 'other-session', error: { message: 'sub-agent fail' } });

      expect(b.sessionBusy).toBe(true);
      expect(b.pending.has('task-1')).toBe(true);
    });

    it('should ignore undefined props', () => {
      const b = bridge as any;
      b.sessionBusy = true;
      b.handleSessionError(undefined);
      expect(b.sessionBusy).toBe(true);
    });
  });

  describe('handleSessionIdle', () => {
    it('should reset sessionBusy to false', () => {
      const b = bridge as any;
      b.sessionBusy = true;
      addPendingTask(bridge, 'task-1');

      b.handleSessionIdle({ sessionID: 'test-session' });

      expect(b.sessionBusy).toBe(false);
    });

    it('should ignore idle for different session (sub-agent idle)', () => {
      const b = bridge as any;
      b.sessionBusy = true;

      b.handleSessionIdle({ sessionID: 'other-session' });

      expect(b.sessionBusy).toBe(true);
    });

    it('should ignore undefined props', () => {
      const b = bridge as any;
      b.handleSessionIdle(undefined);
    });
  });

  describe('confirmAndDrain', () => {
    it('should not drain when session is busy', () => {
      const b = bridge as any;
      b.sessionBusy = true;
      addQueuedTask(bridge, 'task-1');

      b.confirmAndDrain();

      expect(b.localQueue).toHaveLength(1);
    });

    it('should not drain when there are pending tasks', () => {
      addPendingTask(bridge, 'task-1');
      addQueuedTask(bridge, 'task-2');
      const b = bridge as any;

      b.confirmAndDrain();

      expect(b.localQueue).toHaveLength(1);
    });

    it('should not drain when queue is empty', () => {
      const b = bridge as any;
      b.confirmAndDrain();
      expect(b.localQueue).toHaveLength(0);
    });
  });

  describe('scheduleIdleDrain', () => {
    it('should not schedule when queue is empty', () => {
      const b = bridge as any;
      b.scheduleIdleDrain();
      expect(b.idleDrainTimer).toBeUndefined();
    });

    it('should schedule when queue has items', () => {
      addQueuedTask(bridge, 'task-1');
      const b = bridge as any;
      b.scheduleIdleDrain();
      expect(b.idleDrainTimer).toBeDefined();
    });

    it('should not create duplicate timer', () => {
      addQueuedTask(bridge, 'task-1');
      const b = bridge as any;
      b.scheduleIdleDrain();
      const firstTimer = b.idleDrainTimer;
      b.scheduleIdleDrain();
      expect(b.idleDrainTimer).toBe(firstTimer);
    });
  });

  describe('end-to-end: error recovery enables queue drain', () => {
    it('should allow queued tasks to drain after error resets sessionBusy', () => {
      const b = bridge as any;
      b.sessionBusy = true;

      addPendingTask(bridge, 'task-1');
      addQueuedTask(bridge, 'task-2');

      b.handleSessionError({ sessionID: 'test-session', error: { message: 'MessageAbortedError' } });

      expect(b.sessionBusy).toBe(false);
      expect(b.pending.size).toBe(0);
      expect(b.idleDrainTimer).toBeDefined();
      expect(b.localQueue).toHaveLength(1);
    });
  });
});
