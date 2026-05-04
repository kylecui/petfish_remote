import type { ApprovalRecord, TaskRecord } from '../types.js';

export class ApprovalRenderer {
  public renderApprovalRequest(approval: ApprovalRecord, task: TaskRecord): string {
    return [
      `Approval requested: ${approval.approval_id}`,
      `Task: ${task.task_id}`,
      `Action: ${approval.action_type}`,
      `Risk: ${approval.risk_level}`,
      `Payload: ${approval.action_payload}`,
    ].join('\n');
  }

  public renderApprovalResult(approval: ApprovalRecord): string {
    return [
      `Approval: ${approval.approval_id}`,
      `Status: ${approval.status}`,
      `Requested: ${approval.requested_at}`,
      `Decided: ${approval.decided_at ?? 'N/A'}`,
    ].join('\n');
  }
}
