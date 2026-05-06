# Design: Multi-Agent Support (Google Gemini CLI + OpenAI Codex CLI)

> Status: **Proposed** | Branch: `dev` | Priority: **P0**

## Research Summary

### Current State

SessionBridge is 100% coupled to opencode's API:
- HTTP endpoints: `/session/status`, `/tui/*`, `/event`, `/question/*`, `/permission/*`
- SSE events: `message.updated`, `message.part.updated`, `session.idle`, `session.status`, `question.asked`, `permission.asked`
- TUI injection: `/tui/clear-prompt`, `/tui/append-prompt`, `/tui/submit-prompt`
- Environment: `OPENCODE_PID`, `OPENCODE_SESSION_ID`
- No abstraction layer exists

### Google Gemini CLI

| | Details |
|---|---|
| **Repo** | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) · 103K⭐ · TypeScript |
| **Install** | `npm install -g @google/gemini-cli` |
| **Headless** | `gemini -p "instruction" --output-format stream-json` → JSONL events |
| **Protocol** | ACP (Agent Client Protocol) — JSON-RPC over stdio, same as VS Code extension |
| **HTTP Server** | `a2a-server` package (experimental) — REST + SSE |
| **Session** | ACP: `newSession` / `loadSession` RPCs |
| **Permission** | ACP: `requestPermission` callback |
| **MCP** | Full MCP client support (`~/.gemini/settings.json`) |
| **Project File** | `GEMINI.md` |

**Stream JSON events:**
```jsonl
{"type":"init","session_id":"...","model":"..."}
{"type":"message","role":"assistant","content":"...","delta":"..."}
{"type":"tool_use","tool_name":"...","parameters":{...}}
{"type":"tool_result","tool_id":"...","status":"success","output":"..."}
{"type":"result","status":"success","stats":{...}}
```

### OpenAI Codex CLI

| | Details |
|---|---|
| **Repo** | [openai/codex](https://github.com/openai/codex) · 80K⭐ · Rust + TypeScript |
| **Install** | `npm install -g @openai/codex` |
| **Headless** | `codex exec --json "instruction"` → JSONL events |
| **Protocol** | `app-server` JSON-RPC over stdio or WebSocket (`ws://127.0.0.1:PORT`) |
| **HTTP Server** | `codex app-server --listen ws://127.0.0.1:PORT` |
| **Session** | Thread-based: `thread/start`, `thread/resume` |
| **Permission** | `ExecCommandApprovalParams` → `ExecCommandApprovalResponse` (approve/deny/always) |
| **MCP** | Full MCP server + client support |
| **Project File** | `.codex/instructions.md` |

**Key JSON-RPC methods:**
```
initialize → thread/start → turn/start → [stream events] → turn/completed
```

**Stream events:**
```jsonl
{"type":"thread.started","thread_id":"..."}
{"type":"item.started","item":{"type":"command_execution","command":"..."}}
{"type":"item.completed","item":{"type":"agent_message","text":"..."}}
{"type":"turn.completed","usage":{"input_tokens":...}}
```

**Approval protocol:**
```rust
ExecCommandApprovalParams { conversation_id, call_id, command, cwd, reason }
→ ExecCommandApprovalResponse { decision: approve | deny | always_approve }
```

## Architecture Design

### Agent Bridge Interface

```typescript
export interface AgentBridge {
  readonly agentType: 'opencode' | 'gemini' | 'codex';

  init(): Promise<void>;
  stop(): void;

  prompt(
    taskId: string,
    instruction: string,
    onOutput: OutputCallback,
    onComplete: CompleteCallback,
    onFail: FailCallback,
  ): boolean;

  cancel(taskId: string): void;
  requestNewSession(): Promise<void>;

  setQuestionCallback(cb: QuestionCallback): void;
  setPermissionCallback(cb: PermissionCallback): void;
  answerQuestion(questionId: string, answers: string[][]): void;
  answerPermission(permissionId: string, allowed: boolean): void;
}
```

### Bridge Implementations

```
src/connector/bridges/
├── AgentBridge.ts          ← interface + factory
├── OpenCodeBridge.ts       ← current SessionBridge refactored
├── GeminiBridge.ts         ← Gemini CLI integration
└── CodexBridge.ts          ← Codex CLI integration
```

### Detection & Selection

Each bridge detects its agent via environment/process signals:

| Agent | Detection | Config |
|-------|-----------|--------|
| opencode | `OPENCODE_PID` + `OPENCODE_SESSION_ID` env vars | Existing |
| Gemini CLI | `GEMINI_CLI_PID` env var OR `gemini` in process tree | New |
| Codex CLI | `CODEX_PID` env var OR `codex app-server` running | New |

Connector config adds `agent` field:
```yaml
projects:
  - id: my-project
    path: /home/user/project
    agent: auto  # auto-detect | opencode | gemini | codex
```

### Integration Approach per Agent

#### OpenCode (existing)

No change to protocol — refactor `SessionBridge` → `OpenCodeBridge` implementing `AgentBridge`.

#### Gemini CLI

**Tier 1 (MVP):** Spawn `gemini -p "instruction" --output-format stream-json` per prompt.
- Parse JSONL events → map to `onOutput` callbacks
- `type: "result"` → `onComplete`
- No persistent session (each prompt is a new spawn)
- No permission relay (gemini `-p` auto-approves in headless)

**Tier 2 (Full):** ACP stdio transport.
- Spawn `gemini` with ACP mode → JSON-RPC over stdin/stdout
- `newSession` → persistent session
- `sendPrompt` → inject instruction
- `requestPermission` callback → relay to Telegram
- `message` events → stream to Telegram

#### Codex CLI

**Tier 1 (MVP):** Spawn `codex exec --json "instruction"` per prompt.
- Parse JSONL events → map to `onOutput` callbacks
- `turn.completed` → `onComplete`
- No persistent session

**Tier 2 (Full):** `app-server` JSON-RPC.
- Spawn `codex app-server --listen stdio://` → JSON-RPC over stdin/stdout
- `thread/start` → create session
- `turn/start` → inject instruction
- `ExecCommandApprovalParams` → relay to Telegram
- `item/agentMessage/delta` → stream to Telegram
- `thread/resume` → session continuity

## Implementation Plan

### Phase 1: Refactor (foundation)

1. Extract `AgentBridge` interface from `SessionBridge`
2. Rename `SessionBridge` → `OpenCodeBridge`, implement interface
3. Add `BridgeFactory` in connector `main.ts` — select bridge by config/env
4. Update `ConnectorClient` to use `AgentBridge` instead of `SessionBridge`
5. Verify all existing tests pass (zero behavior change)

### Phase 2: Gemini CLI (Tier 1)

1. Implement `GeminiBridge` — spawn `gemini -p ... --output-format stream-json`
2. Map JSONL events to `OutputCallback`/`CompleteCallback`
3. Handle `tool_use`/`tool_result` events (show in output stream)
4. Test with `GEMINI_API_KEY` env var
5. Add to connector.yaml schema: `agent: gemini`

### Phase 3: Codex CLI (Tier 1)

1. Implement `CodexBridge` — spawn `codex exec --json "..."`
2. Map JSONL events to callbacks
3. Handle `item.started`/`item.completed` events
4. Test with `OPENAI_API_KEY` env var
5. Add to connector.yaml schema: `agent: codex`

### Phase 4: Full ACP/app-server (Tier 2)

1. `GeminiBridge` Tier 2 — ACP stdio transport, persistent sessions, permission relay
2. `CodexBridge` Tier 2 — app-server JSON-RPC, thread resume, approval relay
3. Unified permission/question format mapping across all three agents

## Event Mapping

| Concept | opencode | Gemini CLI | Codex CLI |
|---------|----------|------------|-----------|
| **Text output** | `message.part.updated` (delta) | `{"type":"message","delta":"..."}` | `{"type":"item.completed","item":{"type":"agent_message"}}` |
| **Session idle** | `session.idle` SSE | `{"type":"result"}` (turn done) | `{"type":"turn.completed"}` |
| **Session busy** | `session.status` type=busy | Process running | Turn in progress |
| **Question** | `question.asked` SSE | Not in headless; ACP `requestInput` | Not in exec; app-server custom event |
| **Permission** | `permission.asked` SSE | ACP `requestPermission` | `ExecCommandApprovalParams` notification |
| **Answer question** | `POST /question/:id/reply` | ACP response | JSON-RPC response |
| **Answer permission** | `POST /permission/:id/reply` | ACP response | `ExecCommandApprovalResponse` |

## Open Questions

1. Should Tier 1 (spawn per prompt) share session state across prompts? (Gemini/Codex have resume capabilities)
2. Should we support running multiple agent types simultaneously on one connector? (e.g., project A uses opencode, project B uses gemini)
3. How to handle API key management? Per-project or per-connector?
4. Priority: Gemini first or Codex first?

## Estimated Effort

| Phase | Lines | Time |
|-------|-------|------|
| Phase 1 (refactor) | ~200 refactor | 1 session |
| Phase 2 (Gemini Tier 1) | ~150 new | 1 session |
| Phase 3 (Codex Tier 1) | ~150 new | 1 session |
| Phase 4 (Tier 2 both) | ~400 new | 2-3 sessions |
