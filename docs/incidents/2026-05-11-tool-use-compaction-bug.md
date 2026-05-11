# Incident Report: tool_use/tool_result Compaction Bug

> Date: 2026-05-11
> Severity: **P1 — Service-Breaking**
> Affected: All Claude-model sessions that reach compaction threshold (~300 messages)
> Root cause: opencode `filterCompacted()` + `normalizeMessages()` in `anomalyco/opencode`
> petfish_remote involvement: **None** — pure text proxy, zero AI SDK dependencies
> Status: Upstream bug — open issues filed, mitigation plan below

---

## 1. Incident Description

During a long-running opencode session controlled via 胖鱼遥控器 (PetFish Remote), the Claude API returned an HTTP 400 error after opencode's automatic context compaction triggered. The error message:

```
tool_use ids were found without tool_result blocks immediately after:
  toolu_vrtx_016hirAPuHVnkUGgYwKT91SL
  toolu_vrtx_01Amb5GaJ1bniXQewpPTqGvm
  toolu_vrtx_01AuPD8QPkf7Rfe1Hs3RMPyL
  toolu_vrtx_01DnnrDnK4UWNAFHvdQBUi3k
  toolu_vrtx_01TATDjc9G8EkErwEyauDcLv
```

The assistant had issued 5 parallel `tool_use` blocks, but after compaction the subsequent user message containing the 5 matching `tool_result` blocks was dropped. The Claude API enforces strict pairing — every `tool_use` must have an immediately following `tool_result` — so the session became permanently corrupted and unrecoverable.

### Key observation from user

> "这个问题出现在compaction阶段。而且似乎只有claude相关模型才有。"

This matches exactly. The bug is Claude-specific due to a structural difference in how Claude vs OpenAI handle tool results in their API contracts.

---

## 2. Root Cause Analysis

### 2.1 petfish_remote is NOT involved

Verified exhaustively:

| Check | Result |
|---|---|
| AI SDK dependencies | **Zero** — no `@anthropic-ai/sdk`, no `openai`, no `@ai-sdk/*` |
| PromptBuilder | Builds **plain text strings** only — no message history, no tool blocks |
| OpenCodeBridge | Sends single `{type:'text', text}` via `session.promptAsync()` |
| SSE relay | Only relays `type:'text'` events — tool events are ignored |
| OutputBatcher | Pure text formatting with platform-specific truncation |
| Message history management | **None** — does not read, write, or modify conversation history |

petfish_remote is a **pure text proxy**. It sends text instructions to opencode and receives text output. It cannot produce, consume, or corrupt `tool_use`/`tool_result` message pairs.

### 2.2 Three root causes in opencode (all upstream)

#### Bug A — `filterCompacted()` cuts tail at wrong boundary

**File**: [`packages/opencode/src/session/message-v2.ts` L1071–1124](https://github.com/anomalyco/opencode/blob/7235c9c/packages/opencode/src/session/message-v2.ts#L1071-L1124)

When context overflows, opencode summarizes old messages and keeps a "tail" of recent turns verbatim. The `filterCompacted()` function uses `tail_start_id` to decide where the tail begins. **The bug**: if `tail_start_id` points to an assistant message containing `tool_use` blocks, the paired user message with `tool_result` blocks sits at `tail_start_id - 1` and gets excluded from the retained history.

Result: assistant message with 5 `tool_use` blocks is kept, but the user message with the 5 matching `tool_result` blocks is dropped. Claude API rejects with HTTP 400.

**This is our case.** The 5 orphaned tool IDs in our error match this pattern exactly.

#### Bug B — `normalizeMessages()` splits tool pairs incorrectly

**File**: [`packages/opencode/src/provider/transform.ts`](https://github.com/anomalyco/opencode/blob/7235c9c/packages/opencode/src/provider/transform.ts)

The Anthropic-specific reordering in `normalizeMessages()` splits assistant turns shaped `[tool-call, tool-result, text]` into two messages: `[tool-result, text]` and `[tool-call]`. This separates the tool-result from its tool-call, violating Claude's pairing contract.

#### Bug C — Interrupted tool calls leave orphaned `tool_use`

**File**: [`packages/opencode/src/session/message-v2.ts` L914–924](https://github.com/anomalyco/opencode/blob/7235c9c/packages/opencode/src/session/message-v2.ts#L914-L924)

When tool execution is interrupted (timeout, abort, crash), the `tool_use` block is recorded but no `tool_result` is inserted. A mitigation exists in `toModelMessagesEffect()` that synthesizes error `tool_result` blocks at serialization time, but it does not fix the underlying storage or protect against `filterCompacted()` reconstructing history from the corrupted state.

### 2.3 Why only Claude models are affected

| Aspect | Claude API | OpenAI API |
|---|---|---|
| Tool result role | `role: "user"` with `tool_result` content blocks | `role: "tool"` — dedicated separate role |
| Pairing enforcement | **Strict**: every `tool_use` must be immediately followed by matching `tool_result` | Each `role: "tool"` is an independent message |
| Compaction risk | **HIGH**: `tool_result` embedded in `role: "user"` messages → compactor can't distinguish from normal user text | **LOW**: `role: "tool"` is semantically distinct, easier to detect |
| Error on violation | HTTP 400 — session permanently broken | Silently ignores orphaned tool calls |

Claude's embedding of `tool_result` inside `role: "user"` messages is the fundamental design choice that makes compaction dangerous. A naive "keep last N messages" or "cut at message ID" approach will inevitably break tool pairs because the compactor doesn't understand the atomic relationship between an assistant's `tool_use` and the following user's `tool_result`.

### 2.4 Claude API Tool Contract (exact rules)

1. `tool_result` blocks MUST appear in the user message immediately after the assistant message containing the matching `tool_use` blocks
2. If assistant returns N `tool_use` blocks, the next user message MUST contain exactly N `tool_result` blocks, ALL in ONE message
3. `tool_result` blocks must appear FIRST in the content array, text content AFTER
4. Failed tools must still return `tool_result` with `is_error: true`
5. Programmatic tool results MUST contain ONLY `tool_result` blocks (no mixed text)

---

## 3. Existing Upstream Issues

| Issue | Status | Description | Match |
|---|---|---|---|
| [#14367](https://github.com/anomalyco/opencode/issues/14367) | 🔴 OPEN | `filterCompacted` trims history leaving orphaned `tool_use` — API 400 after compaction | **Primary match — this is our bug** |
| [#25774](https://github.com/anomalyco/opencode/issues/25774) | 🔴 OPEN | `normalizeMessages()` splits `tool-call` from `tool-result` causing dangling pairs | Related — Bug B |
| [#10616](https://github.com/anomalyco/opencode/issues/10616) | ✅ CLOSED | `tool_use` ids found without `tool_result` blocks — 44 sessions, 311 orphaned parts | Historical — same symptom |
| [#21326](https://github.com/anomalyco/opencode/issues/21326) | ✅ CLOSED | Interrupted tool calls permanently corrupt session history | Bug C — mitigated |
| [#22808](https://github.com/anomalyco/opencode/issues/22808) | 🔴 OPEN | 400 Error due to unclosed tool_calls after interruption | Related |
| [#9532](https://github.com/anomalyco/opencode/issues/9532) | 🔴 OPEN | Frequent tool calling errors with Claude | Umbrella symptom |
| [#17065](https://github.com/anomalyco/opencode/issues/17065) | ✅ CLOSED | ~300 messages triggers compaction → 400 from Anthropic | Duplicate of #14367 |
| [PR #8497](https://github.com/anomalyco/opencode/pull/8497) | ✅ CLOSED | Fix: converts `pending`/`running` tool states to error `tool_result` blocks | Partial fix for Bug C only |

---

## 4. Recommended Fix (Upstream)

### For Bug A (`filterCompacted`)

`filterCompacted()` must treat `tool_use`/`tool_result` pairs as **atomic units**:

```
When selecting tail_start_id:
  1. If the message at tail_start_id is an assistant message with tool_use blocks,
     extend tail backward to include the PRECEDING user message with tool_result blocks
  2. If the message at tail_start_id is a user message with tool_result blocks,
     extend tail backward to include the PRECEDING assistant message with tool_use blocks

Post-compaction validation:
  3. Scan reconstructed history for any tool_use block without a matching tool_result
  4. Scan for any tool_result block without a preceding tool_use
  5. If orphans found → extend tail further or synthesize error tool_result blocks
```

### For Bug B (`normalizeMessages`)

The Anthropic reorder split must treat `tool-result` as a "tool part" alongside `tool-call`:

```typescript
// CURRENT (broken):
const isToolPart = (p) => p.type === "tool-call"

// FIX:
const isToolPart = (p) => p.type === "tool-call" || p.type === "tool-result"
```

---

## 5. Mitigation Plan for petfish_remote

Since the bug is upstream and we cannot fix opencode, the following mitigations reduce impact on our users:

### 5.1 Detect compaction errors and provide actionable guidance (IMPLEMENT)

**What**: When `session.error` fires and the error message contains `tool_use` or `tool_result` keywords, send the user a clear, actionable message instead of a cryptic API error.

**Why**: Currently the user sees a raw "400 error" that looks like petfish_remote is broken. With detection, we can explain the situation and suggest recovery.

**How**: In `OpenCodeBridge.handleSessionError()`, detect the error pattern and annotate the failure message:

```
⚠️ Session corrupted by a known opencode compaction bug (tool_use/tool_result mismatch).
This is not a petfish_remote issue — it's a known bug in opencode's context compaction logic.

Recovery: Use /pf new to start a fresh session. Your project files are unaffected.
Tracking: https://github.com/anomalyco/opencode/issues/14367
```

### 5.2 Monitor session depth and warn before compaction threshold (IMPLEMENT)

**What**: Track approximate message count per session. When approaching the compaction threshold (~250 messages), proactively warn the user.

**How**: Count `message.updated` SSE events with `role: 'assistant'`. At ~250, append a one-time warning to the next output:

```
💡 This session has ~250 messages and may trigger context compaction soon.
Claude models have a known compaction bug that can corrupt the session.
Consider starting a fresh session with /pf new if you're using Claude.
```

### 5.3 Auto-create new session on compaction failure (CONSIDER)

**What**: When a compaction error is detected, automatically create a new session and notify the user, rather than leaving them in a dead session.

**Why**: Reduces manual recovery steps. The user doesn't have to know about `/pf new` — the system handles it.

**Risk**: May surprise users who expect session continuity. Should be opt-in or at least clearly announced.

### 5.4 Track `session.compacted` events (IMPLEMENT)

**What**: opencode emits `session.compacted` SSE events. Log these to understand compaction frequency and correlate with failures.

**How**: Add a handler for `session.compacted` in the SSE dispatch. Log timestamp, session ID, and message count at compaction time. This data helps us understand the failure pattern and refine the warning threshold.

### Priority

| # | Mitigation | Effort | Impact | Priority |
|---|---|---|---|---|
| 5.1 | Error detection + guidance | Small | High — eliminates user confusion | **P1** |
| 5.2 | Session depth warning | Small | Medium — prevents some occurrences | **P1** |
| 5.4 | Track compaction events | Trivial | Low (observability) | **P2** |
| 5.3 | Auto-recovery | Medium | High — but needs UX design | **P3** |

---

## 6. Issue Content for Upstream Submission

### Title

`filterCompacted() breaks tool_use/tool_result atomic pairs during context compaction — Claude API 400`

### Body

```markdown
## Bug Description

After automatic context compaction in a long-running session (~300+ messages),
the Claude API returns HTTP 400:

> tool_use ids were found without tool_result blocks immediately after:
> toolu_vrtx_016hirAPuHVnkUGgYwKT91SL (and 4 more)

The assistant message contained 5 parallel `tool_use` blocks. After compaction,
the assistant message was retained but the following user message with the 5
matching `tool_result` blocks was dropped by `filterCompacted()`.

## Environment

- opencode: latest (confirmed on HEAD 7235c9c)
- Model: claude-sonnet-4-6 (Claude models only — OpenAI not affected)
- Trigger: automatic compaction at ~300 messages
- Client: PetFish Remote (pure text proxy — does not touch message history)

## Root Cause

`filterCompacted()` in `message-v2.ts` (L1071–1124) selects a `tail_start_id`
to determine which recent messages to keep verbatim after compaction. If
`tail_start_id` points to an assistant message with `tool_use` blocks, the
preceding user message with matching `tool_result` blocks falls outside the
retained range and is discarded.

Claude's API embeds `tool_result` inside `role: "user"` messages, so the
compactor cannot distinguish tool results from ordinary user text. The result
is a permanently corrupted session — the orphaned `tool_use` blocks will
trigger HTTP 400 on every subsequent API call.

## Why Claude Only

| Aspect | Claude | OpenAI |
|---|---|---|
| Tool result role | `role: "user"` with `tool_result` blocks | `role: "tool"` (separate) |
| Pairing enforcement | Strict — immediate adjacency required | Independent messages |
| Compaction vulnerability | High — tool results look like user text | Low — `role: "tool"` is distinct |

## Suggested Fix

1. Treat `tool_use`/`tool_result` message pairs as **atomic units** in
   `filterCompacted()`. When `tail_start_id` falls on an assistant message
   with tool calls, extend the boundary to include the following user message
   with tool results (and vice versa).

2. Add post-compaction validation: scan reconstructed history for orphaned
   `tool_use` without matching `tool_result`. If found, either extend the
   tail or synthesize error `tool_result` blocks.

## Related Issues

- #14367 (same bug — open)
- #25774 (`normalizeMessages` split — open)
- #21326 (interrupted tool calls — closed/mitigated)
- #10616 (44 sessions affected — closed)
- #22808 (400 after interruption — open)
- PR #8497 (partial fix for pending/running states)

## Repro

1. Start a Claude session
2. Perform heavy tool-using work (~300+ messages with many parallel tool calls)
3. Wait for automatic compaction to trigger
4. Next API call fails with HTTP 400 "tool_use ids found without tool_result"
5. Session is permanently corrupted — no recovery possible without manual history editing
```

---

## 7. Timeline

| Time | Event |
|---|---|
| 2026-05-11 | User reports tool_use/tool_result error during IM-controlled session |
| 2026-05-11 | User identifies compaction as trigger, Claude-only pattern |
| 2026-05-11 | Investigation confirms petfish_remote is not involved (pure text proxy) |
| 2026-05-11 | 3 root causes identified in opencode (filterCompacted, normalizeMessages, interrupted calls) |
| 2026-05-11 | Existing upstream issues found (#14367 primary, #25774, #21326, #10616) |
| 2026-05-11 | Mitigation plan drafted for petfish_remote |
| TBD | Implement mitigations 5.1 + 5.2 + 5.4 |
| TBD | Submit/comment on upstream issue |
