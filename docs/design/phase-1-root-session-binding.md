# Design: Phase 1 Task Breakdown — Root Session Binding

> Status: **Proposed** | Branch: `dev` | Priority: **P0** | Complexity: **Medium**

## Scope

This document breaks down **Phase 1** of the shared-session migration for `petfish_remote`.

Related design docs:

- [Shared Session Architecture](./shared-session-architecture.md)
- [Shared Session Implementation Plan](./shared-session-implementation-plan.md)
- [IM Interaction Model](./im-interaction-model.md)

## Phase Goal

Eliminate normal-path routing by "latest updated session" and replace it with **explicit root-session binding**.

This phase does **not** solve the full request lifecycle problem. Its purpose is to fix identity first.

## Success Criteria

Phase 1 is complete when all of the following are true:

1. A chat/device can be explicitly attached to a root session.
2. `OpenCodeBridge` can operate against a provided `rootSessionId` without reselecting the latest updated session during normal routing.
3. Child/subagent session updates do not change the chat's active session binding.
4. Reconnect/restart does not silently drift to another session if a binding already exists.

## Out of Scope for Phase 1

- Full replacement of settlement logic
- Full IM card/button UX
- Background task lane
- Branch/child session UI
- Product-level mode split completion

## Why this phase must come first

The current implementation in `src/connector/bridges/OpenCodeBridge.ts` still uses:

- `discoverSession()`
- session sort by `time.updated`
- implicit routing by the latest session under a project

As long as this remains true, later work on request lifecycle or IM UX will still sit on top of an unsafe identity model.

## Current Code Reality

### Connector-side bridge

Current touchpoint:

- `src/connector/bridges/OpenCodeBridge.ts`

Current behavior:

- discovers port by `cwd`
- discovers session by latest `time.updated`
- stores one `sessionId` internally
- may rediscover and replace it later

This is the primary Phase 1 target.

### Connector transport

Current touchpoint:

- `src/connector/ConnectorClient.ts`

Current behavior:

- routes incoming `TASK_START` by `projectId`
- bridge invocation currently passes only `taskId`, `instruction`, and callbacks
- no explicit root session identity is passed through

### Protocol

Current touchpoint:

- `src/protocol/connectorProtocol.ts`

Current behavior:

- task-start payload has project/task execution fields
- no explicit `rootSessionId`
- no attach/detach semantics yet

### Server-side binding and routing

Likely touchpoints:

- `src/core/SessionManager.ts`
- `src/runtime/RemoteRuntime.ts`
- `src/runtime/RuntimeRouter.ts`
- `src/server/ConnectorGateway.ts`
- `src/server/ConnectorRegistry.ts`

Current behavior likely centers on chat-project binding, but not yet root-session binding.

## Design Changes in Phase 1

## 1. Introduce explicit root-session binding in server-side state

### New concept

Add a durable or recoverable model for:

```typescript
type ChatAttachment = {
  adapter: 'telegram' | 'feishu';
  chatId: string;
  workspaceId: string;
  rootSessionId: string;
  mode: 'bridge' | 'task';
  attachedAt: number;
  lastSeenMessageId?: string;
  lastSeenFence?: string;
};
```

### Primary module target

- `src/core/SessionManager.ts`

### Required work

1. Audit current SessionManager responsibilities
2. Add root-session binding APIs
3. Define persistence strategy
   - in-memory acceptable for first cut only if reconnect semantics remain acceptable
   - SQLite preferred if current storage patterns already support session durability

### Minimum API surface

Suggested methods:

```typescript
bindRootSession(chatKey, workspaceId, rootSessionId, mode)
getRootSessionBinding(chatKey, workspaceId)
clearRootSessionBinding(chatKey, workspaceId)
switchRootSession(chatKey, workspaceId, targetRootSessionId)
```

## 2. Extend task-start payload with explicit root session identity

### Primary module target

- `src/protocol/connectorProtocol.ts`

### Required work

Add fields to the server → connector task envelope so the connector can be told:

```json
{
  "projectId": "public_bot_research",
  "rootSessionId": "ses_xxx",
  "mode": "bridge"
}
```

### Minimum payload additions

- `rootSessionId?: string`
- `mode?: 'bridge' | 'task'`

Phase 1 only requires these for identity, not full behavior split.

## 3. Make ConnectorClient forward root session identity to OpenCodeBridge

### Primary module target

- `src/connector/ConnectorClient.ts`

### Required work

Current `bridge.prompt(...)` signature is identity-blind.

Refactor toward one of these options:

### Option A — enrich `prompt(...)`

```typescript
prompt(taskId, instruction, context, onOutput, onComplete, onFail)
```

where `context` includes:

```typescript
{
  rootSessionId?: string;
  mode?: 'bridge' | 'task';
}
```

### Option B — explicit bridge binding update before prompt

```typescript
bridge.setRootSession(rootSessionId)
bridge.prompt(...)
```

Recommendation: **Option A**, because it avoids hidden mutable bridge state transitions and makes request identity explicit at the call site.

## 4. Refactor OpenCodeBridge to accept explicit session binding

### Primary module target

- `src/connector/bridges/OpenCodeBridge.ts`

### Required work

#### 4.1 Split discovery responsibility

Keep:

- `discoverPort()` as workspace-to-instance bootstrap

Change:

- `discoverSession()` should no longer be the normal routing path once `rootSessionId` is provided

#### 4.2 Add root-session aware entry path

Add a request-scoped or bridge-scoped way to say:

```typescript
useRootSession(rootSessionId)
```

or equivalent request context.

#### 4.3 Restrict rediscovery semantics

Current `rediscover()` can change both port and session.

In Phase 1, this must become:

- port rediscovery allowed
- session rediscovery not allowed if explicit `rootSessionId` exists
- if the explicit root session disappears, fail clearly instead of silently drifting to the latest session

#### 4.4 Stop sorting `/session` by latest updated in normal path

`discoverSession()` may remain only as:

- bootstrap helper for first bind
- debugging/fallback tool

It must not remain the normal route for IM tasks.

## 5. Add server-side binding flow into runtime routing

### Likely module targets

- `src/runtime/RemoteRuntime.ts`
- `src/runtime/RuntimeRouter.ts`
- `src/server/ConnectorGateway.ts`
- `src/server/ConnectorRegistry.ts`

### Required work

When a chat request becomes a bridge-mode task:

1. resolve `workspaceId`
2. resolve root session binding via SessionManager
3. include `rootSessionId` in the runtime request
4. send it to the connector intact

### Important rule

If a chat has no root session binding yet, the system must **explicitly decide how to create/select one**, rather than letting the connector auto-select by latest session.

For Phase 1, acceptable bootstrap behavior is:

- if no binding exists, use current explicit session creation/selection policy once
- then persist the chosen root session

## 6. Add a clear failure mode for invalid bound session

### Why

Once the bridge no longer drifts automatically, stale bindings can surface explicitly.

That is good, but the system must handle them cleanly.

### Required behavior

If `rootSessionId`:

- no longer exists
- cannot be fetched
- belongs to a different workspace instance

then:

- fail the request with an explicit binding error
- do not silently switch to another latest session

This protects integrity.

## Work Breakdown by Module

### A. `src/core/SessionManager.ts`

Tasks:

1. inspect current chat-project binding model
2. add root-session binding structure
3. add get/set/clear/switch APIs
4. add tests for binding correctness

### B. `src/protocol/connectorProtocol.ts`

Tasks:

1. extend task-start payload schema
2. add `rootSessionId` and `mode`
3. update protocol typing/tests if present

### C. `src/runtime/RemoteRuntime.ts` and/or `src/runtime/RuntimeRouter.ts`

Tasks:

1. resolve root-session binding before remote execution
2. include binding in runtime request context
3. preserve backward compatibility for task-only paths if needed

### D. `src/server/ConnectorGateway.ts` / `src/server/ConnectorRegistry.ts`

Tasks:

1. ensure outgoing task payload forwards `rootSessionId`
2. audit whether any connector routing currently assumes session-less project-only execution

### E. `src/connector/ConnectorClient.ts`

Tasks:

1. parse new task-start fields
2. pass explicit root-session context to bridge
3. keep LocalTaskExecutor path unchanged for non-bridge projects

### F. `src/connector/bridges/OpenCodeBridge.ts`

Tasks:

1. refactor prompt entry to accept root-session context
2. stop normal-path latest-session selection
3. constrain rediscovery to port or explicit-session validation
4. add clear failure for missing/stale bound session
5. add tests or at least harness coverage for fixed-session behavior

## Suggested Commit / Work Sequence

### Step 1 — Protocol + types

- add `rootSessionId` / `mode` fields
- no behavior change yet

### Step 2 — SessionManager binding model

- add explicit binding APIs
- hook up persistence/in-memory store

### Step 3 — Server runtime flow

- read binding
- pass root session into remote task payload

### Step 4 — ConnectorClient bridge call signature

- forward context to bridge

### Step 5 — OpenCodeBridge fixed-session refactor

- remove normal-path latest drift
- enforce explicit session identity

### Step 6 — Validation

- verify same root session across repeated requests
- verify child session cannot steal attachment
- verify reconnect does not drift

## Testing Plan

### Unit / module tests

Required cases:

1. binding set/get/clear/switch in SessionManager
2. task-start payload schema accepts `rootSessionId`
3. OpenCodeBridge refuses to drift when explicit root session exists

### Integration tests

Required scenarios:

1. one workspace, two sessions under same cwd, one explicit root binding
   - ensure bridge uses bound session only
2. child session updates later than root
   - ensure routing does not change
3. connector restart with stored binding
   - ensure bridge reuses bound session

### Manual QA

1. Attach a chat to a known root session
2. Trigger child/subagent activity
3. Send follow-up IM request
4. Confirm connector still routes to original root session

## Risks

1. If binding persistence is weak, reconnect behavior may still feel unstable.
2. If OpenCodeBridge still performs hidden rediscovery in error paths, latest-session drift may survive in edge cases.
3. If Phase 1 ships without Phase 2 soon after, users may still hit busy/settlement problems — just with better identity correctness.

## Exit Conditions

Phase 1 should be considered done only when:

1. latest-session routing is no longer the normal bridge path
2. root session identity is explicit across server → connector → bridge
3. drift to child/latest session is prevented by tests or reproducible harnesses

## Summary

Phase 1 is the identity correction phase.

It does not solve the whole shared-session problem, but it removes the most dangerous assumption in the current system: that the correct live session can be rediscovered by picking the latest-updated session under a workspace.

Once that assumption is removed, later work on request lifecycle and IM UX can be built on a safe root-session model instead of a drifting attachment model.
