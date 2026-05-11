# Design Synthesis: Sub-Agent Session Attribution

| Field | Value |
|-------|-------|
| Research Brief | `rb-sub-agent-attribution-2026-05` |
| Status | Complete |
| Date | 2026-05-11 |
| Output Type | Design specification + implementation backlog |

---

## Executive Summary

Sub-agent activity is currently invisible to IM users — a black box during complex tasks. This synthesis defines a **summary-first, errors-immediate** display strategy that works within every platform's constraints. The default experience is a single aggregated status line appended to the parent session's completion message, with errors surfaced immediately. Power users can opt into verbose mode for real-time lifecycle events.

Key design decisions:
1. **Default = summary-on-completion** — no real-time chatter for sub-agents
2. **Errors bypass batching** — shown immediately as they are actionable
3. **Aggregation by parent task** — sub-agents grouped by the parent message that spawned them
4. **Three verbosity levels** — `silent` / `summary` (default) / `verbose`
5. **No opencode core changes required** — all data available via existing SSE events

---

## SQ1: Display Granularity

### SQ1.1: Which lifecycle events warrant display?

**Recommendation: Show `completed`, `failed`, and `cancelled`. Do NOT show `created` or `progress` by default.**

| Event | Default (summary) | Verbose mode | Rationale |
|-------|-------------------|--------------|-----------|
| `created` | Hidden | Show | Sub-agent creation is noise for most users; they don't need to know a librarian was spawned, only that it finished |
| `started` | Hidden | Hidden | No distinct signal from `created` in practice |
| `progress` | Hidden | Hidden | Sub-agents are typically short-lived (seconds); progress adds no value |
| `completed` | Aggregated in summary line | Show individually | The useful signal — work was done |
| `failed` | **Show immediately** | Show immediately | Errors are actionable and may explain missing results |
| `cancelled` | Aggregated in summary line | Show individually | Informs user of incomplete work |

**Evidence basis**: SSE `session.created` events carry `parentID` and `info.agent`, confirmed in `OpenCodeBridge.ts:476`. The bridge already filters by `parentID` for message routing. Completion is detectable via `info.time.completed`. Errors are detectable via `info.error`.

### SQ1.2: Should sub-agent output be shown inline, summarized, or hidden?

**Recommendation: Hidden by default. Sub-agent output already flows into the parent agent's response — the parent synthesizes and presents sub-agent findings. Showing raw sub-agent output would duplicate content.**

The parent agent receives sub-agent results and incorporates them into its response. Displaying sub-agent output separately creates redundancy without adding value. The summary line tells the user *that* sub-agents ran; the parent's response tells them *what* was found.

Exception: In verbose mode, failed sub-agent error messages are shown in full because they may not be reflected in the parent's response.

### SQ1.3: How should concurrent sub-agents be represented?

**Recommendation: As a group. Individual display only in verbose mode.**

Default summary line format:
```
🔧 3 sub-agents completed: explore(2), oracle(1) · 12s
```

When failures exist:
```
🔧 3 sub-agents: ✅ explore(2), ❌ librarian(1 failed) · 15s
```

This collapses N events into 1 line. At the platform level, this is 60-120 characters — negligible against any platform's message limit.

### SQ1.4: Minimum useful information per sub-agent event

| Field | Include | Source |
|-------|---------|--------|
| Agent type | Yes | `info.agent` from `session.created` SSE |
| Status (completed/failed/cancelled) | Yes | Derived from `session.completed` / `info.error` events |
| Duration | Yes (aggregated) | `session.created` timestamp → completion timestamp |
| Count per type | Yes | Accumulated locally |
| Error message | Yes (for failures only) | `info.error` field |
| Result summary | No | Already in parent response |

---

## SQ2: Timing and Delivery Mode

### SQ2.1: Real-time vs batched vs on-demand?

**Recommendation: Batched at parent completion (default), with immediate error bypass.**

| Mode | Trigger | What's shown |
|------|---------|-------------|
| Default (summary) | Parent task completes | Single summary line appended after parent completion message |
| Error bypass | Sub-agent fails | Immediate error notification, does not wait for parent completion |
| Verbose | Each sub-agent lifecycle event | Individual start/complete/fail notifications in real-time |

**Rationale**: Parent tasks already produce a completion message via `OutputBatcher.complete()` (see `OutputBatcher.ts:40-55`). The sub-agent summary line piggybacks on this existing message — zero additional messages in the default case. This respects all platform rate limits by design.

### SQ2.2: Batch window

**Recommendation: Batch per parent task, not by time window.**

Sub-agent events are accumulated in a `SubAgentTracker` keyed by parent session ID. When `OutputBatcher.complete()` fires for the parent task, the tracker's summary is appended. No time-based windowing is needed because the parent completion is the natural aggregation point.

If the parent task runs >60 seconds and has spawned sub-agents, emit a single interim status line:
```
🔧 Working: explore(2 running), oracle(1 done)...
```
This uses `editMessage` on Telegram / message update on Slack to avoid additional messages.

### SQ2.3: Should errors bypass batching?

**Yes. Errors are shown immediately.** A failed sub-agent may explain why the parent's response is incomplete or wrong. Waiting until parent completion to show errors delays actionable information.

Error display format (all platforms):
```
⚠️ Sub-agent failed: librarian — Could not read file /path/to/file
```

This is a single message (≤200 chars), well within rate limits.

### SQ2.4: Long-running sub-agents (>30s)?

**Recommendation: Emit a progress indicator at 30s, then every 60s, using message edit (not new message).**

For the `summary` verbosity level:
- At 30s: Edit the parent's last message to append `🔧 Sub-agent running: oracle...`
- At 60s intervals thereafter: Update the same line with elapsed time
- On completion: Replace with final summary line

For `verbose` level: Show creation immediately, then completion/failure.

This avoids new messages entirely — it uses the existing `editMessage` pattern that OutputBatcher already employs for streamed output.

---

## SQ3: Platform-Specific Adaptation

### SQ3.1: Telegram

**Constraints**: 4096 chars per message, ~30 msg/min, InlineKeyboard, `editMessageText`.

**Summary line** (appended to parent completion message):
```
📂 my-project
Task `abc123` ✅ completed (2450 chars, 5 messages)
🔧 4 sub-agents: explore(2), oracle(1), librarian(1) · 8s
```

**Error** (separate message, immediate):
```
⚠️ Sub-agent failed: librarian
Error: ENOENT — /src/missing.ts not found
```

**Verbose mode** (individual messages):
```
🔧 ▶ oracle started
🔧 ✅ oracle completed (3s)
🔧 ▶ explore started
🔧 ❌ explore failed: timeout after 30s
```

**Implementation**: Append summary line to `formatCompletion()` output in `telegramRenderPolicy`. Summary adds ~80 chars — well within the 4096 limit since completion messages are typically <200 chars. Error messages are sent via a new `formatSubAgentError()` method on `MessageRenderPolicy`.

### SQ3.2: Slack

**Constraints**: 40000 chars (Block Kit), 1 msg/sec per channel, native threading.

**Recommendation: Use threaded replies for verbose mode. Summary in main channel message.**

**Summary** (appended to parent completion in main channel):
```
📂 my-project · Task abc123 ✅ completed
🔧 4 sub-agents: explore(2), oracle(1), librarian(1) · 8s
```

**Verbose mode** — sub-agent events posted as threaded replies under the parent message:
```
Thread: 🔧 oracle ▶ started → ✅ completed (3s)
Thread: 🔧 explore ▶ started → ❌ failed: timeout
```

**Error** — posted both in thread AND main channel (Slack `reply_broadcast`):
```
⚠️ Sub-agent failed: librarian — ENOENT /src/missing.ts
```

Slack threading is the natural fit for nested activity — it keeps the main channel clean while providing drill-down capability.

### SQ3.3: Feishu (Lark)

**Constraints**: 30000 chars, card messages, interactive elements.

**Recommendation: Use Feishu card messages for the summary.**

**Summary card**:
```
┌─────────────────────────────────────┐
│ 📂 my-project                       │
│ Task abc123 ✅ completed             │
│                                     │
│ 🔧 Sub-agents (4)                   │
│ ├ explore × 2 ✅                    │
│ ├ oracle × 1 ✅                     │
│ └ librarian × 1 ✅                  │
│ Total: 8s                           │
└─────────────────────────────────────┘
```

Feishu's card messages allow structured layout and interactive elements. The 30000-char limit is generous; even verbose mode won't approach it.

**Error card** (immediate, with red header):
```
┌─────────────────────────────────────┐
│ ⚠️ Sub-agent Failed                 │
│ librarian — ENOENT /src/missing.ts  │
└─────────────────────────────────────┘
```

### SQ3.4: WeCom

**Constraints**: Template cards, 6 buttons max, moderate rate limits.

**Recommendation: Plain text summary appended to completion. No card-specific sub-agent rendering in Phase 1.**

WeCom's template card system is too rigid for dynamic sub-agent counts. Use plain text:
```
📂 my-project
Task abc123 ✅ completed
🔧 Sub-agents: explore(2) oracle(1) librarian(1) · 8s
```

**Error**: Plain text message, immediate:
```
⚠️ Sub-agent failed: librarian — ENOENT /src/missing.ts
```

WeCom gets the minimal viable experience. Richer rendering can be explored in Phase 2 if WeCom adds more flexible card templates.

### SQ3.5: Web

**Constraints**: Unlimited message size, full HTML/JS, WebSocket.

**Recommendation: Richest experience. Collapsible sub-agent panel with real-time updates.**

The web UI should show a collapsible `<details>` section below each parent response:

```html
▶ 🔧 4 sub-agents (click to expand)
  ┌──────────────────────────────────┐
  │ ✅ explore #1    2.3s  completed │
  │ ✅ explore #2    1.8s  completed │
  │ ✅ oracle        4.1s  completed │
  │ ❌ librarian     0.5s  ENOENT   │
  └──────────────────────────────────┘
```

Real-time: Sub-agent entries appear as they are created; status updates in-place via WebSocket. Failed entries are highlighted red. No message limits or rate limits apply.

---

## SQ4: Aggregation and Filtering

### SQ4.1: Aggregation strategy

**Recommendation: Aggregate by parent task.**

Each parent task accumulates sub-agent events in a `SubAgentTracker` instance. When the parent completes, the tracker produces the summary. This is natural because:
- Sub-agents belong to a parent session
- `parentID` on `session.created` provides the grouping key
- The existing `OutputBatcher` is already per-task

### SQ4.2: Summary line pattern

**Yes. The standard pattern is:**

```
🔧 {count} sub-agents: {type}({count})[, ...] · {total_duration}
```

With failures:
```
🔧 {count} sub-agents: ✅ {type}({n}), ❌ {type}({n} failed) · {total_duration}
```

Single sub-agent (no aggregation needed):
```
🔧 Sub-agent: oracle ✅ (3s)
```

### SQ4.3: Aggregation threshold

**Recommendation: Always aggregate. There is no threshold.**

Even a single sub-agent uses the summary format. Rationale: Consistency matters more than saving a few characters. "🔧 Sub-agent: oracle ✅ (3s)" is clear and compact. Switching formats based on count adds implementation complexity and confuses users who see different patterns.

### SQ4.4: Nested sub-agents

**Recommendation: Flatten. Show all sub-agents at one level, regardless of nesting depth.**

In practice, nested sub-agents (a sub-agent spawning its own sub-agent) are rare in opencode. When they occur, the inner sub-agent's `parentID` points to the outer sub-agent, not the root parent. The tracker should walk up the `parentID` chain to find the root parent session and attribute all descendants to it.

Display: No nesting indicators. `🔧 5 sub-agents: explore(3), oracle(2) · 12s` — the user doesn't need to know that one explore was spawned by an oracle.

---

## SQ5: User Preferences and Control

### SQ5.1: Verbosity settings

**Three levels:**

| Level | Behavior | Use case |
|-------|----------|----------|
| `silent` | No sub-agent info at all | Users who find it distracting |
| `summary` (default) | Summary line on parent completion + immediate errors | Most users |
| `verbose` | Real-time per-event notifications | Debugging, power users |

Command: `/pf subagents <silent|summary|verbose>`

### SQ5.2: Filter by agent type?

**No. Not in Phase 1 or Phase 2.**

Agent type filtering adds complexity with minimal value. Users don't have strong mental models of what "explore" vs "librarian" means. The summary line already collapses by type. If a user wants less noise, `silent` mode is sufficient.

### SQ5.3: Where to store preferences

**Per-user, persisted in the existing user settings store.**

Sub-agent verbosity is a user preference, not a per-session or per-chat setting. A user who wants verbose mode wants it everywhere. Storage location: the same mechanism used for other `/pf` settings (currently in-memory per connector session; roadmap: persist to `~/.petfish/config.yaml`).

### SQ5.4: On-demand query command

**Yes. `/pf agents` shows sub-agent status for the current session.**

Output:
```
🔧 Current session sub-agents:
  oracle ✅ completed (3s)
  explore ✅ completed (2s)  
  explore ✅ completed (4s)
  librarian ❌ failed: ENOENT
```

If no sub-agents have been spawned: `No sub-agents in current session.`

This is the escape hatch for `silent` mode users and for checking status mid-task.

---

## SQ6: Persistence and History

### SQ6.1: Session summaries/exports

**Yes. Include sub-agent summary in session completion data.**

When a session completes, the sub-agent summary (types, counts, durations, failures) is stored alongside the existing task completion data. This enriches session history without requiring schema changes — it's an additional field on the task record.

### SQ6.2: Task status view

**Yes. `/pf status` should include a sub-agent count if any exist.**

```
📂 my-project · Session active
⏳ Task abc123 running (45s)
🔧 2 sub-agents running: explore, oracle
```

### SQ6.3: TaskManager integration

**Minimal integration. The `SubAgentTracker` is a companion to `OutputBatcher`, not a TaskManager concern.**

Sub-agent tracking is a rendering/display concern, not a task state concern. The `SubAgentTracker` lives alongside `OutputBatcher` — created when a task starts, consulted when the task completes. It does NOT modify `TaskManager` state transitions (per the gotcha in AGENTS.md about `VALID_TRANSITIONS`).

The tracker stores:
```typescript
interface SubAgentRecord {
  sessionId: string;
  agentType: string;       // from info.agent
  parentSessionId: string; // from parentID
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  error?: string;
}
```

### SQ6.4: Queryable after session completion?

**Phase 2. Not in MVP.**

Post-session sub-agent history requires storage persistence. In Phase 1, sub-agent data is in-memory and discarded when the session ends. Phase 2 can persist to storage and expose via `/pf history <sessionId>`.

---

## Recommended Display Strategy (Default)

```
┌─────────────────────────────────────────────────────┐
│  User sends message                                 │
│  ↓                                                  │
│  Parent task starts                                 │
│  ↓                                                  │
│  Sub-agents spawn (silent — user sees nothing)      │
│  ↓                                                  │
│  Sub-agent FAILS? → Immediate error message         │
│  ↓                                                  │
│  Parent task >60s with running sub-agents?           │
│  → Edit last message to show interim status          │
│  ↓                                                  │
│  Parent task completes                              │
│  → Completion message + sub-agent summary line       │
└─────────────────────────────────────────────────────┘
```

The user sees at most:
- 0-1 error messages (only on sub-agent failure)
- 1 completion message (already exists, with summary line appended)
- 0-1 interim status edits (only for long tasks, via editMessage)

**Zero additional messages in the happy path.** The summary line rides on the existing completion message.

---

## Aggregation Rules (Concrete Thresholds)

| Rule | Threshold | Behavior |
|------|-----------|----------|
| Summary format | Always | All sub-agents summarized in one line |
| Error bypass | Immediately | Failed sub-agents shown within 1 flush cycle (~3s) |
| Interim status | Parent running >60s AND sub-agents active | Edit last message with running count |
| Interim update interval | 60s | Update interim status every 60s |
| Max summary line length | 200 chars | Truncate agent type list if >5 types |
| Nested sub-agent attribution | Walk parentID chain | Flatten to root parent |

---

## Trade-offs and Risks

### What we're choosing NOT to do

| Decision | Alternative rejected | Rationale |
|----------|---------------------|-----------|
| No real-time sub-agent streaming by default | Show every event live | Would multiply message count by 3-10x, hitting Telegram's 30 msg/min limit on complex tasks |
| No sub-agent output display | Show sub-agent results inline | Parent already synthesizes results; showing raw output creates noise and duplication |
| No per-type filtering | Allow users to show/hide specific agent types | Complexity without demonstrated user need; `silent`/`summary`/`verbose` covers the use cases |
| Flatten nested sub-agents | Show nesting hierarchy | Nesting is rare and the hierarchy doesn't help users make decisions |
| No interactive sub-agent control | Allow cancel/retry from IM | Out of scope per brief; would require opencode core changes |
| WeCom gets plain text only | Build custom card templates | WeCom card system too rigid for dynamic sub-agent counts |

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Sub-agent events arrive after parent completion | Medium | `SubAgentTracker` waits 2s after parent completion before finalizing summary; late arrivals within window are included |
| Error message rate spikes on catastrophic failures | Low | Cap at 3 error messages per parent task; aggregate remaining as "and N more failures" |
| Verbose mode hits Telegram rate limit | Low | Verbose mode uses `editMessage` for updates where possible; falls back to throttled sends |
| `parentID` chain walk for nested agents causes loops | Very low | Cap chain walk at depth 5; log warning if exceeded |

---

## Implementation Backlog

### Phase 1: MVP (Estimated effort: 3-4 days)

| # | Item | Description | Effort | Files affected |
|---|------|-------------|--------|----------------|
| 1.1 | `SubAgentTracker` class | Tracks sub-agent lifecycle per parent session. Accumulates records, produces summary line. | 4h | New: `src/render/SubAgentTracker.ts` |
| 1.2 | SSE event interception | In `OpenCodeBridge`, detect `session.created` with `parentID`, route to `SubAgentTracker`. Detect completion/error events for child sessions. | 4h | `src/connector/bridges/OpenCodeBridge.ts` |
| 1.3 | `MessageRenderPolicy` extension | Add `formatSubAgentSummary()` and `formatSubAgentError()` to the `MessageRenderPolicy` interface. Implement for `telegramRenderPolicy`. | 2h | `src/render/renderPolicy.ts` |
| 1.4 | `OutputBatcher` integration | On `complete()`, query `SubAgentTracker` for summary and append to completion message. | 2h | `src/render/OutputBatcher.ts` |
| 1.5 | Immediate error forwarding | When `SubAgentTracker` records a failure, send error message immediately via `sendFn`. | 2h | `src/render/SubAgentTracker.ts`, `src/render/OutputBatcher.ts` |
| 1.6 | `/pf agents` command | Query `SubAgentTracker` for current session and format response. | 2h | Command handler (adapter-specific) |
| 1.7 | `/pf subagents` setting | Store verbosity preference per user. Wire into `SubAgentTracker` behavior. | 2h | Command handler, user settings |
| 1.8 | Tests | Unit tests for `SubAgentTracker` (aggregation, summary formatting, error bypass, nested flattening). | 4h | New: test file |

**Phase 1 total: ~22h (3 days)**

### Phase 2: Platform-specific enhancements (Estimated effort: 3-4 days)

| # | Item | Description | Effort | Files affected |
|---|------|-------------|--------|----------------|
| 2.1 | Slack threaded verbose mode | Sub-agent events as threaded replies. Error broadcast to main channel. | 4h | Slack adapter, render policy |
| 2.2 | Feishu card rendering | Sub-agent summary as structured Feishu card message. | 4h | Feishu adapter, render policy |
| 2.3 | Web collapsible panel | Collapsible `<details>` section with real-time sub-agent status via WebSocket. | 6h | Web adapter, frontend |
| 2.4 | Interim status (long tasks) | Edit last message after 60s to show running sub-agent count. | 3h | `SubAgentTracker`, `OutputBatcher` |
| 2.5 | Verbose mode implementation | Real-time per-event notifications with rate limiting. | 4h | `SubAgentTracker`, render policies |
| 2.6 | Session summary persistence | Store sub-agent summary in task completion records. | 3h | Storage layer, task records |
| 2.7 | `/pf status` integration | Show sub-agent count in status command output. | 1h | Command handler |

**Phase 2 total: ~25h (3-4 days)**

### Phase 3: Polish (Estimated effort: 2 days, lower priority)

| # | Item | Description | Effort |
|---|------|-------------|--------|
| 3.1 | WeCom card exploration | If WeCom adds flexible cards, implement richer rendering | 4h |
| 3.2 | Post-session history query | `/pf history <id>` with sub-agent breakdown | 4h |
| 3.3 | Error message deduplication | Collapse repeated failures from same agent type | 2h |
| 3.4 | Metrics/observability | Log sub-agent counts per session for monitoring | 2h |

---

## Architecture Summary

```
SSE Events (opencode)
  │
  ├─ session.created (parentID set) ──→ SubAgentTracker.register()
  ├─ message.part / message.created ──→ existing OutputBatcher (unchanged)  
  ├─ session.completed (child) ──────→ SubAgentTracker.markCompleted()
  └─ session.error (child) ──────────→ SubAgentTracker.markFailed()
                                        └─→ immediate error via sendFn()
                                     
OutputBatcher.complete()
  │
  └─ SubAgentTracker.getSummary() ──→ append summary line to completion message


User commands:
  /pf agents     → SubAgentTracker.getStatus()
  /pf subagents  → set verbosity preference
```

The `SubAgentTracker` is the only new component. It is a pure data accumulator — no side effects except the immediate error send. It does not touch `TaskManager` state transitions.

---

## Appendix: Message Format Reference

### Summary line variants

```
# No sub-agents (nothing shown)

# Single sub-agent, success
🔧 Sub-agent: oracle ✅ (3s)

# Multiple sub-agents, all success
🔧 3 sub-agents: explore(2), oracle(1) · 8s

# Mixed success and failure
🔧 3 sub-agents: ✅ explore(2), ❌ librarian(1 failed) · 15s

# All failed
🔧 2 sub-agents: ❌ explore(1 failed), ❌ oracle(1 failed) · 5s

# Cancelled
🔧 3 sub-agents: ✅ explore(2), ⏹ oracle(1 cancelled) · 10s
```

### Error message (immediate)

```
⚠️ Sub-agent failed: librarian — Could not read file /path/to/file
```

### Interim status (long-running, edit-in-place)

```
🔧 Working: explore(2 running), oracle(1 done)...
```

### On-demand query (/pf agents)

```
🔧 Current session sub-agents:
  oracle ✅ completed (3s)
  explore ✅ completed (2s)
  explore ✅ completed (4s)
  librarian ❌ failed: ENOENT
```
