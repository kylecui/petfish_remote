# opencode Integration

## Runner Types

### CLI Runner (V0.1)

Invokes `opencode run "<prompt>"` via child_process through the RuntimeConnector.

Pros: Fastest to implement, easy to debug.
Cons: Weak session management, limited event streaming.

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
