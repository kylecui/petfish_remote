import { nanoid } from 'nanoid';

import type { Storage } from '../storage/sqlite.js';
import type { ApprovalRecord, ApprovalStatus, RiskLevel } from '../types.js';

export interface CreateApprovalParams {
  task_id: string;
  action_type: string;
  action_payload: string;
  risk_level: RiskLevel;
}

export class ApprovalManager {
  public constructor(private readonly storage: Storage) {}

  public createApproval(params: CreateApprovalParams): ApprovalRecord {
    const now = new Date().toISOString();
    const approval: ApprovalRecord = {
      approval_id: nanoid(),
      task_id: params.task_id,
      action_type: params.action_type,
      action_payload: params.action_payload,
      risk_level: params.risk_level,
      status: 'pending',
      requested_at: now,
    };

    this.storage.createApproval(approval);
    return approval;
  }

  public approve(approvalId: string): void {
    this.updateApprovalStatus(approvalId, 'approved');
  }

  public deny(approvalId: string): void {
    this.updateApprovalStatus(approvalId, 'denied');
  }

  public getPendingApproval(taskId: string): ApprovalRecord | undefined {
    return this.storage.getPendingApproval(taskId);
  }

  private updateApprovalStatus(approvalId: string, status: ApprovalStatus): void {
    const approval = this.storage.getApproval(approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    const updated: ApprovalRecord = {
      ...approval,
      status,
      decided_at: new Date().toISOString(),
    };

    this.storage.updateApproval(updated);
  }
}
