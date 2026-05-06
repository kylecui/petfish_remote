# Design: Question & Permission Relay

> Status: **Proposed** | Priority: **P0** | Complexity: **Medium**

## Problem

When the opencode AI agent calls the `question` tool (to ask the user for clarification) or triggers a `permission.asked` event (to get approval for a command), PetFish Remote ignores these events entirely. The user sees nothing in Telegram, the session stays `busy` indefinitely, and the task hits the 5-minute safety timeout.

### Root Cause

`SessionBridge.handleSSEEvent()` only handles 4 event types:
- `message.updated`
- `message.part.updated`
- `session.idle`
- `session.status`

The `question.asked` and `permission.asked` events are silently dropped.

Additionally, `handlePartUpdated()` filters `part.type !== 'text'` (line 436), so even if the question content appears as a tool-use part, it would be discarded.

## opencode's Question/Permission API

### SSE Events

| Event | Payload | Meaning |
|-------|---------|---------|
| `question.asked` | `{ id, sessionID, questions: [{question, header, options: [{label, description}], multiple, custom}], tool }` | Agent is blocked waiting for user input |
| `question.replied` | `{ id, answers }` | User answered (from any client) |
| `question.rejected` | `{ id }` | User dismissed |
| `permission.asked` | `{ id, sessionID, tool, input }` | Agent needs permission to run a command |
| `permission.replied` | `{ id, allowed }` | User allowed/denied |

### REST Endpoints

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| `GET` | `/question` | — | List all pending questions |
| `POST` | `/question/:requestID/reply` | `{ answers: string[][] }` | Answer a question |
| `POST` | `/question/:requestID/reject` | — | Dismiss a question |
| `GET` | `/permission` | — | List all pending permissions |
| `POST` | `/permission/:requestID/reply` | `{ allowed: boolean }` | Grant/deny permission |

### Session Behavior During Question

- Session status stays **`busy`** (NOT idle) — the agent is blocked on an Effect Deferred
- `session.idle` does NOT fire until the question is answered and the agent completes
- Output streaming (`message.part.updated`) may still deliver text content that preceded the question call

## Proposed Design

### Architecture

```
opencode (SSE: question.asked)
    ↓
SessionBridge (new handler)
    ↓ new callback: onQuestion(taskId, questionPayload)
ConnectorClient
    ↓ new protocol msg: TASK_QUESTION
WebSocket
    ↓
ConnectorGateway → emits 'task:question'
    ↓
RemoteRuntime → callback
    ↓
main.ts → TelegramAdapter.sendQuestion()
    ↓ InlineKeyboard with options
Telegram User (taps button)
    ↓
TelegramAdapter callback_query handler
    ↓
main.ts → ConnectorGateway.sendQuestionReply()
    ↓ new protocol msg: QUESTION_REPLY
WebSocket
    ↓
ConnectorClient → SessionBridge.answerQuestion()
    ↓ POST /question/:id/reply
opencode (Deferred resolves, agent continues)
```

### New Protocol Messages

```typescript
// Connector → Server
export const MSG_TASK_QUESTION = 'task:question';
export interface TaskQuestionPayload {
  taskId: string;
  questionId: string;          // opencode's question request ID
  sessionId: string;
  questions: Array<{
    question: string;          // full question text
    header: string;            // short label (max 30 chars)
    options: Array<{ label: string; description: string }>;
    multiple: boolean;         // multi-select allowed
    custom: boolean;           // free-text allowed
  }>;
}

// Server → Connector
export const MSG_QUESTION_REPLY = 'question:reply';
export interface QuestionReplyPayload {
  taskId: string;
  questionId: string;
  answers: string[][];         // one array per question, each containing selected option labels
}

// Same pattern for permissions:
export const MSG_TASK_PERMISSION = 'task:permission';
export interface TaskPermissionPayload {
  taskId: string;
  permissionId: string;
  sessionId: string;
  tool: string;
  input: Record<string, unknown>;
}

export const MSG_PERMISSION_REPLY = 'permission:reply';
export interface PermissionReplyPayload {
  taskId: string;
  permissionId: string;
  allowed: boolean;
}
```

### Changes by Component

#### 1. SessionBridge.ts

```typescript
// New callback type
export type QuestionCallback = (taskId: string, payload: TaskQuestionPayload) => void;
export type PermissionCallback = (taskId: string, payload: TaskPermissionPayload) => void;

// Add to handleSSEEvent():
} else if (event.type === 'question.asked') {
  this.handleQuestionAsked(event.properties);
} else if (event.type === 'permission.asked') {
  this.handlePermissionAsked(event.properties);
}

// New method:
private handleQuestionAsked(props): void {
  // Find active task for this session
  // Cancel settle timer (session won't go idle until answered)
  // Call onQuestion callback with formatted payload
}

// New public method:
public answerQuestion(questionId: string, answers: string[][]): void {
  // POST /question/:questionId/reply { answers }
}

public answerPermission(permissionId: string, allowed: boolean): void {
  // POST /permission/:permissionId/reply { allowed }
}
```

#### 2. ConnectorClient.ts

- Add `onQuestion` and `onPermission` callbacks to task handling
- Send `TASK_QUESTION` / `TASK_PERMISSION` envelopes to server
- Handle incoming `QUESTION_REPLY` / `PERMISSION_REPLY` messages → call SessionBridge methods

#### 3. connectorProtocol.ts

- Add new message types and payload schemas (as defined above)

#### 4. ConnectorGateway.ts

- Handle incoming `TASK_QUESTION` / `TASK_PERMISSION` from connectors
- Emit events: `task:question`, `task:permission`
- Handle outgoing `QUESTION_REPLY` / `PERMISSION_REPLY` → route to correct connector

#### 5. main.ts (server)

- Listen for `task:question` events
- Format and send to Telegram via adapter
- Handle callback_query responses → route back to gateway

#### 6. TelegramAdapter.ts

- New method: `sendQuestion(chatId, taskId, questionPayload)` → render as InlineKeyboard
  - Each option = one button
  - If `custom` is true, add "Type your own answer" text hint
  - If `multiple` is true, use toggle-style buttons with checkmarks
- New callback_query handler: parse question answer → invoke reply callback

### Telegram UX

**Single-select question:**
```
🤔 Agent is asking:

[Header] Question text here?

[Option A] [Option B] [Option C]
```

**Multi-select question:**
```
🤔 Agent is asking:

[Header] Question text here? (select multiple, then confirm)

[☐ Option A] [☐ Option B]
[☐ Option C] [☐ Option D]
[✅ Confirm]
```

**Custom text input:**
```
🤔 Agent is asking:

[Header] Question text here?

[Option A] [Option B] [Option C]

💬 Or reply with your own answer.
```
(If user sends a text message while question is pending → treat as custom answer)

**Permission request:**
```
🔐 Agent wants to run:

`tool_name`: description of what it does

[✅ Allow] [❌ Deny]
```

### Edge Cases

1. **Multiple questions in one `question.asked`** — The `questions` array can contain multiple items. Render them sequentially or as a single message with multiple InlineKeyboards.

2. **Question timeout** — If user doesn't respond within X minutes, should we auto-reject? Or let the 5-min safety timeout handle it? Recommend: keep the question open until the safety timeout fires, then reject it.

3. **User sends regular text while question pending** — If `custom` is enabled, treat as custom answer. If not, warn user "Please answer the pending question first" or queue the message.

4. **Concurrent questions** — Unlikely but possible. Stack them — answer one at a time.

5. **Reconnection** — If connector disconnects and reconnects while a question is pending, check `GET /question` for any pending questions on reconnect.

6. **Race with session.idle** — By design, `session.idle` cannot fire while a question is pending (session stays `busy`). No race condition.

## Implementation Order

1. **Protocol** — Add message types to `connectorProtocol.ts`
2. **SessionBridge** — Handle `question.asked` + `answerQuestion()` method
3. **ConnectorClient** — Wire up TASK_QUESTION send + QUESTION_REPLY receive
4. **ConnectorGateway** — Route question/reply messages
5. **TelegramAdapter** — Render questions + handle callback_query
6. **main.ts** — Wire the full flow
7. **Permission** — Repeat for `permission.asked` (same pattern)
8. **Tests** — Unit tests for new message handling

## Estimated Effort

~300-400 lines of new code across 6 files. No architectural changes — extends existing patterns.

## Open Questions

1. Should we support `multiple: true` (multi-select) in v1, or defer to v2?
2. Should permission requests auto-deny after N minutes for security?
3. Should we show a "thinking..." indicator after answering a question (since agent resumes)?
