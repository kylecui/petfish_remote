# Roadmap

> Updated: 2026-05-10
> Reprioritized: Stability root-cause fixes (formerly v0.6) escalated into v0.2-rc.
> Rationale: `research/06_outputs/root-cause-and-redesign.md`

## Related Design Docs

- [Root-Cause Research Report](../research/06_outputs/root-cause-and-redesign.md)
- [Shared Session Architecture](./design/shared-session-architecture.md)
- [Phase 1: Root Session Binding](./design/phase-1-root-session-binding.md)
- [Phase 2: Request Lifecycle](./design/phase-2-request-lifecycle.md)
- [IM Interaction Model](./design/im-interaction-model.md)
- [Implementation Plan](./design/shared-session-implementation-plan.md)

## V0.1 — Telegram + CLI Runner ✅

- Telegram Bot with long polling
- /pf help, list, use, ask, status, stop
- opencode CLI runner (local runtime)
- SQLite task recording
- Basic audit logging

## V0.2-rc — Stability Root-Cause Fixes 🔴 ← NEW

> 研究发现当前不稳定的根因是三个错误的 API 使用模式。
> 此阶段在 v0.2 功能开发之前完成，专注于修复根因。

- STAB-0: 引入 `@opencode-ai/sdk`，消除 `execSync(curl)` 事件循环阻塞
- STAB-1: 替换 `/tui/*` prompt 注入为 `/session/:id/message`
- STAB-2: 显式 root-session 绑定，消除 session 漂移
- STAB-3: SSE `session.idle` 替换全局 busy 轮询

Tracking: `tasks/backlog.md` §P0

## V0.2 — Task State Machine + Approval

- TaskManager with full state machine
- PolicyEngine with allow/deny/require_approval
- ApprovalManager with /pf approve and /pf deny
- /pf diff command
- Command whitelist enforcement

## V0.3 — IM Session UX + Multi-Runtime

> 原 v0.6/v0.7 的 IM 体验部分，在 STAB 修复后自然成为下一优先级。

- IM 独立交互模型 (current session card, fork/switch flows)
- Child/subagent session attribution under root session
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
