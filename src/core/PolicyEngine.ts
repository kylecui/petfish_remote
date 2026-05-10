import type { PolicyDecision } from '../types.js';
import type { SupportedCommandName } from './CommandRouter.js';

export interface PolicyAction {
  type: 'read' | 'write' | 'exec' | 'git' | 'docker';
  target: string;
  project_profile: string;
}

export interface PolicyConfig {
  blockedTargets: string[];
  highRiskProfiles: string[];
  requireApprovalActions: Array<PolicyAction['type']>;
  commandWhitelist?: SupportedCommandName[];
  approvalRequiredCommands?: SupportedCommandName[];
}

export class PolicyEngine {
  public constructor(private readonly config: PolicyConfig) {}

  public evaluate(action: PolicyAction): PolicyDecision {
    if (this.config.blockedTargets.some((blocked) => action.target.includes(blocked))) {
      return 'deny';
    }

    if (this.config.highRiskProfiles.includes(action.project_profile)) {
      return 'require_approval';
    }

    if (this.config.requireApprovalActions.includes(action.type)) {
      return 'require_approval';
    }

    return 'allow';
  }

  public evaluateCommand(command: SupportedCommandName): PolicyDecision {
    const { commandWhitelist, approvalRequiredCommands } = this.config;

    if (commandWhitelist && !commandWhitelist.includes(command)) {
      return 'deny';
    }

    if (approvalRequiredCommands?.includes(command)) {
      return 'require_approval';
    }

    return 'allow';
  }
}
