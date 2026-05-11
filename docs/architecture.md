# Architecture

PetFish Remote is a layered system with clear separation between control plane (chat) and execution plane (opencode).

## Related Design Docs

- [Shared Session Architecture](./design/shared-session-architecture.md)
- [IM Interaction Model](./design/im-interaction-model.md)
- [Question & Permission Relay](./design/question-permission-relay.md)
- [Multi-Agent Support](./design/multi-agent-support.md)

## Layers

### Chat Adapter Layer
Handles platform-specific message ingestion and response delivery. Converts platform messages to unified `ChatEvent` format.

Supported: Telegram (MVP), Slack, Feishu, WeCom, Discord (planned).

### Command Router Layer
Parses both explicit `/pf` commands and natural language input into structured task requests. Infers execution mode from language cues.

### Project Registry Layer
Manages the allowlist of remotely controllable projects. Each project binds to a runtime, has allowed users, test commands, and a risk profile.

### Session Manager Layer
Tracks chat-to-project bindings and active root sessions. Prevents cross-project context pollution and, in Bridge Mode, is responsible for explicit session ownership rather than latest-session discovery.

### Task Manager Layer
Creates, schedules, and tracks tasks through the state machine: created → queued → running → completed/failed/cancelled.

### Policy Engine Layer
Evaluates actions against allow/deny/require_approval rules. Supports profile inheritance (e.g., `kernel-ebpf` extends `default`).

### Approval Manager Layer
Creates approval requests for risky operations, delivers them via chat, and processes `/pf approve` / `/pf deny` responses.

### Runtime Router + Connector Layer
Routes task execution to the correct environment (local, WSL, SSH, Docker, opencode server). Each runtime implements a unified `RuntimeConnector` interface.

### OpenCode Runner Layer
Constructs controlled prompts and invokes opencode through the RuntimeConnector. In the long-term `petfish_remote` design, this layer should evolve from TUI-coupled prompt injection toward session-oriented control using OpenCode server/session/event interfaces.

### Storage Layer
SQLite-backed persistence for users, sessions, tasks, approvals, and audit logs.

### Render Layer
Formats structured data into mobile-friendly chat messages: task status, diffs, approval requests, test results.
