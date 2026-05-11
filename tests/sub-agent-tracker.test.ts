import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubAgentTracker } from '../src/render/SubAgentTracker.js';

describe('SubAgentTracker', () => {
  let tracker: SubAgentTracker;

  beforeEach(() => {
    tracker = new SubAgentTracker();
  });

  describe('register', () => {
    it('tracks a new child session', () => {
      tracker.register('child-1', 'parent-1', 'explore');
      expect(tracker.hasAgents()).toBe(true);
    });

    it('ignores duplicate registrations', () => {
      tracker.register('child-1', 'parent-1', 'explore');
      tracker.register('child-1', 'parent-1', 'oracle');
      tracker.markCompleted('child-1');

      const summary = tracker.getSummary();
      expect(summary).toContain('explore');
      expect(summary).not.toContain('oracle');
    });

    it('resolves nested parent chains to root', () => {
      tracker.register('child-1', 'parent-1', 'explore');
      tracker.register('grandchild-1', 'child-1', 'librarian');

      tracker.markCompleted('child-1');
      tracker.markCompleted('grandchild-1');

      const summary = tracker.getSummary();
      expect(summary).toContain('explore');
      expect(summary).toContain('librarian');
    });
  });

  describe('markCompleted', () => {
    it('sets status to completed', () => {
      tracker.register('child-1', 'parent-1', 'oracle');
      tracker.markCompleted('child-1');

      const status = tracker.getStatus();
      expect(status).toContain('✅');
      expect(status).toContain('completed');
    });

    it('ignores unknown session ids', () => {
      tracker.markCompleted('nonexistent');
      expect(tracker.hasAgents()).toBe(false);
    });

    it('ignores already-completed sessions', () => {
      tracker.register('child-1', 'parent-1', 'explore');
      tracker.markCompleted('child-1');
      tracker.markCompleted('child-1');

      const status = tracker.getStatus();
      expect(status).toContain('✅');
    });
  });

  describe('markFailed', () => {
    it('sets status to failed with error message', () => {
      tracker.register('child-1', 'parent-1', 'librarian');
      tracker.markFailed('child-1', 'Could not read file');

      const status = tracker.getStatus();
      expect(status).toContain('❌');
      expect(status).toContain('Could not read file');
    });

    it('fires onError callback', () => {
      const onError = vi.fn();
      tracker.setErrorCallback(onError);

      tracker.register('child-1', 'parent-1', 'librarian');
      tracker.markFailed('child-1', 'timeout');

      expect(onError).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith('⚠️ Sub-agent failed: librarian — timeout');
    });

    it('caps error messages at 3 per parent', () => {
      const onError = vi.fn();
      tracker.setErrorCallback(onError);

      for (let i = 0; i < 5; i++) {
        tracker.register(`child-${i}`, 'parent-1', 'explore');
        tracker.markFailed(`child-${i}`, `error-${i}`);
      }

      expect(onError).toHaveBeenCalledTimes(3);
    });

    it('ignores non-running sessions', () => {
      const onError = vi.fn();
      tracker.setErrorCallback(onError);

      tracker.register('child-1', 'parent-1', 'explore');
      tracker.markCompleted('child-1');
      tracker.markFailed('child-1', 'late error');

      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('markCancelled', () => {
    it('sets status to cancelled', () => {
      tracker.register('child-1', 'parent-1', 'oracle');
      tracker.markCancelled('child-1');

      const status = tracker.getStatus();
      expect(status).toContain('⏹');
      expect(status).toContain('cancelled');
    });
  });

  describe('getSummary', () => {
    it('returns undefined when no agents tracked', () => {
      expect(tracker.getSummary()).toBeUndefined();
    });

    it('returns undefined when agents still running', () => {
      tracker.register('child-1', 'parent-1', 'explore');
      expect(tracker.getSummary()).toBeUndefined();
    });

    it('formats single completed agent', () => {
      tracker.register('child-1', 'parent-1', 'oracle');
      tracker.markCompleted('child-1');

      const summary = tracker.getSummary();
      expect(summary).toMatch(/^🔧 Sub-agent: oracle ✅ \(\d+s\)$/);
    });

    it('formats single failed agent', () => {
      const onError = vi.fn();
      tracker.setErrorCallback(onError);

      tracker.register('child-1', 'parent-1', 'librarian');
      tracker.markFailed('child-1', 'err');

      const summary = tracker.getSummary();
      expect(summary).toMatch(/^🔧 Sub-agent: librarian ❌ \(\d+s\)$/);
    });

    it('formats single cancelled agent', () => {
      tracker.register('child-1', 'parent-1', 'explore');
      tracker.markCancelled('child-1');

      const summary = tracker.getSummary();
      expect(summary).toMatch(/^🔧 Sub-agent: explore ⏹ \(\d+s\)$/);
    });

    it('formats multiple completed agents', () => {
      tracker.register('c-1', 'p-1', 'explore');
      tracker.register('c-2', 'p-1', 'explore');
      tracker.register('c-3', 'p-1', 'oracle');
      tracker.markCompleted('c-1');
      tracker.markCompleted('c-2');
      tracker.markCompleted('c-3');

      const summary = tracker.getSummary()!;
      expect(summary).toContain('🔧 3 sub-agents:');
      expect(summary).toContain('explore(2)');
      expect(summary).toContain('oracle(1)');
      expect(summary).toMatch(/· \d+s$/);
    });

    it('formats mixed success/failure', () => {
      const onError = vi.fn();
      tracker.setErrorCallback(onError);

      tracker.register('c-1', 'p-1', 'explore');
      tracker.register('c-2', 'p-1', 'explore');
      tracker.register('c-3', 'p-1', 'librarian');
      tracker.markCompleted('c-1');
      tracker.markCompleted('c-2');
      tracker.markFailed('c-3', 'err');

      const summary = tracker.getSummary()!;
      expect(summary).toContain('3 sub-agents:');
      expect(summary).toContain('explore(2)');
      expect(summary).toContain('❌ librarian(1 failed)');
    });
  });

  describe('getStatus', () => {
    it('returns empty message when no agents', () => {
      expect(tracker.getStatus()).toBe('No sub-agents in current session.');
    });

    it('shows running agent with duration', () => {
      tracker.register('child-1', 'parent-1', 'explore');
      const status = tracker.getStatus();
      expect(status).toContain('⏳');
      expect(status).toContain('explore');
      expect(status).toContain('running');
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      tracker.register('child-1', 'parent-1', 'explore');
      tracker.markCompleted('child-1');
      tracker.reset();

      expect(tracker.hasAgents()).toBe(false);
      expect(tracker.getSummary()).toBeUndefined();
      expect(tracker.getStatus()).toBe('No sub-agents in current session.');
    });

    it('resets error count', () => {
      const onError = vi.fn();
      tracker.setErrorCallback(onError);

      for (let i = 0; i < 3; i++) {
        tracker.register(`c-${i}`, 'p-1', 'explore');
        tracker.markFailed(`c-${i}`, `err-${i}`);
      }
      expect(onError).toHaveBeenCalledTimes(3);

      tracker.reset();
      onError.mockClear();

      tracker.register('c-new', 'p-1', 'oracle');
      tracker.markFailed('c-new', 'new-err');
      expect(onError).toHaveBeenCalledOnce();
    });
  });

  describe('hasAgents', () => {
    it('returns false initially', () => {
      expect(tracker.hasAgents()).toBe(false);
    });

    it('returns true after registration', () => {
      tracker.register('child-1', 'parent-1', 'explore');
      expect(tracker.hasAgents()).toBe(true);
    });
  });
});
