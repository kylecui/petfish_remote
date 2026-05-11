export type Platform = 'telegram' | 'slack' | 'feishu' | 'wecom' | 'discord' | 'web';

export type ExecutionMode = 'read_only' | 'suggest' | 'edit_guarded' | 'execute_guarded' | 'admin';

export type UserRole = 'admin' | 'operator' | 'viewer';

export const DEFAULT_MODES_BY_ROLE: Record<UserRole, ExecutionMode[]> = {
  admin: ['read_only', 'suggest', 'edit_guarded', 'execute_guarded', 'admin'],
  operator: ['read_only', 'suggest', 'edit_guarded', 'execute_guarded'],
  viewer: ['read_only'],
};

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, operator: 1, admin: 2 };

export function hasMinimumRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

export const COMMAND_MIN_ROLE: Record<string, UserRole> = {
  help: 'viewer',
  list: 'viewer',
  where: 'viewer',
  status: 'viewer',
  sessions: 'viewer',
  log: 'viewer',
  diff: 'viewer',
  ask: 'operator',
  edit: 'operator',
  test: 'operator',
  use: 'operator',
  new: 'operator',
  switch: 'operator',
  model: 'operator',
  pr: 'operator',
  commit: 'operator',
  approve: 'operator',
  deny: 'operator',
  stop: 'operator',
  doctor: 'operator',
  audit: 'admin',
  users: 'admin',
  role: 'admin',
};

export type TaskStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_user_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export type RuntimeType = 'local' | 'wsl' | 'ssh' | 'hyperv' | 'vmware' | 'docker' | 'server' | 'connector';

export interface ChatEvent {
  platform: Platform;
  chat_id: string;
  user_id: string;
  username: string;
  message_id: string;
  text: string;
  attachments: string[];
  timestamp: string;
}

export interface ChatResponse {
  platform: Platform;
  chat_id: string;
  reply_to?: string;
  message_type: 'text' | 'markdown';
  text: string;
}

export interface TaskRecord {
  task_id: string;
  project_id: string;
  user_id: string;
  instruction: string;
  mode: ExecutionMode;
  status: TaskStatus;
  risk_level?: RiskLevel;
  opencode_session_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ApprovalRecord {
  approval_id: string;
  task_id: string;
  action_type: string;
  action_payload: string;
  risk_level: RiskLevel;
  status: ApprovalStatus;
  requested_at: string;
  decided_at?: string;
}

export interface ProjectConfig {
  id: string;
  name: string;
  runtime: string;
  path: string;
  default_mode: ExecutionMode;
  default_agent?: string;
  allowed_users: string[];
  readme_files: string[];
  test_commands: Record<string, string>;
  risk_profile: string;
  secrets_policy: string;
}

export interface RuntimeConfig {
  id: string;
  type: RuntimeType;
  name: string;
  shell?: string;
  working_root: string;
  opencode_bin?: string;
  path_style: 'linux' | 'windows';
  host?: string;
  port?: number;
  user?: string;
  identity_file?: string;
  distro?: string;
  base_url?: string;
  container?: string;
}

export interface UserConfig {
  id: string;
  name: string;
  role: UserRole;
  allowed_projects: string[];
  allowed_modes: ExecutionMode[];
}

export interface SessionState {
  id: string;
  platform: Platform;
  chat_id: string;
  project_id: string;
  opencode_session_id?: string;
  active_task_id?: string;
  mode: ExecutionMode;
  updated_at: string;
}

export type PolicyDecision = 'allow' | 'deny' | 'require_approval';

export interface AuditEvent {
  id: string;
  task_id?: string;
  user_id?: string;
  event_type: string;
  payload: string;
  created_at: string;
}
