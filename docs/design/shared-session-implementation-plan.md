# Design: Shared Session Implementation Plan

> Status: **Proposed** | Branch: `dev` | Priority: **P0** | Complexity: **High**

## Scope

This document translates the shared-session architecture into an implementation plan for `petfish_remote`.

Related design documents:

- [Shared Session Architecture](./shared-session-architecture.md)
- [IM Interaction Model](./im-interaction-model.md)
- [Question & Permission Relay](./question-permission-relay.md)

## Goal

Upgrade `petfish_remote` from a TUI-coupled bridge model to a session-oriented bridge model built on OpenCode's documented server/session/event interfaces, while preserving desktop/mobile shared-session continuity.

## Success Criteria

The implementation is successful when all of the following are true:

1. A chat/device is attached to an explicit root session, not a latest-updated session.
2. Child/subagent sessions cannot steal routing from the root session.
3. Request completion is determined by request-correlated lifecycle, not instance-wide `busy` alone.
4. Mobile can perform `switch`, `fork`, `new`, `abort`, and `detach` through explicit IM controls.
5. Bridge Mode and Task Mode are both supported and visibly distinguishable.

## Non-Goals

- Replacing `petfish_remote` bridge mode with task-only mode
- Implementing a full web console in this phase
- Solving every `petfish-bot` architecture concern here
- Depending on `/tui/*` as the main remote control path

## Current Constraints

The current codebase already contains:

- `src/connector/bridges/OpenCodeBridge.ts`
- `src/connector/bridges/AgentBridge.ts`
- adapter surfaces for Telegram and Feishu
- existing question/permission relay direction

This gives us a good insertion point, but the current bridge semantics are still centered around:

- `cwd -> latest session`
- TUI-driven prompt injection
- settlement via `/session/status`

Those semantics must change.

## Implementation Strategy

Use a phased migration instead of a rewrite.

### Guiding rule

First fix **identity**, then **lifecycle**, then **UX**, then **product split**.

If we do UX first, the underlying routing model will remain unsafe. If we do lifecycle first without explicit binding, child session contamination will remain.

---

## Phase 1 — Root Session Identity

### Objective

Stop routing by latest-updated session. Introduce explicit root-session binding.

### Deliverables

1. A root-session binding model on the server side
2. A connector contract that accepts explicit session identity
3. Removal of normal-path latest-session drift

### Required code changes

#### Server / session binding

Likely touchpoints:

- `src/core/` session/task binding logic
- `src/runtime/` routing logic
- `src/storage/` persistent binding state (if persisted)

Add a concept similar to:

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

#### Connector bridge

Touchpoint:

- `src/connector/bridges/OpenCodeBridge.ts`

Required refactor:

- remove "select latest-updated session" as the normal routing path
- add a way to initialize or update bridge state with an explicit `rootSessionId`
- treat session discovery as a fallback/bootstrap step, not a per-request routing mechanism

#### Protocol

Touchpoints:

- `src/protocol/connectorProtocol.ts` (or equivalent protocol schema location)
- `src/connector/ConnectorClient.ts`
- server connector gateway/runtime bridge

Add message fields or new envelopes so the server can say:

```json
{
  "workspaceId": "public_bot_research",
  "rootSessionId": "ses_xxx",
  "mode": "bridge"
}
```

### Validation criteria

1. A chat remains attached to the same root session across multiple requests.
2. A child/subagent session updating later does not steal routing.
3. Restarting the connector does not cause the bridge to reattach to a different latest session if a root binding already exists.

---

## Phase 2 — Request-Correlated Lifecycle

### Objective

Replace settlement based on instance-wide `/session/status` with a bridge-owned request state machine.

### Deliverables

1. Request context object per mobile-originated action
2. Request status machine
3. Completion logic that does not deadlock on unrelated busy sessions

### Required code changes

#### OpenCode bridge lifecycle

Touchpoint:

- `src/connector/bridges/OpenCodeBridge.ts`

Replace or heavily refactor logic around:

- `pending`
- `localQueue`
- `scheduleIdleDrain`
- `scheduleSettleOnComplete`
- `isSessionBusyByStatus`

Introduce request tracking along these lines:

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
  status: BridgeRequestState;
  createdAt: number;
  completedAt?: number;
};
```

#### Prompt transport

Move bridge-mode prompt submission toward:

- `POST /session/:id/prompt_async`

instead of `/tui/*` prompt submission.

This avoids coupling completion to a synchronous HTTP response that mirrors TUI behavior.

#### Event handling

Continue using:

- `GET /event`

but reinterpret it as the request progress channel.

At minimum, handle:

- `part.delta`
- `message.updated`
- `session.updated`
- `permission.asked`
- `question.asked`

### Validation criteria

1. A request settles even if unrelated child sessions remain busy.
2. A root session can continue to be active while an already-finished request is marked completed.
3. The bridge no longer produces indefinite `safety settle deferred` loops based solely on `/session/status`.

---

## Phase 3 — Child Session Attribution

### Objective

Make subagents/forks visible without letting them become routing anchors.

### Deliverables

1. Root-to-child attribution model
2. Child session discovery surface
3. Clear routing rule: root session owns attachment

### Required code changes

#### OpenCode bridge

Touchpoints:

- `src/connector/bridges/OpenCodeBridge.ts`

Use OpenCode child session APIs for visibility, not routing.

#### Render / adapter surfaces

Touchpoints:

- `src/render/`
- `src/adapters/telegram/TelegramAdapter.ts`
- `src/adapters/feishu/FeishuAdapter.ts`

Surface child session summaries as secondary information:

- branch list
- subagent activity
- "view children"

### Validation criteria

1. Child sessions can be displayed in UI.
2. Child sessions cannot auto-steal the current mobile attachment.
3. Child busy state does not block unrelated root request settlement.

---

## Phase 4 — IM UX and Control Plane

### Objective

Expose the shared-session model safely to IM users.

### Deliverables

1. Current Session Card
2. Busy-State Card
3. Session List / Switch flow
4. Fork / New / Background Task flows
5. Detach mobile action

### Required code changes

#### Adapters

Touchpoints:

- `src/adapters/telegram/TelegramAdapter.ts`
- `src/adapters/feishu/FeishuAdapter.ts`
- platform-specific render policy files

Add card/button surfaces for:

- current session summary
- busy-state choices
- switch / fork / new / detach

#### Render layer

Touchpoints:

- `src/render/`

Add structured render models for:

- session cards
- branch list
- background task cards
- status/action cards

#### Server-side command routing

Touchpoints:

- `src/core/` command/session router
- possibly `main.ts` or adapter command handlers

Control operations should use explicit actions rather than relying only on NLP.

### Validation criteria

1. A busy live session shows actionable choices, not just a generic busy message.
2. Users can switch, fork, new, abort, and detach without typing ambiguous free-text commands.
3. The current mode and current root session are always visible.

---

## Phase 5 — Task Mode Formalization

### Objective

Make Task Mode an explicit secondary path for `petfish_remote` and the primary path for `petfish-bot`.

### Deliverables

1. Clear mode model in protocol and storage
2. Background task lane in IM UX
3. Architectural divergence point for `petfish_remote` vs `petfish-bot`

### Required code changes

#### Shared concepts

Touchpoints:

- `src/core/`
- `src/runtime/`
- possibly `src/storage/`

Add mode-aware routing:

- Bridge Mode → root session semantics
- Task Mode → isolated execution semantics

#### Product split

Document and enforce:

- `petfish_remote` default = Bridge Mode
- `petfish-bot` default = Task Mode

### Validation criteria

1. A background task does not mutate or hijack the current live root session.
2. `petfish-bot` can adopt the simpler task-first path without inheriting shared-session complexity.

---

## Data Model Changes

At minimum, the server will need durable or recoverable models for:

- chat/device attachment
- root session binding
- request lifecycle
- last seen message/fence/checkpoint
- mode (`bridge` / `task`)

Depending on current storage patterns, these can be:

- persisted in SQLite
- or partially cached in memory with persistence for high-value state

## Protocol Changes

Expected protocol expansion:

1. messages carrying `rootSessionId`
2. messages carrying mode
3. request identifiers for bridge requests
4. attach / detach / switch actions
5. richer status/result payloads for request lifecycle

## Testing Plan

### Unit tests

Add tests for:

- explicit root-session binding
- no latest-session drift
- request lifecycle transitions
- child session attribution logic
- mode-aware routing decisions

### Integration tests

Add tests for:

1. one root session + one child session under same workspace
   - ensure child cannot steal routing
2. one completed request + one still-busy child session
   - ensure completed request settles
3. switch session flow
4. fork flow
5. background task flow
6. detach mobile flow

### Manual QA

Verify on Telegram and Feishu:

- current session card
- busy-state actions
- permission/question relay
- reconnect/resync behavior

## Suggested Delivery Order

If implemented incrementally, the recommended order is:

1. **Phase 1** — explicit root-session binding
2. **Phase 2** — request-correlated lifecycle
3. **Phase 4** — minimal IM control plane (current session / busy-state / abort / detach)
4. **Phase 3** — child session attribution
5. **Phase 5** — formal Task Mode split

Rationale:

- identity must come before lifecycle
- lifecycle must come before UX polish
- child visibility is useful, but safer after root-session correctness exists

## Risks

1. OpenCode async prompt + SSE completion boundaries may require additional empirical validation.
2. Introducing explicit mode semantics may expose product ambiguity already present in current flows.
3. Partial migration (root binding without lifecycle refactor) may reduce but not remove deadlocks.
4. Adapter UX work can sprawl if not constrained to v1 surfaces.

## Open Questions

1. Should root-session binding be persisted per chat, per adapter chat, or per user+workspace?
2. Should Background Tasks be globally visible across all attachments or local to one chat/device?
3. What is the minimum checkpoint/fence design needed for safe reconnect?
4. Should branch promotion be included in the first rollout or deferred?
5. Does `petfish_remote` eventually need a dedicated bridge-owned OpenCode serve process even when a local TUI is present?

## Summary

The implementation should not start with IM cards or button polish. It should start by fixing the three structural layers in order:

1. **root session identity**
2. **request-correlated lifecycle**
3. **mode-aware UX and control plane**

Once those are in place, `petfish_remote` can support true desktop/mobile shared-session continuity, and `petfish-bot` can safely diverge into a simpler task-first product profile.
