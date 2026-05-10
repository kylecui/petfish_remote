# API Reference

PetFish Remote exposes an HTTP API and a WebSocket protocol. The HTTP API is served by `ConnectorGateway`; the WebSocket protocol connects the Connector to the Bot Server.

## HTTP Endpoints

### `GET /`

Service info (public, no auth).

**Response** `200`:
```json
{ "service": "petfish-remote-ws", "version": "0.1.0", "connectors": 2 }
```

### `GET /api/version`

Server version.

**Response** `200`:
```json
{ "version": "0.1.0" }
```

### `GET /api/status`

Admin-only dashboard. Requires `ADMIN_API_KEY` env var on the server.

**Headers**: `x-admin-key: <ADMIN_API_KEY>`

**Response** `200`:
```json
{
  "version": "0.1.0",
  "uptime": 86400,
  "adapters": { "telegram": "running", "feishu": "running" },
  "connectors": [{ "connectorId": "...", "hostname": "...", "projects": [] }],
  "projects": [],
  "registeredUsers": [],
  "pendingReconnects": []
}
```

**Errors**: `503` if `ADMIN_API_KEY` not set, `401` if key mismatch.

### `POST /api/register`

Register a new connector. Called by the install script.

**Body**:
```json
{
  "token": "<setup-token>",
  "projectId": "my-project",
  "projectName": "My Project",
  "projectPath": "/home/user/my-project",
  "hostname": "devbox-1"
}
```

**Response** `200`:
```json
{ "connectorToken": "<generated-token>", ... }
```

**Errors**: `400` missing fields, `401` invalid token, `501` registration not enabled.

### `POST /api/add-platform`

Add an IM platform to an existing registration.

**Body**:
```json
{
  "registrationToken": "<registration-token>",
  "connectorToken": "<connector-token>",
  "projectId": "my-project"
}
```

**Response** `200`: platform added. **Errors**: `400`, `401`, `501`.

### `POST /webhook/card`

Feishu card action webhook. Handles `url_verification` challenge and card button callbacks.

**Response** `200`: action result JSON.

### `GET /install` or `GET /install.sh`

Serves the install script with `__PETFISH_SERVER_URL__` replaced by `PETFISH_SERVER_URL` env var. Falls back to GitHub raw URL if the local file is missing.

---

## WebSocket Protocol

The Connector connects to the Bot Server via WebSocket at the configured path (default `/ws`).

### Protocol Version

Current version: **1**. All envelopes carry `v: 1`.

### Envelope Format

Every message (both directions) is a JSON envelope:

```typescript
{
  v: 1,                    // protocol version
  type: string,            // message type (see below)
  id: string,              // unique message ID (msg_{timestamp}_{counter})
  ts: string,              // ISO 8601 timestamp
  taskId?: string,         // task correlation ID (optional)
  payload: Record<string, unknown>
}
```

### Message Types

#### Connector → Server

| Type | Payload | Description |
|------|---------|-------------|
| `register` | `{ connectorId, token, hostname, version?, projects[] }` | Authenticate and announce projects |
| `task.accepted` | `{ taskId }` | Connector accepted a task |
| `task.rejected` | `{ taskId, reason }` | Connector rejected a task |
| `task.output` | `{ taskId, stream, chunk }` | Streaming output (`stdout` or `stderr`) |
| `task.state` | `{ taskId, state }` | Task state change |
| `task.complete` | `{ taskId, exitCode, stdout, stderr, startedAt, finishedAt }` | Task finished |
| `task.fail` | `{ taskId, error }` | Task failed |
| `resume.running` | `{ taskIds[] }` | Report tasks still running after reconnect |
| `task.question` | `{ taskId, questionId, sessionId, questions[] }` | opencode question requiring user input |
| `question.reply` | `{ taskId, questionId, answers[][] }` | User's answer to a question |
| `task.permission` | `{ taskId, permissionId, sessionId, tool, input }` | Tool permission request |
| `permission.reply` | `{ taskId, permissionId, allowed }` | Permission grant/deny |

#### Server → Connector

| Type | Payload | Description |
|------|---------|-------------|
| `registered` | `{ connectorId, serverVersion }` | Registration acknowledged |
| `task.start` | `{ taskId, projectId, projectPath, instruction, mode, timeoutSeconds, env? }` | Start a task |
| `task.control` | `{ taskId, action, data? }` | Control a running task (`cancel`, `approve`, `deny`, `input`) |
| `upgrade.available` | — | Connector should upgrade |
| `error` | `{ code, message, taskId? }` | Error notification |

#### Bidirectional

| Type | Description |
|------|-------------|
| `ping` | Keepalive ping |
| `pong` | Keepalive pong |
| `session.new` | Create new session |

### Connection Lifecycle

1. Connector opens WebSocket to `wss://<server>:<port><path>`
2. Connector sends `register` with token and project list
3. Server responds with `registered` (or `error`)
4. Server sends `task.start` when user issues a command
5. Connector streams `task.output` back, then `task.complete` or `task.fail`
6. Both sides exchange `ping`/`pong` for keepalive (server: 90s interval, client: 15s interval)

### Reliability

- **Envelope-ID dedup**: both sides track seen message IDs to prevent duplicate processing
- **Send buffer**: connector buffers up to 200 messages during brief disconnections
- **Auto-reconnect**: connector reconnects with exponential backoff on connection loss
- **Heartbeat**: server drops connectors that miss 2 consecutive pings (180s)

### Payload Validation

All payloads are validated against Zod schemas defined in `src/protocol/connectorProtocol.ts`. Invalid payloads are rejected with an `error` envelope.
