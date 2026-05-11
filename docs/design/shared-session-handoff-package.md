# Handoff Package: Shared Session Redesign for petfish_remote

> Audience: `petfish_remote team` | Status: **Prepared for handoff** | Priority: **P0**

## Purpose

This document is the handoff package for the shared-session redesign work.

It is intended to help the `petfish_remote team` quickly understand:

1. what problem was actually observed
2. what root cause chain has already been established
3. what design conclusions are now stable
4. which implementation phases are recommended next
5. where uncertainty still remains

## Deliverables Already Produced

The following design documents already exist in this repo:

- [Shared Session Architecture](./shared-session-architecture.md)
- [IM Interaction Model](./im-interaction-model.md)
- [Shared Session Implementation Plan](./shared-session-implementation-plan.md)
- [Phase 1 Task Breakdown — Root Session Binding](./phase-1-root-session-binding.md)

This handoff package should be read before implementation begins.

## Background

During live use of `public_bot_research`, the IM side repeatedly showed a `busy` response while desktop/TUI work continued. At the same time, TUI output was being mirrored back into the IM channel.

This behavior was initially ambiguous: it could have been interpreted as either:

- a broken task execution flow
- a stuck queue
- a bridge/session binding issue
- an OpenCode internal busy-state issue

The investigation established that the problem was structural, not incidental.

## Observed Symptoms

### User-visible symptoms

- IM messages repeatedly returned `busy`
- TUI responses appeared in the same IM conversation
- follow-up IM requests were queued rather than executed as independent work
- session behavior felt "stuck" even when some work appeared already complete

### Runtime-level symptoms

- `OpenCodeBridge` logged:
  - `routing to opencode bridge`
  - `IM task in-flight, queuing ...`
  - `safety settle deferred — session still busy`
- `/session/status` on the active OpenCode instance kept returning `busy`
- multiple sessions under the same project/cwd were busy simultaneously
- the active bridge target could drift based on "latest updated session"

## Root Cause Summary

The root cause chain is now considered established.

### 1. The current bridge binds by workspace, not by explicit root session

Current bridge logic effectively follows:

```text
cwd -> port -> latest-updated session -> /session/status
```

This is structurally unsafe for a shared-session product.

### 2. Child/subagent sessions can contaminate routing

Because the active session is selected by latest update time, any newer child/subagent session under the same project can become the implicit target.

### 3. Settlement uses the wrong truth source

The current bridge defers settlement based on `/session/status` remaining `busy`.

But OpenCode returns status for **all busy sessions on the instance**, not just the current user-relevant request. That makes instance-wide busy an unreliable completion signal for shared-session interaction.

### 4. The current product surface is TUI-coupled

The bridge currently behaves more like a TUI attachment model than a stable shared-session model. This creates a mismatch between product intent and implementation substrate.

## Design Conclusions That Are Now Stable

These conclusions should be treated as current design direction, not open questions.

### Conclusion 1 — `petfish_remote` is bridge-first

`petfish_remote` should not default to task-only semantics.

Its core value is desktop/mobile free switching within the same working context. That requires bridge/shared-session semantics as a first-class product path.

### Conclusion 2 — `petfish-bot` and `petfish_remote` should diverge

`petfish-bot` can be task-first.

`petfish_remote` must be shared-session first.

The two products should share infrastructure selectively, but not force the same default execution model.

### Conclusion 3 — Bridge mode should remain, but be redesigned

The correct fix is not "remove bridge mode".

The correct fix is to replace the current **TUI-bridge** with a **session-bridge** built on OpenCode's stable server/session/event interfaces.

### Conclusion 4 — `/tui/*` should not remain the primary product protocol

TUI control endpoints may remain useful for narrow compatibility cases, but they should not serve as the long-term control substrate for `petfish_remote`.

### Conclusion 5 — Session identity must become explicit

The bridge must bind a chat/device to a **root session** explicitly.

No more normal-path latest-session discovery.

## OpenCode Research Conclusions

The following OpenCode interfaces are considered stable enough to build against:

- `opencode serve`
- session CRUD APIs
- `GET /session/status`
- `POST /session/:id/prompt_async`
- `POST /session/:id/abort`
- `GET /event` SSE stream
- permission/question APIs
- `x-opencode-directory`
- `x-opencode-fence`

The following should not be the core long-term protocol:

- `/tui/append-prompt`
- `/tui/submit-prompt`
- `/tui/clear-prompt`
- `/tui/control/*`

## Product Model to Preserve

The target product semantics for `petfish_remote` are:

1. **Current Session** — the live shared working thread
2. **Background Tasks** — isolated side work
3. **Branches / Experiments** — safe divergence from the current root session

This is better than exposing raw queue terminology to IM users.

## Recommended Implementation Order

### Phase 1 — Root Session Binding

Goal:

- remove latest-session drift
- introduce explicit root-session identity

See:

- [Phase 1 Task Breakdown — Root Session Binding](./phase-1-root-session-binding.md)

### Phase 2 — Request-Correlated Lifecycle

Goal:

- replace global busy-based settlement with request lifecycle semantics

This phase should be treated as the next implementation priority after Phase 1.

### Phase 3 — Child Session Attribution

Goal:

- show child/subagent sessions without letting them steal routing

### Phase 4 — IM UX / Control Plane

Goal:

- current session card
- busy-state card
- switch/fork/new/detach controls

### Phase 5 — Task Mode Formalization

Goal:

- keep `petfish_remote` bridge-first
- keep `petfish-bot` task-first
- formalize product split

## Key Questions the Team Still Needs to Settle

These are real open questions, but they do not block the high-level direction.

1. How should root-session binding be persisted?
2. What is the precise completion boundary for `prompt_async + SSE` in OpenCode for our product needs?
3. Should background tasks be globally visible per workspace, or local to one chat/device?
4. How much session branching should be visible in v1 IM UX?
5. Should `petfish_remote` ultimately run against a dedicated `opencode serve` instance even when desktop TUI is present?

## Boundaries

This handoff package is intentionally limited to:

- root cause findings
- design decisions
- implementation sequencing

It does **not** contain code implementation and should not be interpreted as partial implementation authority. The `petfish_remote team` should implement, while design support/review can continue externally.

## Recommended Team Workflow

1. Read the four design docs listed above
2. Review Phase 1 scope and agree on persistence/protocol choices
3. Implement Phase 1 in a bounded branch
4. Validate with child-session contamination scenarios
5. Only then begin Phase 2

## Summary

The system is not failing because bridge mode is the wrong product idea. It is failing because the current bridge implementation is bound to the wrong identities and the wrong completion semantics.

The redesign direction is therefore:

- keep bridge mode
- replace TUI-bridge with session-bridge
- pin root session identity
- move settlement from global busy to request-correlated lifecycle
- expose shared-session controls explicitly in IM UX
