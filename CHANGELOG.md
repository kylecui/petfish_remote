# Changelog

All notable changes to PetFish Remote are documented here.

> Format: phases map to roadmap milestones. Each entry links to the commit hash and backlog section where applicable.

---

## Connector Patch Releases (2026-05-13 ~ 2026-05-14)

### v0.2.2 — Reject cross-project session/port fallback

- **Fix**: `discoverSession()` and `discoverPort()` no longer fall back to sessions/ports from unrelated projects when no match is found for `this.cwd`. Callers (`rediscover()`, `prompt()`) already handle `undefined` gracefully. (`ab3fd44`)

### v0.2.1 — Pass parentID to maintain conversation continuity

- **Fix**: `injectPrompt()` now passes `parentID` (last completed assistant message ID) in `promptAsync` calls, so each prompt continues the existing conversation thread instead of starting fresh. This was the root cause of the bot always responding with the default greeting. (`1f9e035`)

### v0.2.0 — Cross-project routing & sessionBusy stall fix

- **Fix**: `discoverPort()` now validates candidate ports against `this.cwd` before selecting, preventing cross-project routing when multiple opencode instances are running. (`OpenCodeBridge.ts`)
- **Fix**: `discoverSession()` now filters sessions by project directory, preventing messages from routing to the wrong project's session. (`OpenCodeBridge.ts`)
- **Fix**: `scheduleSettleOnComplete()` now enforces `maxSettleDeferrals = 6`, preventing indefinite deferral when `sessionBusy` is true. After 6 deferrals, settlement proceeds regardless. (`OpenCodeBridge.ts`)

---

## V0.4 — Multi-Platform, Permissions, Plugin, Sub-Agents (2026-05-10 ~ 2026-05-12)

### P4k — Compaction Bug Mitigations

> Upstream opencode bug: `filterCompacted()` breaks `tool_use`/`tool_result` atomic pairs during context compaction.
> Incident report: `docs/incidents/2026-05-11-tool-use-compaction-bug.md`

- **P4k-a**: `/pf model` command — list connected models, set per-prompt model override (sticky via SDK), clear override; compaction error keyword detection suggests `/pf model` as recovery (`a7924e1`, `5b47bbe`, `c4e8e2b`)
- **P4k-b**: Session depth warning at ~250 assistant messages — one-time warning suggesting `/pf model` or `/pf new`, resets on session switch (`e197c79`)
- **P4k-c**: Track `session.compacted` SSE events — log compaction, warn active tasks (`e197c79`)
- **P4k-d**: ~~Auto-recovery on compaction failure~~ — cancelled; model switching is a better recovery than blind session creation

### P4j — Sub-Agent Attribution

- **Phase 1 MVP**: `SubAgentTracker` class, SSE `session.created` interception, child session idle/error routing, summary injection on parent completion, error forwarding, render policy extensions across all 5 adapters, 24 unit tests (`44bb66c`)
- **Phase 2**: `/pf agents` command with real-time WS round-trip to connector; `/pf subagents <silent|summary|verbose>` persistent per-session verbosity threaded through full dispatch chain (TaskManager → OpenCodeCliRunner → RuntimeCommand → RemoteRuntime → ConnectorClient → OpenCodeBridge); CodexBridge and GeminiBridge updated with `PromptOptions` compatibility (`9a32a61` ~ `a490db3`)

### P4i — Menu Redesign

- Grouped layout: Project & Session / Task Control / Development / Admin sections
- Role-based admin row visibility via `getUserRole` in AdapterDeps
- All 5 adapters + MessageRenderer updated (`c653a34`)

### P4h — opencode Plugin

- Self-contained Bun plugin (`src/plugin/petfish-plugin.ts`) excluded from tsconfig
- `tool.execute.before` — block/warn risky tools based on mode and policy
- `tool.execute.after` — log tool completions
- `permission.ask` — auto-allow/deny based on mode and policy
- `experimental.chat.system.transform` — injects PetFish context into system prompts
- `petfish_status` custom tool: reports execution mode, policy summary, project info
- Connector-side installer: copies plugin to project `plugins/`, writes `.petfish/policy.json` (`7c2b6f7`, `ca2dbba`)

### P4g — Multi-User Permissions & Audit Trail

- `UserRole` type (`admin | operator | viewer`) with `DEFAULT_MODES_BY_ROLE`
- Auto-register users on first interaction (first user = admin, subsequent = viewer)
- `COMMAND_MIN_ROLE` map: viewer (help, list, where, status, sessions, log, diff), operator (ask, edit, test, use, new, switch, pr, commit, approve, deny, stop, doctor), admin (audit, users, role)
- Mode restriction in `dispatchAgentTask()` — validates `user.allowed_modes`
- 9 audit event types: `message_received`, `user_registered`, `command_executed`, `task_dispatched`, `task_completed`, `task_failed`, `permission_denied`, `project_bound`, `session_switched`
- Admin commands: `/pf audit [userId]`, `/pf users`, `/pf role <userId> <role>`
- Legacy `'owner'` role in config accepted, mapped to `'admin'` (`da9d7c5` ~ `ba3bbd2`)

### P4f — Web Console

- `WebAdapter` (~350 lines) on `/ws/web` with API key auth (`?key=`)
- Single-page dark-themed chat UI (`static/index.html`): auth overlay, auto-reconnect, markdown rendering, interactive cards, command bar, typing indicator, mobile-friendly
- `ConnectorGateway` refactored to `noServer: true` with unified `wsRoutes` Map — fixes dual-WSS 400 conflict
- Web users (`web:` prefix) bypass connector-level allowlist checks
- Nginx configured: `/web/` static proxy + `/ws/web` WebSocket proxy (`afde7f2`, `7187faf`, `b1fe322`)

### P4e — Slack & WeCom Adapters

- **Slack**: `@slack/bolt` Socket Mode, Block Kit cards, interactive buttons, project/session selection, `slackRenderPolicy` (4000 char limit), three-token auth (`3339538`)
- **WeCom**: `@wecom/aibot-node-sdk` WebSocket, template cards, interactive buttons, dedup, `wecomRenderPolicy` (4000 char limit), two-token auth (`3b5fc19`)

### P4d — Self-Daemonizing Connector

- Supervisor/watchdog via `child_process.fork()` in `src/connector/daemon.ts`
- CLI: `node main.js start <config>` / `stop` / `status`
- PID file at `~/.petfish/connector.pid`, logs at `~/.petfish/connector.log`
- Auto-respawn with exponential backoff (1s → 2s → 4s → max 60s), resets after 5min stable
- Cross-platform: Windows/macOS/Linux/WSL via `detached: true` + `unref()` (`8aecca2`)

### P4c — SSH Runtime Connector

- `SshRuntime`: `healthCheck()`, `run()`, `stop()`, `buildSshArgs()`, `execSsh()`, `shellEscape()`
- `StrictHostKeyChecking=no`, `BatchMode=yes`, `ConnectTimeout=10`, optional identity file/port
- Streaming stdout/stderr with `onOutput`, timeout handling, process tracking
- Config: `runtimes.yaml` SSH example with all fields (`bf4f657`)

### P4b — IM Session Cards & Switching

- Protocol: `MSG.SESSION_LIST`, `MSG.SESSION_LIST_RESPONSE`, `MSG.SESSION_SWITCH` + Zod schemas
- Bridge: `SessionInfo` type, `listSessions()` + `switchSession()` on `AgentBridge` interface
- Commands: `/pf sessions` + `/pf switch <n>` with NL pattern matching
- Async request/response with 10s timeout via `sessionListCallbacks` Map (`2c4f67b` ~ `1b489ac`)

### P4a — Changed Files Summary

- `FileChange[]` threaded through full pipeline: `AgentBridge` → `connectorProtocol` → `ConnectorClient` → `ConnectorGateway` → `RemoteRuntime` → `OpenCodeCliRunner` → `OpenCodeRunner` → `TaskManager` → `main.ts`
- `DiffRenderer` redesigned with per-file stats (additions/deletions/status)
- `OpenCodeBridge.fetchFileChanges()` using SDK `client.session.diff()` (`6fc523b`)

### Misc V0.4

- TUI question disclaimer in all 5 adapters' `sendQuestion()` (`ab18f75`)
- AI-agent-friendly install and upgrade guides (`989f6f0`)
- Improved `/start` welcome message with URL-based install/upgrade (`7705edd`)
- Fix: `projectToConnector` mapping for DB-restored projects on connector reconnect (`95de544`)

---

## V0.3 — Diagnostics & Command Expansion (2026-05-10)

- `/pf doctor` diagnostics command — gateway status, connector/session visibility (`8c1badc`)
- `/pf test`, `/pf commit`, `/pf pr` commands — routing and dispatch (`576823a`)

---

## V0.2 — Task Lifecycle, Policy, Approval, API Docs (2026-05-10)

- TaskManager approval flow: `/pf approve` and `/pf deny` commands
- `/pf diff` command — dispatches read-only agent task for git diff
- Command whitelist enforcement: `evaluateCommand()` with configurable `commandWhitelist` and `approvalRequiredCommands`
- `docs/api.md` — HTTP endpoints, WebSocket protocol, envelope format, all 19 MSG types
- `docs/development.md` — setup, scripts, project structure, architecture patterns, config reference (`300c8d0` ~ `1690450`)

---

## V0.2-rc — Stability Root-Cause Fixes (2026-05-10)

> Research report: `research/06_outputs/root-cause-and-redesign.md`
> Incident report: `docs/incidents/2026-05-10-stability-root-cause.md`

### STAB-0: Introduce `@opencode-ai/sdk`, eliminate `execSync(curl)`

- Created `src/connector/bridges/OpencodeClient.ts` wrapping `createOpencodeClient()`
- Replaced all 11 `execSync(curl ...)` calls with async SDK calls
- Removed `child_process.execSync` import (`a4d8430`)

### STAB-1: Replace `/tui/*` prompt injection with `/session/:id/message`

- `injectPrompt()` now uses `client.session.promptAsync()`
- Removed `doPost()` helper and all `/tui/clear-prompt`, `/tui/append-prompt`, `/tui/submit-prompt` calls
- `/tui/select-session` retained only for TUI control scenes (`a4d8430`)

### STAB-2: Explicit root-session binding, eliminate session drift

- `rediscover()` rewritten: calls `validateSessionExists()` first, preserves session if alive
- `requestNewSession()` rewritten: direct bind + reset, no longer calls `rediscover()`
- TUI reply leak fix: strengthened attribution checks in `handleMessageUpdated()` and `handlePartUpdated()` (`a4d8430`)

### STAB-3: SSE `session.idle` replaces global busy polling

- `sessionBusy` field driven by SSE events
- `confirmAndDrain()` changed from async to sync using `this.isSessionBusy()`
- `isSessionBusyByStatus()` HTTP polling method fully deleted (`a4d8430`)

### ROUTE-0: Cross-project routing isolation

- `ProjectRegistry` gained `removeProject()` and `removeProjectsByConnector()` with reverse mapping
- Connector disconnect triggers `removeProjectsByConnector()` cleanup
- `listProjects` cross-checks `gateway.registry.findByProject()` for active connectors
- `dispatchAgentTask` fails immediately if no active connector (no 30s retry) (`8ec104a`)

---

## V0.1 — Telegram Bot + Multi-Session + Installer (2026-05-09 ~ 2026-05-10)

### Core Bot (Phase 0)

- Telegram bot with grammY long polling
- `/pf help`, `list`, `use`, `ask`, `status`, `stop` commands
- Default ask mode — text messages go directly to opencode
- InlineKeyboard menu via `/pf`
- SQLite task recording and basic audit logging (`12aeba3` ~ `c18905c`)

### Connector + WebSocket Protocol (Phase 0)

- `ConnectorGateway`: HTTP + WebSocket server with connector registration
- `ConnectorClient`: WebSocket client with heartbeat, reconnection, message buffering
- `Envelope` protocol with Zod schema validation
- `RemoteRuntime`: per-project runtime dispatch over WebSocket
- `OutputBatcher`: streaming chunk collection with interval flush and per-platform char limits
- 60s reconnect grace window for connectors
- Task queue and re-dispatch during connector reconnection (`8fe5748` ~ `f1b6d6c`)

### Session Bridge (Phase 0)

- `OpenCodeBridge`: HTTP API + SSE for session injection (replaced earlier `opencode run -s` approach)
- `parentID` tracking for prompt injection
- Idle debounce to prevent orphan messages
- Session busy detection and queue (`68c1885` ~ `d301938`)

### Session Stability Band-Aids (Phase 0.1)

- `sentTextLength` per assistant message for multi-turn capture
- Task settlement on assistant completion with connector retry
- Dynamic connector routing for multi-session alpha
- Wildcard token auth for dynamic connector IDs
- Post-submit SSE verification with retry, daemon mode connector
- HTTP timeout, session rediscovery, diagnostic logging
- Settlement only on `session.idle`, continuation turn capture (`4050a33` ~ `70abd2a`)

### Self-Registration & Install (P1)

- Self-registration API — eliminates SSH config requirement (`fdcda4c`)
- Standardized install path + auto version check (`da8ab9a`)
- One-liner installer: `curl | bash` with dynamic server URL injection (`dd2b671`)
- `petfish-connect.ps1` for Windows-native connector daemon (`e05e234`)

### Conversation UX (P2)

- Conversation UX + session management + upgrade notification (`7b873fc`)
- Graceful SIGTERM shutdown + wildcard auth token config (`cc41c57`)
- Auto-register projects from connector on reconnect (`af88aed`)

### Question & Permission Relay

- Relay opencode questions/permissions to Telegram with interactive buttons
- Multi-question accumulation before submitting
- `connectorIdToChatId` fallback + `lastActiveTaskId` routing (`ed3fa26` ~ `8f69595`)

### Multi-Agent Support

- `AgentBridge` interface extracted, `SessionBridge` renamed to `OpenCodeBridge`
- `GeminiBridge` + `CodexBridge` (Tier 1 + Tier 2) with per-project agent routing
- Persistent sessions with permission relay (`d3ff65c` ~ `c35efe2`)

### Feishu Adapter

- `FeishuAdapter` with WebSocket transport and interactive cards
- Platform-aware sessions and multi-adapter routing
- `pf_start` handler, `bot_menu` support via `open_id` fallback
- Unwrap Feishu v2.0 card action envelope
- Multi-platform binding support
- 13 unit tests (`83deaa9` ~ `0e8f26b`)

### Security & Reliability

- User isolation on auto-registered projects (`e62f817`)
- Removed wildcard token — require user-bound auth for all connectors (`fab2584`)
- Question/permission relay survives bot restarts via session DB fallback (`737138e`)
- Connector reconnect death loop prevention on duplicate `connectorId` (`aed37db`)
- Markdown escape in Telegram messages with plain text fallback (`c806ae1` ~ `7fcb83d`)
- Propagate opencode errors to IM, fail pending tasks on connector disconnect (`d2e7384`)

### Infrastructure

- Split licensing: Apache-2.0 for connector/protocol, proprietary for server (`f27e566`)
- `IMAdapter` interface + `BaseIMAdapter` extracted from `TelegramAdapter` (`83deaa9`)
- `OutputBatcher` decoupled from Telegram via `MessageRenderPolicy` (`923f522`)
- Task state transition guards with `VALID_TRANSITIONS` table (`9092dfb`)
- `PolicyEngine` connected to task dispatch lifecycle (`4ea6c6e`)
- Platform-appropriate render policy for `OutputBatcher` (`128b5a0`)
- `GET /api/status` diagnostic endpoint with `X-Admin-Key` auth (`541c2e8`)
- Bilingual documentation, web landing page, unified branding (`9b2f767`, `e314b98`)
- Persistent dynamic connector tokens to SQLite across restarts (`7a7e9de`)
- Task-accepted notification with project label and task ID (`a743fed`)

### Bug Fixes (Phase 0~0.1)

- Thread `projectId` through `RuntimeCommand` to connector (`dc7b9b1`)
- Handle `task.accepted` and other connector messages in gateway (`10e7508`)
- Pass raw instruction/mode through `RuntimeCommand` to prevent double-wrapping (`52247c2`)
- Connector heartbeat detection and bypass fake-ip DNS (`92fc570`)
- Registry race condition unregistering reconnected connector (`cc3173f`)
- Server-side stale socket detection with `terminate()` (`3733048`)
- Client heartbeat reduced to 30s with active 15s ping (`ee5e7b5`)
- `getUpdates` 409 conflict with retry backoff (`f992bdd`)
- Flush stale long-poll before start, non-fatal adapter failures (`9f94fae`)
- `bot.start()` run in background so adapter `start()` resolves (`7ce48db`)
- Parse `-n` flag in `petfish-connect.sh logs` subcommand (`ec7d156`)
- Prevent TUI-originated questions from leaking to IM (`9d9fafc`)
- Prevent `pendingInteractions` from permanently blocking chat (`e912008`)
- Reduce WebSocket churn and prevent message replay duplicates (`117f231`)
- Multi-instance discovery: filter opencode by project CWD (`053d9f3`)
- Hybrid port discovery: verify candidates via `/session` API (`053d9f3`)
- PS1 `$PID` conflict + OpenCodeBridge auto-discovers opencode without `OPENCODE_PID` (`0808358`)
- Fully detach connector process from parent via `ShellExecute` on Windows (`25bfff2`)
