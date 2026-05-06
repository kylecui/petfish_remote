# Setup Guide — PetFish Remote Connector

Connect any opencode project to PetFish Remote so you can control it via Telegram.

## Prerequisites

- Node.js 18+
- A running opencode session for your project
- Access to the PetFish Remote server (token from admin)

## Quick Start

### 1. Create `connector.yaml` in your project root

```yaml
connectorId: auto
serverUrl: "wss://remote.petfish.ai/ws/connector"
token: "YOUR_CONNECTOR_TOKEN"
reconnectIntervalMs: 5000
maxReconnectIntervalMs: 60000

projects:
  - id: my-project
    path: /path/to/your/project
    opencodeBin: opencode
```

- `connectorId: auto` generates an ID from your hostname + project ID
- `token` — get this from the PetFish Remote admin
- `projects[].id` — must match the project ID in the server's `config/projects.yaml`

### 2. Start the connector alongside opencode

```bash
# In a separate terminal/tmux pane:
OPENCODE_PID=$(pgrep -f "opencode") \
  /path/to/petfish_remote/scripts/petfish-connect.sh ./connector.yaml
```

Or use the built dist directly:

```bash
OPENCODE_PID=$(pgrep -f "opencode") \
  node /path/to/petfish_remote/dist/connector/main.js ./connector.yaml
```

The `OPENCODE_PID` env var enables SessionBridge mode — tasks route to your active opencode session instead of spawning new processes.

### 3. Register the project on the server

Add to `config/projects.yaml` on the server:

```yaml
projects:
  my-project:
    name: "My Project"
    runtime: "dynamic"
    path: "/path/to/your/project"
    default_mode: "read_only"
    allowed_users:
      - "telegram:YOUR_TELEGRAM_ID"
```

The `runtime` field can reference any defined runtime, or use a connector runtime with dynamic resolution.

### 4. Use via Telegram

```
/pf list          — see available projects
/pf use my-project — bind chat to your project
Hello, please check the tests  — sends to opencode
```

## Architecture

```
Your Machine                          Server (remote.petfish.ai)
┌─────────────────┐                  ┌──────────────────────┐
│ opencode (TUI)  │                  │ PetFish Remote       │
│   port: auto    │                  │   Telegram Bot       │
├─────────────────┤    WebSocket     │   ConnectorGateway   │
│ Connector       │◄───────────────►│   ConnectorRegistry  │
│ (SessionBridge) │  wss://.../ws   │   RuntimeRouter      │
└─────────────────┘                  └──────────────────────┘
```

Each connector auto-registers with the server. The server resolves which connector to use based on project ID — no manual mapping needed.

## Troubleshooting

**Auth failed**: Ensure your token matches a wildcard (`*`) or specific entry in the server's `config/connectors.yaml`.

**SessionBridge init failed**: Make sure `OPENCODE_PID` points to a running opencode process and its HTTP API is accessible.

**No connector available**: The connector must be running and connected before sending commands via Telegram.
