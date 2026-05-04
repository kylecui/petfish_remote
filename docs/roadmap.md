# Roadmap

## V0.1 — Telegram + CLI Runner
- Telegram Bot with long polling
- /pf help, list, use, ask, status, stop
- opencode CLI runner (local runtime)
- SQLite task recording
- Basic audit logging

## V0.2 — Task State Machine + Approval
- TaskManager with full state machine
- PolicyEngine with allow/deny/require_approval
- ApprovalManager with /pf approve and /pf deny
- /pf diff command
- Command whitelist enforcement

## V0.3 — opencode SDK + Multi-Runtime
- OpenCodeSdkRunner with session reuse
- Event stream monitoring
- WSL and SSH runtime connectors
- Runtime health check (/pf doctor)

## V0.4 — Diff + Test Integration
- /pf test with preset commands
- /pf commit message generation
- /pf pr description generation
- Changed files summary rendering

## V0.5 — opencode Plugin
- opencode-petfish-plugin
- Real-time event hooks
- Granular action interception
- Progress streaming to chat

## V1.0 — Multi-Platform
- Slack adapter
- Feishu adapter
- WeCom adapter
- Web console
- Multi-user permissions
- Full audit trail UI
