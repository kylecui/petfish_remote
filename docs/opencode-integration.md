> ⚠️ **Historical document** — Written during V0.1. The runner evolution is now complete: CLI Runner (V0.1) → SDK Runner (V0.2) → Plugin Runner (V0.4). See [Architecture](./architecture.md) for the current integration design.

# opencode Integration

## Related Design Docs

- [Shared Session Architecture](./design/shared-session-architecture.md)
- [IM Interaction Model](./design/im-interaction-model.md)

## Runner Types (Historical Evolution)

### CLI Runner (V0.1) — Retired

Invoked `opencode run "<prompt>"` via child_process through the RuntimeConnector. Retired in V0.2 in favor of the SDK Runner.

### SDK Runner (V0.2–V0.3) — Current Default

Uses `@opencode-ai/sdk` for session reuse, event streaming, structured results, question/permission handling, and sub-agent tracking.

### Plugin Runner (V0.4) — Current

`opencode-petfish-plugin` is a Bun plugin that runs inside opencode. It intercepts tool calls, auto-handles permission requests, injects PetFish context, and reports progress back to the connector. Implemented in P4h.

## Prompt Construction

All prompts are constructed by `PromptBuilder` with:
- Project name and path
- Execution mode with explicit allow/deny rules
- User instruction
- AGENTS.md reading requirement
- Mobile-friendly output format requirement

## Session Management

opencode sessions are tracked per chat-project binding. The SessionManager stores the opencode session ID to enable conversation continuity.

Root-session binding was implemented in STAB-2 (V0.2). Child/sub-agent sessions are tracked as descendants of a bound root session via the Sub-Agent Tracker (P4f), with configurable verbosity (`silent`/`summary`/`verbose`).
