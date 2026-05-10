# Backlog

> Updated: 2026-05-11
> Reprioritized based on: `research/06_outputs/root-cause-and-redesign.md`
> Current stage: P4f Web console complete. Next: P4g Multi-user permissions.

---

## 🔴 P0 — Stability Root-Cause Fixes (v0.2-rc)

> 研究结论：当前不稳定的根因是三个错误的 API 使用模式，不是功能缺失。
> 以下四项按依赖顺序排列，必须串行完成。
> 设计文档参考：`docs/design/shared-session-architecture.md`
> 研究报告：`research/06_outputs/root-cause-and-redesign.md`

### STAB-0: 引入 `@opencode-ai/sdk`，消除 `execSync(curl)` ✅ DONE

**完成日期**: 2026-05-10

- [x] `npm install @opencode-ai/sdk`
- [x] 创建 `src/connector/bridges/OpencodeClient.ts`，封装 `createOpencodeClient({ baseUrl })`
- [x] 逐个替换 `OpenCodeBridge.ts` 中所有 `execSync(curl ...)` 为 SDK 异步调用（11 处）
- [x] 移除 `child_process.execSync` import，改为 `exec` + `promisify`

**验收结果**:
- ✅ `grep -r "execSync" src/connector/bridges/` — 零结果
- ✅ `tsc --noEmit` — 零错误
- ✅ `npm run build` — 编译成功
- ✅ `npm test` — 7 files, 71 tests, all passed

---

### STAB-1: 替换 `/tui/*` prompt 注入为 `/session/:id/message` ✅ DONE

**完成日期**: 2026-05-10

- [x] 将 `injectPrompt()` 中的 TUI 三步注入替换为 `client.session.promptAsync()`
- [x] 移除 `doPost()` helper 和所有 `/tui/clear-prompt`, `/tui/append-prompt`, `/tui/submit-prompt` 调用
- [x] 保留 `/tui/select-session` 仅用于 TUI 控制场景，不用于消息发送

**验收结果**:
- ✅ `grep -rE "tui/(clear|append|submit)-prompt" src/` — 零结果
- ✅ `tsc --noEmit` — 零错误
- ✅ `npm run build` — 编译成功
- ✅ `npm test` — 7 files, 71 tests, all passed
- ✅ 端到端测试 — Telegram 发消息，opencode 正确收到并响应

**依赖**: STAB-0 ✅  
**设计文档**: `docs/design/shared-session-architecture.md` §Surface confusion

---

### STAB-2: 实现显式 root-session 绑定，消除 session 漂移 ✅ DONE

**完成日期**: 2026-05-10

**实际实现**（简化方案，因 opencode SDK 无 parentID 字段无法区分 root/child）:
- [x] `rediscover()` 重写：先调用 `validateSessionExists()` 验证当前 session 存在性，存在则保留不漂移
- [x] 新增 `validateSessionExists()` 方法：调用 `client.session.list()` 检查 session 是否仍存在
- [x] `requestNewSession()` 重写：直接绑定新 session + 重置 `lastCompletedAssistantId` 和 `sessionBusy`，不再调用 `rediscover()`
- [x] 修复 TUI 回复泄漏：加强 `handleMessageUpdated()` 和 `handlePartUpdated()` 的归属检查，防止 TUI 消息错误归属给 IM 任务

**验收结果**:
- ✅ `tsc --noEmit` — 零错误
- ✅ `npm run build` — 编译成功
- ✅ `npm test` — 7 files, 71 tests, all passed
- ✅ 端到端测试 — 用户确认通过

**依赖**: STAB-0 ✅  
**设计文档**: `docs/design/phase-1-root-session-binding.md`

---

### STAB-3: 使用 SSE `session.idle` 替换全局 busy 轮询 ✅ DONE

**完成日期**: 2026-05-10

- [x] 新增 `sessionBusy` 字段，由 SSE 事件驱动
- [x] `handleSessionStatus()` 通过 SSE 设置 `this.sessionBusy = status?.type === 'busy'`
- [x] `handleSessionIdle()` 添加 `this.sessionBusy = false`
- [x] `confirmAndDrain()` 从 async 改为同步，使用 `this.isSessionBusy()` 同步检查
- [x] `isSessionBusy()` 从 async 改为同步 `boolean`，返回 `pending.size > 0 || this.sessionBusy`
- [x] 完全删除 `isSessionBusyByStatus()` HTTP 轮询方法
- [x] `stop()` 添加 `this.sessionBusy = false` 清理

**验收结果**:
- ✅ `grep -rn "isSessionBusyByStatus" src/` — 零结果
- ✅ `tsc --noEmit` — 零错误
- ✅ `npm run build` — 编译成功
- ✅ `npm test` — 7 files, 71 tests, all passed
- ✅ 端到端测试 — 用户确认通过

**依赖**: STAB-0 ✅, STAB-1 ✅  
**设计文档**: `docs/design/phase-2-request-lifecycle.md`

---

### ROUTE-0: 跨项目路由隔离 — 只展示在线项目，拒绝发往离线项目的消息 ✅ CODE COMPLETE

**完成日期**: 2026-05-10

**根因**: `RegistrationService.restoreFromStorage()` 启动时从 SQLite 恢复所有曾注册项目到 `ProjectRegistry`，不检查 connector 是否在线。`ProjectRegistry` 没有在线/离线概念。飞书 `/pf list` 返回所有项目（含过期的）。用户选择过期项目后发消息，`RemoteRuntime.resolveConnector()` 找不到 connector，重试 3 次（耗时 30 秒），最终报错或路由到错误 connector。

**修复方案（4 项子任务）**:
- [x] **ROUTE-0a**: `ProjectRegistry` 添加 `removeProject(id)` 和 `removeProjectsByConnector(connectorId)` 方法，维护 project→connector 反向映射
- [x] **ROUTE-0b**: `main.ts` `connector:change` handler — connector 断开时（`info` 为 falsy），调用 `removeProjectsByConnector()` 清理内存
- [x] **ROUTE-0c**: `main.ts` `adapterDeps.listProjects` — 对 `runtime === 'connector'` 的项目交叉检查 `gateway.registry.findByProject()`，只返回有活跃 connector 的项目
- [x] **ROUTE-0d**: `main.ts` `dispatchAgentTask` — 发送任务前检查 `gateway.registry.findByProject(projectId)`，无活跃 connector 时立即返回 ⚠️ 错误消息，不进入 30 秒重试

**验收结果**:
- ✅ `tsc --noEmit` — 零错误（仅 pre-existing hints）
- ✅ `npm run build` — 编译成功
- ✅ `npm test` — 7 files, 71 tests, all passed
- ✅ petfish_remote 侧代码完成，已 committed（`8ec104a`）
- ⏳ 端到端测试 — 需 petfish-bot 同步部署 server-side 变更（已开 issue）

**依赖**: STAB-0 ✅ ~ STAB-3 ✅

---

## ✅ P1 — Done (v0.2)

- [x] WebSocket reliability hardening (message replay, reconnection, churn reduction — #15, #16) — already addressed in commit `117f231`
- [x] Feishu adapter parity with Telegram (card actions, bot_menu, /start alignment) — platform limitations only (no typing API), not implementation gaps

---

## ✅ P2 — Done (v0.2)

- [x] TaskManager approval flow: `/pf approve` and `/pf deny` commands — already implemented in main.ts + TaskManager.ts
- [x] `/pf diff` command — show pending changes before approval — already implemented in main.ts
- [x] Command whitelist enforcement in PolicyEngine — `evaluateCommand()` added with configurable `commandWhitelist` and `approvalRequiredCommands`
- [x] Populate `docs/api.md` — HTTP endpoints, WebSocket protocol, envelope format, all 19 MSG types documented
- [x] Populate `docs/development.md` — setup, scripts, project structure, architecture patterns, config reference

---

## ✅ P3 — Done (v0.3)

- [x] Runtime health check (`/pf doctor`) — implemented in `CommandRouter`, `main.ts`, `MessageRenderer`, `ConnectorGateway`
- [x] `/pf test`, `/pf commit`, `/pf pr` commands — implemented in `main.ts` and exposed via `/pf` help

---

## ✅ P4a — Changed Files Summary (v0.4)

**完成日期**: 2026-05-10

- [x] Thread `FileChange[]` through full data flow: `AgentBridge` → `connectorProtocol` → `ConnectorClient` → `ConnectorGateway` → `RemoteRuntime` → `OpenCodeCliRunner` → `OpenCodeRunner` → `TaskManager` → `main.ts`
- [x] Redesign `DiffRenderer` with per-file stats rendering (additions/deletions/status)
- [x] `OpenCodeBridge.fetchFileChanges()` using SDK `client.session.diff()`
- [x] Structured `FileChange` type in protocol with Zod validation

**验收结果**:
- ✅ `tsc --noEmit` — 零错误
- ✅ `npm run build` — 编译成功
- ✅ `npm test` — 7 files, 71 tests, all passed
- ⏳ E2E — pending deployment

---

## ✅ P4b — IM Session Cards & Switching (v0.4)

**完成日期**: 2026-05-10

- [x] Protocol: `MSG.SESSION_LIST`, `MSG.SESSION_LIST_RESPONSE`, `MSG.SESSION_SWITCH` + Zod payload schemas
- [x] Bridge: `SessionInfo` type, `listSessions()` + `switchSession()` on `AgentBridge` interface + `OpenCodeBridge` implementation + `GeminiBridge`/`CodexBridge` stubs
- [x] Connector: `handleSessionList()` and `handleSessionSwitch()` in `ConnectorClient`
- [x] Gateway: `sendSessionListRequest()` / `sendSessionSwitch()` helpers + `session:list` event
- [x] Commands: `sessions` / `switch` commands with NL pattern matching in `CommandRouter`
- [x] Rendering: `renderSessionList()` with numbered entries + active indicator in `MessageRenderer`
- [x] Wiring: Async request/response with 10s timeout via `sessionListCallbacks` Map in `main.ts`

**验收结果**:
- ✅ `tsc --noEmit` — 零错误
- ✅ `npm run build` — 编译成功
- ✅ `npm test` — 7 files, 71 tests, all passed
- ⏳ E2E — pending deployment

---

## ✅ P4c — SSH Runtime Connector (v0.4)

**完成日期**: 2026-05-10

- [x] `SshRuntime` fully implemented: `healthCheck()`, `run()`, `stop()`, `buildSshArgs()`, `execSsh()`, `shellEscape()`
- [x] SSH connection: `StrictHostKeyChecking=no`, `BatchMode=yes`, `ConnectTimeout=10`, optional identity file and port
- [x] Streaming stdout/stderr with `onOutput` callback, timeout handling, process tracking
- [x] Wired in `main.ts`: SSH runtimes from config registered alongside local runtimes
- [x] Config: `runtimes.yaml` has commented SSH example with all fields (host, port, user, identity_file, opencode_bin)

**验收结果**:
- ✅ `tsc --noEmit` — 零错误
- ✅ `npm run build` — 编译成功
- ✅ SSH connectivity verified against remote host
- ✅ Deployed to production

---

## ✅ P4d — Self-Daemonizing Connector (v0.4)

**完成日期**: 2026-05-10

- [x] `src/connector/daemon.ts`: Supervisor/watchdog using `child_process.fork()`
- [x] `node main.js start <config>`: Fork detached supervisor, write PID file (`~/.petfish/connector.pid`), exit
- [x] `node main.js stop`: Read PID, send SIGTERM, clean up PID file
- [x] `node main.js status`: Check PID liveness
- [x] Auto-respawn on crash with exponential backoff (1s → 2s → 4s → max 60s)
- [x] Backoff resets after 5min stable runtime
- [x] Worker logs redirected to `~/.petfish/connector.log`
- [x] Backward-compatible direct mode preserved (`node main.js <config>`)
- [x] Cross-platform: Windows/macOS/Linux/WSL via `detached: true` + `unref()`

**验收结果**:
- ✅ `tsc --noEmit` — 零错误
- ✅ `npm run build` — 编译成功
- ✅ Daemon start / status / double-start guard / crash recovery / clean stop — all passed
- ✅ Worker logs appear in `~/.petfish/connector.log`
- ✅ Auto-respawn after SIGKILL: detected crash, respawned in 1s, re-registered with bot server

---

## ✅ P4e — Slack Adapter (v0.4)

**完成日期**: 2026-05-10

- [x] `@slack/bolt` dependency with Socket Mode support
- [x] `SlackAdapter` (469 lines): message handling, Block Kit cards, interactive buttons, project selection, session switching
- [x] `slackRenderPolicy` (27 lines): 4000 char limit, Slack-formatted headers/errors
- [x] Wired in `main.ts`: imports, render policy selection (2 locations), adapter instantiation from env vars
- [x] Three-token auth: `SLACK_BOT_TOKEN` (xoxb-), `SLACK_APP_TOKEN` (xapp-), `SLACK_SIGNING_SECRET` (optional HTTP mode)
- [x] Full `/pf` command routing: list, use, new, sessions, switch, approve, deny, doctor, test, commit, pr, diff, help

**验收结果**:
- ✅ `tsc --noEmit` — 零错误
- ✅ `npm run build` — 编译成功
- ✅ `npm test` — 7 files, 71 tests, all passed
- ⏳ E2E — pending Slack workspace setup

---

## ✅ P4e — WeCom Adapter (v0.4)

**完成日期**: 2026-05-10

- [x] `@wecom/aibot-node-sdk` dependency with WebSocket transport
- [x] `WeComAdapter` (~390 lines): WSClient message handling, template cards, interactive buttons, project selection, session switching, dedup
- [x] `wecomRenderPolicy` (27 lines): 4000 char limit, WeCom markdown format
- [x] Wired in `main.ts`: imports, render policy selection (2 locations), adapter instantiation from env vars
- [x] Two-token auth: `WECOM_BOT_ID` + `WECOM_SECRET`
- [x] Full `/pf` command routing: list, use, new, sessions, switch, approve, deny, doctor, test, commit, pr, diff, help

**验收结果**:
- ✅ `tsc --noEmit` — 零错误
- ✅ `npm run build` — 编译成功
- ✅ `npm test` — 7 files, 71 tests, all passed
- ⏳ E2E — pending WeCom bot credentials setup on server

---

## ✅ P4f — Web Console (v0.4)

**完成日期**: 2026-05-11

- [x] `WebAdapter` (~350 lines): WebSocket server on `/ws/web` with API key auth (`?key=`), noServer routing via `registerWsRoute`
- [x] WebSocket protocol: message/command/questionReply/permissionReply inbound; connected/message/typing/question/permission/menu/projectList/sessionList/welcome outbound
- [x] Single-page dark-themed chat UI (`static/index.html`): auth overlay, auto-reconnect, markdown rendering, interactive cards, command bar, typing indicator, mobile-friendly
- [x] `webRenderPolicy` (27 lines): 65536 char limit, standard markdown formatting
- [x] `ConnectorGateway` refactored to `noServer: true` with unified upgrade routing via `wsRoutes` Map — fixes dual-WSS 400 conflict
- [x] Web users (`web:` prefix) bypass connector-level allowlist checks in `listProjects`, `/pf use`, `isUserAllowed`
- [x] Build script copies static assets: `tsc && cp -r src/adapters/web/static dist/adapters/web/static`
- [x] Platform type updated with `'web'` variant
- [x] Nginx configured: `/web/` static proxy + `/ws/web` WebSocket proxy to port 9100

**验收结果**:
- ✅ `tsc --noEmit` — 零错误
- ✅ `npm run build` — 编译成功
- ✅ Static page: `curl https://remote.petfish.ai/web/` → HTTP 200
- ✅ WebSocket connect: `wss://remote.petfish.ai/ws/web?key=...` → `{"type":"connected","chatId":"web:...","projects":[6 projects]}`
- ✅ Project binding: `/pf use petfish_tester` → `"Bound to project petfish_tester"`
- ✅ Full message round-trip: `"say hello world"` → typing → task accepted → AI response → task completed

---

## P4g+ — Future (v0.5+)

- [ ] Multi-user permissions and full audit trail UI
- [ ] opencode plugin with real-time event hooks
- [ ] Child/subagent session attribution under root session — no server/IM attribution path surfaced today
- [ ] WSL runtime connector — `WslRuntime` stubbed, similar pattern to SSH

---

## Done (Recent)

- [x] P1: WebSocket reliability hardening (#15, #16) — commit `117f231`
- [x] P1: Feishu adapter parity — platform limitations only, no code gaps
- [x] P2: `/pf approve` and `/pf deny` — TaskManager approval flow already implemented
- [x] P2: `/pf diff` — dispatches read_only agent task for git diff
- [x] Task state transition guards with valid transition map
- [x] PolicyEngine connected to task dispatch lifecycle
- [x] Platform-appropriate render policy for OutputBatcher
- [x] WebSocket churn reduction and replay duplicate prevention
- [x] TUI-originated question leak prevention
- [x] Cross-repo boundary rule documented in AGENTS.md
- [x] Root-cause research: opencode integration stability diagnosis (`research/06_outputs/root-cause-and-redesign.md`)
- [x] STAB-0: 引入 `@opencode-ai/sdk`，消除全部 `execSync(curl)`（11 处 → 0）
- [x] STAB-1: 替换 `/tui/*` prompt 注入为 SDK `session.promptAsync()`
- [x] STAB-2: 显式 root-session 绑定 + TUI 回复泄漏修复
- [x] STAB-3: SSE 驱动 busy 状态替换 HTTP 轮询
- [x] ROUTE-0: 跨项目路由隔离 — disconnect cleanup + list filter + dispatch guard（petfish_remote 侧完成，petfish-bot 待同步部署）
- [x] P3: `/pf doctor` — gateway diagnostics + connector/session visibility
- [x] P3: `/pf test`, `/pf commit`, `/pf pr` — command routing and dispatch implemented
- [x] P4a: Changed files summary — `FileChange[]` threaded through full pipeline, `DiffRenderer` redesigned, `fetchFileChanges()` via SDK
- [x] P4b: IM session cards & switching — `/pf sessions` + `/pf switch <n>`, protocol + bridge + gateway + renderer
- [x] P4c: SSH runtime connector — `SshRuntime` with health check, streaming exec, timeout, process management
- [x] P4d: Self-daemonizing connector — supervisor/watchdog, start/stop/status CLI, auto-respawn with backoff, log redirect
- [x] P4e: Slack adapter — `@slack/bolt` Socket Mode, Block Kit cards, `/pf` command routing, `slackRenderPolicy`
- [x] P4e: WeCom adapter — `@wecom/aibot-node-sdk` WebSocket, template cards, `/pf` command routing, `wecomRenderPolicy`
- [x] P4f: Web console — `WebAdapter` on `/ws/web`, dark-themed browser UI, API key auth, noServer WSS routing, nginx proxy, full E2E verified
