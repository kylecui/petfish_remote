# opencode Integration

## Related Design Docs

- [Shared Session Architecture](./design/shared-session-architecture.md)
- [IM Interaction Model](./design/im-interaction-model.md)

## Runner Types

### CLI Runner (V0.1)

Invokes `opencode run "<prompt>"` via child_process through the RuntimeConnector.

Pros: Fastest to implement, easy to debug.
Cons: Weak session management, limited event streaming.

### Server/Session Runner (target for petfish_remote)

Use OpenCode's documented server/session/event interfaces (`opencode serve`, session APIs, SSE stream) as the primary bridge surface.

Pros: explicit session identity, event streaming, permission/question integration, better fit for desktop/mobile shared-session consistency.
Cons: requires a stronger session protocol than the current CLI/TUI-coupled path.

### SDK Runner (V0.3+)

Uses `@opencode-ai/sdk` for session reuse, event streaming, and structured results.

### Plugin Runner (V0.5+)

`opencode-petfish-plugin` runs inside opencode to intercept events, report progress, and enforce policies.

## Prompt Construction

All prompts are constructed by `PromptBuilder` with:
- Project name and path
- Execution mode with explicit allow/deny rules
- User instruction
- AGENTS.md reading requirement
- Mobile-friendly output format requirement

## Session Management

opencode sessions are tracked per chat-project binding. The SessionManager stores the opencode session ID to enable conversation continuity.

For `petfish_remote`, this needs to become **explicit root-session binding** rather than "latest updated session" discovery. Child/subagent sessions should be treated as descendants of a bound root session, not as routing targets.
