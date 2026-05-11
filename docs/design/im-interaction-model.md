# Design: IM Interaction Model for Shared Session Remote Control

> Status: **Proposed** | Branch: `dev` | Priority: **P0** | Complexity: **Medium**

## Problem

`petfish_remote` is not just an IM bot. It is a desktop/mobile shared workspace product.

That means the IM layer cannot be designed as a thin text transport only. It must express:

- the current live session
- background work
- forks/branches/experiments
- attach/detach and switch semantics
- permission/question relay
- busy-state decisions

If these controls are exposed only through free-text commands, the user experience becomes ambiguous and brittle.

Typical examples:

- "switch to the previous fork"
- "create a new session but keep current work intact"
- "detach mobile from current live session"
- "send this as a background task instead of interrupting the desktop session"

These operations are real product needs, but they are too stateful to rely on natural-language parsing alone.

## Design Goal

Define an IM interaction model for `petfish_remote` that:

1. preserves shared-session consistency
2. makes session ownership visible
3. provides safe controls for switch/fork/new/detach/abort
4. minimizes ambiguity for mobile users
5. supports both Bridge Mode and Task Mode

## Non-Goals

- Replacing all text input with buttons
- Designing full desktop UI behavior
- Defining low-level connector protocol in this document
- Solving session settlement semantics here (covered by shared-session architecture)

## Product Assumptions

This document assumes the architecture proposed in:

- [`shared-session-architecture.md`](./shared-session-architecture.md)

In particular:

- `petfish_remote` is **bridge-first**
- the mobile client attaches to an explicit root session
- background tasks are a separate product mode
- child sessions/forks are visible but do not steal routing automatically

## Core Interaction Objects

The IM product model should not expose raw queues first. It should expose user-meaningful objects.

### 1. Current Session

The root live session currently attached to the mobile client.

This is the user's primary working thread.

Attributes:

- session title
- current status
- last update time
- current mode
- whether desktop is also attached

### 2. Background Tasks

Isolated work that should not interrupt the current live session.

Typical examples:

- summarize something
- inspect logs
- search docs
- prepare options
- run a branch-safe experiment

### 3. Branches / Experiments

Alternative lines derived from a live session.

Typical examples:

- fork current session
- retry from a stable point
- run a rescue flow
- try a different implementation without contaminating main

## Product Modes

### Bridge Mode

Bridge Mode means the IM client is attached to a live root session.

Properties:

- messages affect the live session
- output reflects the same session desktop sees
- suitable for active collaborative control

### Task Mode

Task Mode means the IM client starts isolated background work.

Properties:

- work is not attached to the live session
- safe for side work and parallel exploration
- suitable for mobile-first lightweight operations

## Interaction Principles

### Principle 1: free text for content, buttons for control

Natural language is appropriate for:

- prompts
- questions
- clarifications
- background task instructions

Buttons/cards/links are appropriate for:

- switch
- fork
- new session
- detach
- abort
- archive
- choose target session

### Principle 2: current session must always be visible

The IM client should never leave the user guessing:

- which workspace is active
- which root session is attached
- whether they are in Bridge Mode or Task Mode
- whether the current run is blocking, waiting, or idle

### Principle 3: busy is not a dead end

When the current session is busy, the user should not just see a generic busy message.

They should be offered explicit next actions.

### Principle 4: destructive actions require indirection

Deletion, detach, session switch, and branch promotion should use explicit UI affordances and confirmation, not plain text.

## Required IM Surfaces

### 1. Current Session Card

Shown when the user enters a workspace or requests status.

Suggested content:

- workspace name
- root session title
- mode: Bridge / Task
- session status: idle / running / waiting permission / waiting question / disconnected
- last update

Suggested actions:

- Continue
- Switch
- Fork
- New
- Abort
- Detach mobile
- View branches
- Background task

### 2. Busy-State Card

Shown when the current root session is active and the user attempts to send a new instruction.

Instead of only saying "busy", present options.

Suggested actions:

- Wait
- View current progress
- Abort current run
- Send as background task
- Fork from current state
- Switch session

### 3. Session List Card

Used for switch operations.

Each item should show:

- title
- last updated time
- role (`main`, `fork`, `background`, `child`)
- status (`idle`, `busy`, `needs input`)

Suggested actions per session:

- Resume / Switch here
- Fork
- View details
- Archive

### 4. Branch Card

Used for forks/experiments.

Suggested actions:

- Resume branch
- Compare with current session
- Promote to primary
- Archive

### 5. Background Task Card

Used for isolated work.

Suggested actions:

- Watch progress
- Promote to session
- Fork into branch
- Discard

## Session Operations

### Required in v1

- `switch`
- `fork`
- `new`
- `abort`
- `detach`
- `background task`

### Defer or constrain

- `delete`

Hard delete is too dangerous as a primary IM action. Prefer:

- archive
- hide
- inactive

Delete can exist behind explicit confirmation later.

## Recommended User Flows

## Flow A: Continue current live session

1. User opens workspace
2. Current Session Card appears
3. User sends free-text prompt or taps `Continue`
4. Prompt is delivered to bound root session
5. Output streams back to IM

## Flow B: Current session is busy

1. User sends a new request while root session is running
2. Busy-State Card appears
3. User chooses one of:
   - wait
   - background task
   - abort
   - fork
   - switch

This is better than unconditional queuing because it preserves user agency.

## Flow C: Fork current session

1. User opens Current Session Card
2. User taps `Fork`
3. System creates a branch/fork session
4. User is asked whether to:
   - stay on current session
   - switch to new branch
   - run branch in background

## Flow D: Start background task

1. User taps `Background task`
2. User enters prompt
3. Task runs without attaching to current live root session
4. IM shows Background Task Card with status and actions

## Flow E: Switch session

1. User taps `Switch`
2. Session List Card appears
3. User selects target session
4. System reattaches mobile to chosen root session
5. Recent messages and status are replayed

## Permission and Question UX

These flows should remain button-driven.

### Permission

Show:

- tool name
- short summary of requested action
- context (cwd, command, reason if available)

Actions:

- Allow once
- Always allow
- Deny

### Question

Show:

- question text
- provided options
- optional custom answer hint

Actions:

- choose an option
- confirm selection
- reply with custom text if supported

## Conversation Semantics

### Free text should map by context

When the user sends text, the system should decide among:

1. continue current Bridge Mode session
2. answer a pending permission/question
3. create a Background Task
4. reject with a context card if ambiguity is high

The system should avoid silently reinterpreting a control operation as content input.

### Control operations should not rely on NLP alone

Examples that should use cards/buttons, not only text parsing:

- switch to another session
- detach mobile
- fork from specific branch
- archive/delete

## Multiple Work Queues

### Product conclusion

The system does need multiple logical work queues, but the IM product should not expose them first as low-level queues.

Instead, expose three user-facing lanes:

- **Current Session**
- **Background Tasks**
- **Branches / Experiments**

This preserves product clarity while still giving the system enough scheduling structure internally.

## Suggested Internal Scheduling Model

### Live lane

- one active root session per attachment
- serial control semantics
- preserves consistency with desktop

### Background lane

- isolated tasks
- no interference with live root session

### Branch lane

- derived from existing sessions
- can later become primary

## Safety Rules

1. A mobile client must always know its current mode.
2. A busy live session must not trap the user in a dead-end response.
3. Child sessions must never auto-steal the IM attachment.
4. Background tasks must not silently mutate the live root session.
5. Delete must never be a one-tap action.

## Minimal v1 UX Contract

For v1, `petfish_remote` should guarantee:

1. visible current session card
2. explicit busy-state actions
3. switch/fork/new/background task actions
4. permission/question relay
5. detach mobile

If these five surfaces are missing, the shared-session model will remain too opaque for IM users.

## Risks

1. Too many actions in one card can overwhelm users.
2. Hidden mode changes can break trust.
3. Branch and background task concepts may blur without strong labels.
4. If checkpoint/replay is weak, switch flows will feel inconsistent.

## Open Questions

1. Should mode switching be explicit in the UI, or derived from user intent with confirmation?
2. Should child sessions be visible by default or only in an "Advanced" browser?
3. Should background tasks be attached to the workspace globally or per chat/client?
4. Should branch promotion be a v1 feature or deferred?
5. What is the smallest card/button set that preserves clarity without overwhelming Telegram/Feishu users?

## Summary

The IM layer for `petfish_remote` should not be treated as a thin chat shell. It is a control surface for a shared session system.

That means the product must expose session ownership, busy-state choices, branch/background distinctions, and attach/detach semantics through cards, buttons, and explicit flows — while reserving free text for actual work content.
