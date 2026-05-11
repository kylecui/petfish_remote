# Design: Shared Session Architecture for petfish_remote

> Status: **Proposed** | Branch: `dev` | Priority: **P0** | Complexity: **High**

## Problem

`petfish_remote` and `petfish-bot` should not share the same default execution model.

- `petfish-bot` is fundamentally a **mobile-only IM bot**. Users do not depend on a live desktop TUI, so isolated task execution is acceptable and often preferable.
- `petfish_remote` is fundamentally a **desktop/mobile shared workspace product**. Its core value is that the user can move between desktop and mobile while staying in the **same working context**.

The current SessionBridge/OpenCodeBridge implementation preserves this shared-session idea, but does so using the wrong attachment model:

1. It discovers an OpenCode instance by `cwd`
2. It selects the current session by **latest updated session**
3. It treats `/session/status` as the settlement truth
4. It drives the TUI through `/tui/*` endpoints

This creates three structural failures:

- **Wrong-session attachment**: subagent or child sessions under the same project can steal routing
- **Indefinite busy**: settlement can be deferred forever while HTTP session status remains `busy`
- **Surface confusion**: mobile chat unintentionally becomes a live mirror of desktop TUI activity

The result is not a stable desktop/mobile shared session model. It is a fragile TUI attachment model.

## Design Goal

Redesign `petfish_remote` so that desktop and mobile are two clients of the **same OpenCode root session**, while preserving:

1. **Consistency** — both clients observe the same session truth
2. **Integrity** — mobile cannot accidentally hijack unrelated sessions or subagents
3. **Ownership** — the system always knows which client is attached to which root session
4. **Mode clarity** — shared live session and isolated background task are different product modes

## Non-Goals

- Replacing bridge mode with task-only mode for `petfish_remote`
- Building on `/tui/*` as the primary long-term protocol
- Supporting arbitrary concurrent IM-driven writes into all sessions under a project
- Designing the full `petfish-bot` architecture in this document (covered only as contrast)

## Research Summary

### 1. OpenCode's ground truth

OpenCode's own TUI is **just another client** of the server it starts.

> When you run `opencode` it starts a TUI and a server. Where the TUI is the client that talks to the server.

Implication: bridge mode is architecturally valid. The question is not whether to keep bridge mode, but **which OpenCode interfaces the bridge should rely on**.

### 2. Stable OpenCode interfaces we should build against

These interfaces are documented or OpenAPI-backed and are suitable as first-class dependencies:

| Interface | Role |
|---|---|
| `opencode serve` | Headless server mode for programmatic access |
| `GET /session` | List sessions |
| `POST /session` | Create session |
| `GET /session/:id` | Session details |
| `GET /session/:id/children` | Child/subagent sessions |
| `GET /session/status` | Busy/retry status map |
| `POST /session/:id/message` | Synchronous prompt |
| `POST /session/:id/prompt_async` | Asynchronous prompt |
| `POST /session/:id/abort` | Abort running work |
| `GET /event` | Instance-scoped SSE stream |
| permission/question reply endpoints | User-in-the-loop controls |
| `x-opencode-directory` | Workspace routing |
| `x-opencode-fence` | Sync fence for mutation ordering |

### 3. Interfaces we should avoid as core protocol

These are meaningful for IDE/TUI control, but are too incidental to serve as the main product API:

| Interface | Why not use as core protocol |
|---|---|
| `/tui/append-prompt` | TUI-coupled |
| `/tui/submit-prompt` | TUI-coupled |
| `/tui/clear-prompt` | TUI-coupled |
| `/tui/control/*` | Internal control plane for TUI/plugin driving |

### 4. Busy/idle semantics in OpenCode

OpenCode maintains busy state **per session**, but `GET /session/status` returns the status of **all busy sessions on the instance**.

Implications:

- Multiple sessions under the same project can be `busy` simultaneously
- A bridge that relies on instance-wide status can be blocked by unrelated child/subagent activity
- `busy` is a useful observability signal, but not sufficient as the sole settlement truth for a remote shared-session product

## Product Split: petfish_remote vs petfish-bot

### `petfish_remote`

`petfish_remote` is **bridge-first**:

- primary value = desktop/mobile shared session continuity
- mobile and desktop should be peers of the same root session
- task-mode is secondary, not the primary user path

### `petfish-bot`

`petfish-bot` is **task-first**:

- primary value = mobile-only remote AI bot
- no desktop consistency requirement
- isolated task execution is acceptable and often preferable

This document focuses on `petfish_remote`.

## Proposed Architecture

## Core shift

Replace:

```text
cwd -> port -> latest-updated session -> /session/status
```

with:

```text
workspace -> explicit root session -> request-correlated lifecycle
```

The bridge may still discover an OpenCode instance by workspace, but it must not discover the active session by `latest updated` and must not settle requests using instance-wide busy as the final truth.

## Product Modes

### 1. Bridge Mode (primary for `petfish_remote`)

Bridge Mode means the mobile client is attached to a specific **live root session**.

Properties:

- desktop and mobile share one root session
- both receive output from the same session truth
- child/subagent sessions are attributed to the root session, not treated as new routing anchors
- mobile can prompt, abort, answer permission, answer question, detach, or switch session

### 2. Task Mode (secondary)

Task Mode means the mobile client starts isolated background work that does not attach to the live root session.

Properties:

- no shared-TUI semantics
- useful for side work, experiments, and low-risk background requests
- especially relevant to `petfish-bot`

## Object Model

### Workspace

Represents a remotely controllable project.

Fields:

- `workspace_id`
- `directory`
- `project_id`
- `instance_endpoint`
- `connector_id`

### Root Session

Represents the shared session for desktop/mobile continuity.

Fields:

- `session_id`
- `workspace_id`
- `mode` (`bridge` or `task`)
- `title`
- `parent_session_id?`
- `time_updated`

### Child Session

Represents subagent, fork, or descendant work under a root session.

Fields:

- `session_id`
- `root_session_id`
- `parent_session_id`
- `purpose` (`subagent`, `fork`, `background-task`, etc.)

### Attachment

Represents one client attached to one root session.

Fields:

- `client_id`
- `workspace_id`
- `root_session_id`
- `mode`
- `last_seen_message_id`
- `last_seen_fence`
- `attached_at`
- `detached_at?`

### Request Context

Represents one mobile-originated action against a root session.

Fields:

- `request_id`
- `client_id`
- `root_session_id`
- `origin_message_id`
- `status`
- `created_at`
- `completed_at?`

## Session Ownership Rules

### Rule 1: no latest-session routing

The bridge must never choose the active session by `time.updated` after the initial explicit bind.

### Rule 2: one chat/device attaches to one root session

A mobile client can only be attached to one root session per workspace at a time.

### Rule 3: child sessions do not become routing targets automatically

Child/subagent sessions may emit visible output and state updates, but they may not steal routing from the bound root session.

### Rule 4: busy is root-scoped for UX, request-scoped for settlement

Instance-wide `/session/status` is not allowed to act as the sole settlement truth.

## Protocol Design

### Attach

```text
attach(workspace_id, root_session_id, client_id)
```

Effects:

- persist an explicit client → root session binding
- subscribe client to root session event stream
- load session messages and checkpoint state

### Detach

```text
detach(client_id, root_session_id)
```

Effects:

- remove this client's attachment
- preserve the live root session
- preserve other attached clients

### Switch

```text
switch(client_id, workspace_id, target_root_session_id)
```

Effects:

- detach from current root session
- attach to target root session
- replay recent state from checkpoint

### Prompt

In Bridge Mode, mobile-originated prompts should use:

```text
POST /session/:id/prompt_async
```

not `/tui/*` injection.

### Observe

Use:

```text
GET /event
```

and consume at least:

- `part.delta`
- `message.updated`
- `session.updated`
- `permission.asked`
- `question.asked`

### Recover

On reconnect:

1. read `GET /session/:id/message`
2. compare to `last_seen_message_id`
3. reconcile fence/checkpoint
4. re-subscribe SSE

## Request Lifecycle

For each mobile-originated request, the bridge must maintain its own request state machine:

```text
submitted -> accepted -> running -> awaiting_permission/question -> completed | failed | aborted | disconnected
```

### Important rule

`/session/status` is an observability hint, not the only settlement truth.

Settlement should be correlated to the request's own message/event lifecycle, not to the existence of any busy session on the same instance.

## Subagent / Child Session Semantics

Child sessions are first-class OpenCode objects and should be surfaced intentionally, but they must be **subordinate** to the root-session binding.

### Allowed

- show child sessions in UI
- attribute child work to the root session
- allow explicit switch/fork to a child-derived branch

### Forbidden

- let child sessions auto-steal routing
- let child busy state block root-session completion forever
- let child sessions become implicit bridge targets due to `latest updated`

## Busy/Idle Semantics

### Current broken semantics

- pending request exists
- assistant completion signal arrives
- bridge waits 8s
- bridge polls `/session/status`
- if instance still reports busy, settlement is deferred forever

### Proposed semantics

Bridge Mode should use three signals together:

1. request-correlated message updates
2. request-correlated terminal event or inferred completion boundary
3. root-session busy/idle as a secondary health hint

This allows the bridge to say:

- “the workspace is still doing something”
- without incorrectly concluding
- “this request is not allowed to settle”

## User Experience Model

Complex session control is necessary, but IM users should not be forced to express it as free text.

### Required interaction objects

- **Current Session**
- **Background Tasks**
- **Branches / Experiments**

### Required user actions

- Continue
- Switch
- Fork
- New session
- Abort current run
- Detach mobile
- View children

### Recommended IM interaction style

Use:

- buttons
- cards
- links
- inline actions

Avoid relying on free-text commands for:

- delete session
- switch to ambiguous session
- detach/reattach semantics
- fork from a specific point

## Session Operations

### Required in v1

- `switch`
- `fork`
- `new`
- `abort`
- `detach`

### Defer / constrain

- `delete`

`delete` should not be a primary IM action. Prefer:

- archive
- hide
- inactive

and reserve hard delete for explicit, confirmed flows.

## Recommended OpenCode Deployment Model

For `petfish_remote`, prefer:

```bash
opencode serve --hostname 0.0.0.0 --port 4096 --mdns
```

Why:

- headless server mode is explicitly supported
- avoids TUI-coupled control as the core product path
- makes desktop/mobile both clients of the same server/session layer
- better matches a desktop-first/mobile-attached product model

The desktop TUI may still exist, but it should be treated as one client of the server, not the substrate the mobile client must remote-control.

## Migration Plan

### Phase 1 — Correctness

1. Introduce explicit root-session binding
2. Remove latest-session drift from normal routing
3. Stop using `/tui/*` as the primary bridge path for `petfish_remote`

### Phase 2 — Session Protocol

1. Add attach / detach / switch semantics
2. Add request-correlated request state machine
3. Add checkpoint/fence tracking

### Phase 3 — Child Session Attribution

1. Surface `/session/:id/children`
2. Attribute child output to the root session
3. Prevent child sessions from stealing attachment

### Phase 4 — IM UX

1. Session cards
2. Busy-state actions
3. Fork/new/switch flows
4. Background-task entry points

### Phase 5 — petfish-bot divergence

Define `petfish-bot` as task-first and simplify its architecture around isolated task execution.

## Implementation Notes

### What should remain shared between `petfish_remote` and `petfish-bot`

- connector protocol transport
- authentication model
- project/workspace registry concepts
- permission/question relay patterns

### What should diverge

- default mode
- session binding model
- settlement semantics
- user interaction model

## Risks

1. **OpenCode event semantics may still require empirical validation**
   - especially around exact completion boundaries for async prompt workflows

2. **Bridge/task dual-mode increases product complexity**
   - mode clarity must be visible to users

3. **Checkpoint design must avoid duplicate or missing output**
   - especially across reconnects

4. **Desktop client parity may still require follow-up work**
   - TUI and mobile must converge on the same root-session semantics

## Open Questions

1. Should `petfish_remote` expose explicit mode switching to users, or infer it from context?
2. What is the exact request-correlated completion rule for `prompt_async` + SSE in practice?
3. Should child sessions be visible by default in the mobile UI, or only when a user opens a branch/session browser?
4. Should `petfish_remote` run against a dedicated `opencode serve` instance even when the desktop user also uses the TUI locally?
5. What is the minimum checkpoint model required to safely resume after mobile reconnect?

## Summary

The correct long-term design is not to remove bridge mode from `petfish_remote`, but to replace the current **TUI-bridge** with a **session-bridge** built on OpenCode's stable server/session/event interfaces.

That preserves the core product promise — desktop/mobile free switching with shared context — while removing the structural failure modes caused by `cwd -> latest session -> global busy -> TUI injection` routing.
