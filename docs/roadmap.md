# Roadmap

> Updated: 2026-05-13
> All phases through V0.4 are complete. 161 commits, 95 tests passing.
> See [CHANGELOG.md](../CHANGELOG.md) for detailed commit history.

## Related Design Docs

- [Root-Cause Research Report](../research/06_outputs/root-cause-and-redesign.md)
- [Shared Session Architecture](./design/shared-session-architecture.md)
- [Phase 1: Root Session Binding](./design/phase-1-root-session-binding.md)
- [Phase 2: Request Lifecycle](./design/phase-2-request-lifecycle.md)
- [IM Interaction Model](./design/im-interaction-model.md)
- [Implementation Plan](./design/shared-session-implementation-plan.md)

---

## V0.1 — Telegram + CLI Runner ✅

- Telegram Bot with long polling (grammY)
- `/pf` commands: help, list, use, ask, status, stop
- opencode CLI runner (local runtime)
- SQLite task recording
- Basic audit logging

## V0.2-rc — Stability Root-Cause Fixes ✅

> 研究发现当前不稳定的根因是三个错误的 API 使用模式。
> 此阶段在 v0.2 功能开发之前完成，专注于修复根因。
> Incident report: [2026-05-10 Stability Root Cause](./incidents/2026-05-10-stability-root-cause.md)

- STAB-0: 引入 `@opencode-ai/sdk`，消除 `execSync(curl)` 事件循环阻塞 (11→0)
- STAB-1: 替换 `/tui/*` prompt 注入为 SDK `session.promptAsync()`
- STAB-2: 显式 root-session 绑定，消除 session 漂移
- STAB-3: SSE `session.idle` 替换全局 busy 轮询
- ROUTE-0: 跨项目路由隔离 — disconnect cleanup + list filter + dispatch guard

## V0.2 — Task State Machine + Approval ✅

- TaskManager with full state machine and transition guards
- PolicyEngine with allow/deny/require_approval
- ApprovalManager with `/pf approve` and `/pf deny`
- `/pf diff` command
- Command whitelist enforcement
- WebSocket reliability hardening (replay, reconnection, churn reduction)
- Feishu adapter parity with Telegram

## V0.3 — Commands + Runtime Health ✅

- `/pf doctor` — gateway diagnostics + connector/session visibility
- `/pf test`, `/pf commit`, `/pf pr` — command routing and dispatch
- API documentation (`docs/api.md`)
- Development guide (`docs/development.md`)

## V0.4 — Multi-Platform + Full Feature Set ✅

> The largest release — 13 feature phases (P4a through P4k + P4i + P4j Phase 2).

### Platform Adapters
- **P4e: Slack adapter** — @slack/bolt Socket Mode, Block Kit cards, full `/pf` routing
- **P4e: WeCom adapter** — @wecom/aibot-node-sdk WebSocket, template cards, full `/pf` routing
- **P4f: Web console** — WebSocket on `/ws/web`, dark-themed browser UI, API key auth, noServer WSS routing

### Session & Project
- **P4a: Changed files summary** — `FileChange[]` threaded through full pipeline, `DiffRenderer` redesigned
- **P4b: IM session cards & switching** — `/pf sessions` + `/pf switch <n>`, protocol + bridge + gateway + renderer

### Runtime & Connector
- **P4c: SSH runtime connector** — `SshRuntime` with health check, streaming exec, timeout, process management
- **P4d: Self-daemonizing connector** — supervisor/watchdog, start/stop/status CLI, auto-respawn with exponential backoff

### Permissions & Security
- **P4g: Multi-user permissions & audit trail** — `UserRole` types, auto-registration, role-based command/mode access control, 9-event audit trail, admin commands

### opencode Integration
- **P4h: opencode plugin** — Bun plugin with tool interception, permission auto-handling, context injection, custom `petfish_status` tool
- **P4j: Sub-agent attribution** — `SubAgentTracker`, child session detection via SSE, configurable verbosity, `/pf agents` + `/pf subagents` commands

### UX & Reliability
- **P4i: Menu redesign** — grouped layout, role-based admin row visibility, all 5 adapters updated
- **P4k: Compaction bug mitigations** — error detection, `/pf model` override command, session depth warning, `session.compacted` event tracking

---

## Future (V1.0+)

### Planned
- [ ] Server-side render policy for sub-agent output — use `formatSubAgentSummary()` / `formatSubAgentError()` (already implemented in all 5 render policies)
- [ ] WSL runtime connector — `WslRuntime` stubbed, similar pattern to SSH
- [ ] Track upstream opencode compaction fix (anomalyco/opencode#14367)

### Under Consideration
- [ ] Docker runtime connector
- [ ] `/pf commit` and `/pf pr` with interactive confirmation
- [ ] Full audit trail UI in web console
- [ ] Diff viewer in web console
- [ ] Plugin marketplace / remote policy management
