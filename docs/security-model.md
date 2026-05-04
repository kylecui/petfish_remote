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
