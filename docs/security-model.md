# Security Model

## Threat Model

| Threat | Mitigation |
|---|---|
| Unauthorized user controls agent | Platform ID whitelist in users.yaml |
| Project unauthorized access | Per-project `allowed_users` |
| Path traversal | Projects must be within runtime `working_root` |
| Secret leakage | Default deny on .env, private keys, tokens |
| Dangerous command execution | Command deny/approval rules in policies.yaml |
| Git destructive operations | Default deny on push, reset --hard, force push |
| Prompt injection | Controlled prompt templates, mode enforcement |
| Audit log leakage | Sensitive data filtered before logging |
| Group chat misfires | Require explicit @bot or /pf prefix |

## Execution Modes

All remote tasks default to `read_only`. Escalation requires explicit user action and may trigger approval flows.

## Policy Engine

Three-tier evaluation: `allow` → `require_approval` → `deny`. Profile inheritance allows project-specific overrides.

## Runtime Security

- All project paths validated against `working_root`
- SSH identity files never logged
- opencode server endpoints must not face public internet
- Docker exec restricted by default

## Role-Based Access Control (RBAC)

- 3 roles: admin, operator, viewer
- First user to register is auto-assigned admin role
- Subsequent users default to viewer
- Admin can promote/demote via `/pf role <user> <role>`
- Operator can dispatch tasks, switch projects, create sessions
- Viewer can read output only (no task dispatch)
- Role assignments stored in SQLite (better-sqlite3)

## Audit Trail

- 9 event types logged: `message_received`, `user_registered`, `command_executed`, `task_dispatched`, `task_completed`, `task_failed`, `permission_denied`, `project_bound`, `session_switched`
- Each event records: timestamp, user ID, platform, event type, metadata
- Viewable via `/pf audit` command (admin only)
- Stored in SQLite alongside user/session data
- Sensitive fields (tokens, secrets) are filtered before logging

## opencode Plugin Security

- Bun plugin hooks: `tool.execute.before` for tool interception, `permission.ask` for auto-handling permission prompts, `experimental.chat.system.transform` for context injection
- Tool interception intercepts dangerous operations before they reach opencode
- Permission auto-handling responds to opencode's permission prompts based on policy engine rules
- Context injection adds project metadata and user identity to system prompts
- Plugin runs in same process as opencode — no network boundary

## WebSocket & Transport Security

- All connector↔server communication over WSS (TLS encrypted)
- Token-based authentication on WebSocket upgrade handshake
- Connector tokens are permanent base64url strings, NOT the one-time setup tokens
- Web UI uses API key authentication via `?key=` query parameter
- Web UI WebSocket endpoint at `/ws/web` requires valid API key
- No plaintext fallback — WSS enforced
