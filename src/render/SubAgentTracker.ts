export type SubAgentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface SubAgentRecord {
  childSessionId: string;
  parentSessionId: string;
  agentName: string;
  status: SubAgentStatus;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

const MAX_ERROR_MESSAGES_PER_PARENT = 3;
const PARENT_ID_CHAIN_DEPTH = 5;

export class SubAgentTracker {
  private readonly agents = new Map<string, SubAgentRecord>();
  private readonly parentToChildren = new Map<string, Set<string>>();
  private errorCount = 0;
  private onError?: (text: string) => void;

  setErrorCallback(cb: (text: string) => void): void {
    this.onError = cb;
  }

  register(childSessionId: string, parentSessionId: string, agentName: string): void {
    if (this.agents.has(childSessionId)) return;

    const rootParent = this.resolveRootParent(parentSessionId);

    const record: SubAgentRecord = {
      childSessionId,
      parentSessionId: rootParent,
      agentName,
      status: 'running',
      startedAt: Date.now(),
    };
    this.agents.set(childSessionId, record);

    let children = this.parentToChildren.get(rootParent);
    if (!children) {
      children = new Set();
      this.parentToChildren.set(rootParent, children);
    }
    children.add(childSessionId);
  }

  markCompleted(childSessionId: string): void {
    const record = this.agents.get(childSessionId);
    if (!record || record.status !== 'running') return;
    record.status = 'completed';
    record.completedAt = Date.now();
  }

  markFailed(childSessionId: string, error: string): void {
    const record = this.agents.get(childSessionId);
    if (!record || record.status !== 'running') return;
    record.status = 'failed';
    record.completedAt = Date.now();
    record.error = error;

    if (this.errorCount < MAX_ERROR_MESSAGES_PER_PARENT) {
      this.errorCount++;
      this.onError?.(`⚠️ Sub-agent failed: ${record.agentName} — ${error}`);
    }
  }

  markCancelled(childSessionId: string): void {
    const record = this.agents.get(childSessionId);
    if (!record || record.status !== 'running') return;
    record.status = 'cancelled';
    record.completedAt = Date.now();
  }

  getSummary(): string | undefined {
    if (this.agents.size === 0) return undefined;

    const records = [...this.agents.values()];
    const allDone = records.every((r) => r.status !== 'running');
    if (!allDone) return undefined;

    return this.buildSummaryLine(records);
  }

  getStatus(): string {
    if (this.agents.size === 0) return 'No sub-agents in current session.';

    const lines = ['🔧 Current session sub-agents:'];
    for (const r of this.agents.values()) {
      const duration = r.completedAt ? `${Math.round((r.completedAt - r.startedAt) / 1000)}s` : 'running';
      const statusIcon = r.status === 'completed' ? '✅' : r.status === 'failed' ? '❌' : r.status === 'cancelled' ? '⏹' : '⏳';
      let line = `  ${statusIcon} ${r.agentName} ${r.status} (${duration})`;
      if (r.error) line += `: ${r.error}`;
      lines.push(line);
    }
    return lines.join('\n');
  }

  hasAgents(): boolean {
    return this.agents.size > 0;
  }

  reset(): void {
    this.agents.clear();
    this.parentToChildren.clear();
    this.errorCount = 0;
  }

  private resolveRootParent(parentSessionId: string): string {
    let current = parentSessionId;
    for (let depth = 0; depth < PARENT_ID_CHAIN_DEPTH; depth++) {
      const parentRecord = this.findByChildSession(current);
      if (!parentRecord) break;
      current = parentRecord.parentSessionId;
    }
    return current;
  }

  private findByChildSession(sessionId: string): SubAgentRecord | undefined {
    return this.agents.get(sessionId);
  }

  private buildSummaryLine(records: SubAgentRecord[]): string {
    const totalDurationMs = records.reduce((max, r) => {
      const dur = (r.completedAt ?? Date.now()) - r.startedAt;
      return Math.max(max, dur);
    }, 0);
    const totalDurationSec = Math.round(totalDurationMs / 1000);

    const grouped = new Map<string, { completed: number; failed: number; cancelled: number }>();
    for (const r of records) {
      let group = grouped.get(r.agentName);
      if (!group) {
        group = { completed: 0, failed: 0, cancelled: 0 };
        grouped.set(r.agentName, group);
      }
      if (r.status === 'completed') group.completed++;
      else if (r.status === 'failed') group.failed++;
      else if (r.status === 'cancelled') group.cancelled++;
    }

    const hasFailures = records.some((r) => r.status === 'failed');
    const hasCancelled = records.some((r) => r.status === 'cancelled');

    if (records.length === 1) {
      const r = records[0];
      const icon = r.status === 'completed' ? '✅' : r.status === 'failed' ? '❌' : '⏹';
      return `🔧 Sub-agent: ${r.agentName} ${icon} (${totalDurationSec}s)`;
    }

    const parts: string[] = [];
    for (const [name, counts] of grouped) {
      const total = counts.completed + counts.failed + counts.cancelled;
      if (counts.failed > 0 && (counts.completed > 0 || counts.cancelled > 0)) {
        const segments: string[] = [];
        if (counts.completed > 0) segments.push(`✅ ${name}(${counts.completed})`);
        if (counts.failed > 0) segments.push(`❌ ${name}(${counts.failed} failed)`);
        if (counts.cancelled > 0) segments.push(`⏹ ${name}(${counts.cancelled} cancelled)`);
        parts.push(...segments);
      } else if (counts.failed > 0) {
        parts.push(`❌ ${name}(${counts.failed} failed)`);
      } else if (counts.cancelled > 0) {
        parts.push(`⏹ ${name}(${counts.cancelled} cancelled)`);
      } else {
        parts.push(`${name}(${total})`);
      }
    }

    const prefix = hasFailures || hasCancelled
      ? `🔧 ${records.length} sub-agents: `
      : `🔧 ${records.length} sub-agents: `;

    if (!hasFailures && !hasCancelled) {
      return `${prefix}${parts.join(', ')} · ${totalDurationSec}s`;
    }
    return `${prefix}${parts.join(', ')} · ${totalDurationSec}s`;
  }
}
