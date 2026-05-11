# Design: Phase 2 Task Breakdown — Request-Correlated Lifecycle

> Status: **Proposed** | Branch: `dev` | Priority: **P0** | Complexity: **High**

## Scope

This document breaks down **Phase 2** of the shared-session migration for `petfish_remote`.

Related design docs:

- [Shared Session Architecture](./shared-session-architecture.md)
- [Shared Session Implementation Plan](./shared-session-implementation-plan.md)
- [Phase 1 Task Breakdown — Root Session Binding](./phase-1-root-session-binding.md)

## Phase Goal

Replace settlement logic based on instance-wide `busy` with a **request-correlated lifecycle model**.

Phase 2 is the liveness correction phase.

## Why this phase is required

Phase 1 fixes identity. It ensures the bridge talks to the correct root session.

But identity correctness alone does not fix this failure mode:

- a request gets accepted
- output may partially stream
- assistant completion signal appears
- `/session/status` still reports `busy`
- bridge keeps deferring settlement forever

That is a lifecycle problem, not an identity problem.

## Success Criteria

Phase 2 is complete when all of the following are true:

1. A finished request can settle even if other sessions on the same instance remain busy.
2. Request state is tracked explicitly by the bridge, not inferred only from global status.
3. Waiting states such as permission/question are modeled explicitly.
4. The bridge no longer depends on `safety settle deferred` loops as its normal completion mechanism.

## Out of Scope for Phase 2

- Full child session UX
- Full session switch/fork/new card UX
- Final `petfish-bot` task-mode divergence

## Current Code Reality

The current risk center is:

- `src/connector/bridges/OpenCodeBridge.ts`

Current bridge behavior includes:

- `pending` map
- `localQueue`
- `scheduleIdleDrain()`
- `scheduleSettleOnComplete()`
- `isSessionBusyByStatus()`

The current failure mode is driven by this logic:

1. assistant completion is observed
2. settle timer fires after delay
3. bridge polls `/session/status`
4. if still `busy`, it reschedules itself

This is unsafe because `/session/status` reflects all busy sessions on the instance, not the exact request we are trying to settle.

## Design Goal for Phase 2

The bridge must maintain a **request lifecycle state machine** that can answer:

- what request is currently running
- whether it is waiting on model/tool/user input
- whether it has reached a terminal state
- whether it should continue streaming, fail, or settle

without relying on global busy as the final truth.

## Proposed State Model

### Request state

Introduce a bridge-owned request state model like:

```typescript
type BridgeRequestState =
  | 'submitted'
  | 'accepted'
  | 'running'
  | 'awaiting_permission'
  | 'awaiting_question'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'disconnected';

type BridgeRequest = {
  requestId: string;
  rootSessionId: string;
  originMessageId?: string;
  assistantMessageId?: string;
  status: BridgeRequestState;
  startedAt: string;
  completedAt?: string;
  stdout: string;
  stderr?: string;
  sentTextLengths: Map<string, number>;
  settled: boolean;
};
```

### Why this matters

Once this exists, the bridge can distinguish:

- "the root session is still doing something"
- from
- "this request has reached a terminal state and may settle"

## Event Interpretation Model

Phase 2 should interpret OpenCode events as request lifecycle signals.

### Inputs we already have

From SSE and current bridge logic:

- `message.updated`
- `message.part.updated`
- `session.updated`
- `session.idle`
- `session.status`
- `session.error`
- `question.asked`
- `permission.asked`

### Required reinterpretation

#### `message.updated`

Use to:

- correlate user message ↔ request
- correlate assistant message ↔ request
- detect assistant completion signal
- detect explicit assistant error

#### `message.part.updated`

Use to:

- stream output deltas
- build request output buffer

#### `question.asked`

Use to transition request to:

- `awaiting_question`

#### `permission.asked`

Use to transition request to:

- `awaiting_permission`

#### `session.idle`

Treat as a strong signal, but not the only one.

#### `session.status`

Treat as a **secondary health hint**, not final settlement truth.

## Completion Strategy

### Current wrong strategy

```text
assistant completed -> delay -> /session/status says busy -> defer forever
```

### Proposed strategy

```text
request correlated
  -> assistant completion detected
  -> no pending permission/question
  -> output stream quiesces / terminal marker observed
  -> settle request
```

`/session/status` may still be checked for observability, but it should not veto request completion indefinitely.

## Prompt Transport Change

Phase 2 should move bridge-mode submission toward:

- `POST /session/:id/prompt_async`

instead of TUI prompt injection.

### Why

`prompt_async` is a better fit for a mobile/shared-session product because:

- it decouples request submission from a long-lived HTTP response
- it allows the bridge to rely on the event stream for lifecycle
- it better matches a request-state machine model

### Important note

Phase 2 does not require the entire product to become `prompt_async`-only everywhere, but Bridge Mode should move in that direction.

## Queueing Model in Phase 2

### Current problem

`localQueue` is currently governed by:

- `pending.size`
- and `isSessionBusyByStatus()`

This makes queue release depend on global busy.

### Proposed behavior

Queue decisions should depend on:

- current root-session attachment
- current request lifecycle
- explicit mode semantics

At minimum:

- a request in `running / awaiting_permission / awaiting_question` blocks another live Bridge Mode request in the same attachment
- a request in `completed / failed / aborted` must release queue immediately

## Required Code Changes

## 1. Refactor `OpenCodeBridge` request bookkeeping

### Primary module target

- `src/connector/bridges/OpenCodeBridge.ts`

### Required tasks

1. replace `PendingPrompt` with a richer request model
2. separate request lifecycle from queue state
3. stop using `pending.size` as the main semantic signal
4. stop using `/session/status` as settle truth

## 2. Introduce explicit request correlation helpers

### Primary module target

- `src/connector/bridges/OpenCodeBridge.ts`

### Required tasks

1. define how user message, assistant message, and request ID correlate
2. ensure correlation survives async submission
3. ensure child session noise does not overwrite correlation for the root request

## 3. Promote question/permission to first-class request states

### Primary module targets

- `src/connector/bridges/OpenCodeBridge.ts`
- `src/connector/ConnectorClient.ts`
- server-side permission/question relay path

### Required tasks

1. request enters `awaiting_question` on `question.asked`
2. request enters `awaiting_permission` on `permission.asked`
3. answer handlers transition the request back to `running`
4. request should not falsely settle while waiting for user input

## 4. Rework settle behavior

### Primary module target

- `src/connector/bridges/OpenCodeBridge.ts`

### Required tasks

1. remove indefinite reschedule loop based only on `/session/status`
2. add request-scoped terminal conditions
3. if fallback timers remain, make them bounded and diagnostic, not normal-path control flow

## 5. Adjust server/adapter expectations

### Likely module targets

- `src/server/ConnectorGateway.ts`
- `src/runtime/RemoteRuntime.ts`
- `src/adapters/telegram/TelegramAdapter.ts`
- `src/adapters/feishu/FeishuAdapter.ts`

### Required tasks

1. server/runtime should understand richer request status reporting
2. adapters should be able to distinguish:
   - running
   - waiting for permission
   - waiting for question
   - completed
   - failed

Phase 2 does not require the full card UX yet, but it does require the underlying lifecycle vocabulary.

## Suggested Work Breakdown by Module

### A. `src/connector/bridges/OpenCodeBridge.ts`

Tasks:

1. introduce `BridgeRequest` model
2. refactor prompt/request creation path
3. rewrite completion/settlement logic
4. rewrite idle-drain gating rules
5. reinterpret SSE events into request states

### B. `src/connector/ConnectorClient.ts`

Tasks:

1. preserve request identity across bridge callbacks
2. ensure task/question/permission events carry enough lifecycle context if needed

### C. Server runtime / gateway modules

Tasks:

1. receive more expressive request state if bridge now emits it
2. prepare runtime/API layers for future busy-state UX

### D. Adapter layers

Tasks:

1. ensure pending question/permission handling does not conflict with request lifecycle states
2. avoid presenting waiting states as generic failure or infinite busy

## Suggested Commit / Work Sequence

### Step 1 — Introduce request state model in bridge

- no transport changes first if avoidable

### Step 2 — Rewire SSE event handling to mutate request state

- user correlation
- assistant correlation
- permission/question transitions

### Step 3 — Replace settle loop

- remove indefinite `status busy -> defer` dependency

### Step 4 — Validate queue release behavior

- complete request releases queue even if another session on instance is busy

### Step 5 — Expose richer lifecycle to server/adapters

- minimal integration for future IM UX

## Testing Plan

### Unit / module tests

Required cases:

1. assistant completion settles request even when another unrelated session is busy
2. permission/question transitions change request state correctly
3. aborted request reaches terminal state cleanly
4. failed assistant message triggers `failed` rather than indefinite busy

### Integration tests

Required scenarios:

1. one root request + one unrelated busy child session
   - root request still settles
2. root request waits on permission
   - not settled prematurely
3. root request waits on question
   - not settled prematurely
4. root request completes after permission/question answer
   - queue releases correctly

### Manual QA

1. start Bridge Mode request
2. trigger question/permission
3. answer from IM
4. verify completion and queue release
5. verify another busy child/subagent session does not keep IM in permanent busy after this request ends

## Risks

1. OpenCode event semantics may still contain corner cases not yet observed in current logs.
2. Phase 2 may expose assumptions in adapters that currently only distinguish success/failure.
3. Partial Phase 2 without later child attribution work could still leave noisy UX, even if liveness improves.

## Exit Conditions

Phase 2 is done only when:

1. request settlement no longer depends on global busy as a hard blocker
2. request states are explicit and testable
3. waiting-for-user-input states are modeled directly
4. queue release works after request terminal state, even with unrelated busy sessions on the same instance

## Summary

Phase 2 is the liveness correction phase.

After Phase 1 fixes identity, Phase 2 makes the bridge trustworthy under real shared-session conditions by moving from instance-busy heuristics to request-correlated lifecycle control.
