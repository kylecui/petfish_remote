# Architecture

PetFish Remote is a layered system with clear separation between control plane (chat) and execution plane (opencode).

## Related Design Docs

- [Shared Session Architecture](./design/shared-session-architecture.md)
- [IM Interaction Model](./design/im-interaction-model.md)
- [Question & Permission Relay](./design/question-permission-relay.md)
- [Multi-Agent Support](./design/multi-agent-support.md)

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Chat Adapter Layer                     │
│  Telegram │ Slack │ Feishu │ WeCom │ Web Console         │
└────────────────────────┬────────────────────────────────┘
                         │ ChatEvent
┌────────────────────────▼────────────────────────────────┐
│  Command Router Layer           Permission Layer         │
│  /pf commands + NL parsing      RBAC (admin/op/viewer)   │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  Session Manager    │  Task Manager    │  Policy Engine   │
│  Root session bind  │  State machine   │  Allow/deny/     │
│  Cross-project      │  Lifecycle       │  require_approval│
│  isolation          │  tracking        │                  │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  Connector Gateway (WebSocket)                           │
│  Connector registry, project→connector routing           │
│  noServer mode with route-based upgrade (/ws, /ws/web)   │
└────────────────────────┬────────────────────────────────┘
                         │ WSS
┌────────────────────────▼────────────────────────────────┐
│  Connector + Runtime Router                              │
│  Local │ SSH │ WSL (planned) │ Docker (planned)          │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  Session Bridge (OpenCodeBridge)                         │
│  @opencode-ai/sdk │ SSE events │ SubAgentTracker         │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  opencode Plugin (petfish-plugin.ts)                     │
│  Tool interception │ Permission auto-handling │ Context   │
└─────────────────────────────────────────────────────────┘
```

## Layers

### Chat Adapter Layer

Handles platform-specific message ingestion and response delivery. Converts platform messages to unified `ChatEvent` format.

| Adapter | Transport | Interactive Elements | Char Limit |
|---------|-----------|---------------------|------------|
| Telegram | grammY long-poll / webhook | InlineKeyboard | 4,096 |
| Slack | @slack/bolt Socket Mode | Block Kit buttons | 4,000 |
| Feishu | @larksuiteoapi/node-sdk webhook | Interactive cards | 30,000 |
| WeCom | @wecom/aibot-node-sdk WebSocket | Template cards | 4,000 |
| Web | Native WebSocket (`/ws/web`) | HTML buttons | 65,536 |

Each adapter implements the `IMAdapter` interface: `sendMessage(ChatResponse)`, typing indicators, interactive elements (menus, project selection, session switching).

### Command Router Layer

Parses both explicit `/pf` commands and natural language input into structured task requests. Infers execution mode from language cues.

Supported commands: `help`, `list`, `use`, `new`, `sessions`, `switch`, `ask`, `edit`, `status`, `stop`, `diff`, `test`, `commit`, `pr`, `doctor`, `approve`, `deny`, `model`, `agents`, `subagents`, `users`, `audit`, `role`, `log`, `where`.

### Permission Layer

Role-based access control with three tiers:

| Role | Commands | Modes |
|------|----------|-------|
| **admin** | All commands + `/pf users`, `/pf audit`, `/pf role` | ask, edit |
| **operator** | Task commands + `/pf approve`, `/pf deny` | ask, edit |
| **viewer** | Read-only: help, list, where, status, sessions, log, diff | ask |

First user auto-registered as admin; subsequent users as viewer. Roles managed via `/pf role <userId> <role>`.

Audit trail tracks 9 event types: `message_received`, `user_registered`, `command_executed`, `task_dispatched`, `task_completed`, `task_failed`, `permission_denied`, `project_bound`, `session_switched`.

### Project Registry Layer

Manages the allowlist of remotely controllable projects. Each project binds to a runtime, has allowed users, test commands, and a risk profile.

Online/offline awareness: connector disconnect triggers `removeProjectsByConnector()` cleanup. `/pf list` only shows projects with active connectors. Task dispatch to offline projects returns an immediate error instead of 30-second retry timeout.

### Session Manager Layer

Tracks chat-to-project bindings and active root sessions. Prevents cross-project context pollution. Responsible for explicit session ownership rather than latest-session discovery.

Key behaviors:
- `rediscover()` validates existing session before switching (prevents session drift)
- `requestNewSession()` resets state cleanly (busy flag, message counter, depth warning)
- Sub-agent verbosity setting persisted per session in SQLite

### Task Manager Layer

Creates, schedules, and tracks tasks through the state machine: `created → queued → running → completed/failed/cancelled/timeout`.

State transitions enforced via `VALID_TRANSITIONS` table. Terminal states (`completed`, `failed`, `cancelled`, `timeout`) accept no outbound transitions. **All status changes must go through `updateStatus()`** — direct storage updates bypass the guard.

### Policy Engine Layer

Evaluates actions against allow/deny/require_approval rules. Supports profile inheritance.

- `policyEngine.evaluate()` runs before every task dispatch
- `evaluateCommand()` checks command whitelist before execution
- Blocked targets: `.env`, `id_rsa`, `secret` (configurable)
- Approval-required actions: `write`, `exec`, `docker` (configurable)

### Approval Manager Layer

Creates approval requests for risky operations, delivers them via chat, and processes `/pf approve` / `/pf deny` responses.

### Connector Gateway Layer

HTTP + WebSocket server with `noServer: true` mode. Routes WebSocket upgrades via `wsRoutes` Map:
- `/ws` — connector connections (token-based auth)
- `/ws/web` — web console connections (API key auth)

Manages connector registry with project→connector mapping. Emits `connector:change` events on connect/disconnect.

### Runtime Router + Connector Layer

Routes task execution to the correct environment.

| Runtime | Status | Transport |
|---------|--------|-----------|
| Local | ✅ Active | Direct process |
| SSH | ✅ Active | SSH exec with streaming |
| WSL | 🔲 Planned | Stubbed |
| Docker | 🔲 Planned | — |

### Session Bridge (OpenCodeBridge)

Core bridge between connector and opencode, using `@opencode-ai/sdk`:

- **Prompt injection**: `client.session.promptAsync()` (replaced legacy TUI injection)
- **Event streaming**: SSE subscription for `message.updated`, `message.part.updated`, `session.idle`, `session.compacted`
- **File changes**: `client.session.diff()` for changed file summaries
- **Model override**: Per-prompt model override via SDK (sticky, cleared with `/pf model clear`)
- **Depth monitoring**: Message counter with warning at ~250 messages
- **Compaction detection**: `session.compacted` SSE event triggers warning

### Sub-Agent Tracker

`SubAgentTracker` monitors child sessions spawned by the root opencode session:

- Intercepts `session.created` SSE events to detect child sessions
- Tracks lifecycle: running → idle / error
- Configurable verbosity: `silent` (suppress all), `summary` (aggregated on parent completion), `verbose` (real-time events)
- Error forwarding via callback to parent task output

### opencode Plugin

Self-contained Bun plugin (`petfish-plugin.ts`) installed per-project by the connector:

- **`tool.execute.before`** — block/warn risky tools based on execution mode and policy
- **`tool.execute.after`** — log tool completions
- **`permission.ask`** — auto-allow/deny based on mode and policy
- **`experimental.chat.system.transform`** — inject PetFish context into system prompts
- **`petfish_status` custom tool** — reports execution mode, policy summary, project info

### Storage Layer

SQLite-backed persistence via better-sqlite3 for users, sessions, tasks, approvals, audit logs, and sub-agent verbosity settings. Schema migrations run on startup.

### Render Layer

Formats structured data into mobile-friendly chat messages. `OutputBatcher` collects streaming chunks and flushes on intervals, respecting per-platform character limits.

| Policy | Char Limit | Format |
|--------|-----------|--------|
| `telegramRenderPolicy` | 4,096 | Telegram markdown |
| `slackRenderPolicy` | 4,000 | Slack mrkdwn |
| `feishuRenderPolicy` | 30,000 | Feishu markdown |
| `wecomRenderPolicy` | 4,000 | WeCom markdown |
| `webRenderPolicy` | 65,536 | Standard markdown |

**Important**: `OutputBatcher` must receive the correct render policy at construction time. Mismatched policies cause silent message truncation.

### Self-Daemonizing Connector

The connector supports daemon mode via a supervisor process:

- `node main.js start <config>` — fork detached supervisor, write PID to `~/.petfish/connector.pid`
- `node main.js stop` — send SIGTERM via PID
- `node main.js status` — check PID liveness
- Auto-respawn on crash with exponential backoff (1s → 2s → 4s → max 60s, reset after 5min stable)
- Worker logs redirected to `~/.petfish/connector.log`
