> ⚠️ **Historical document** — V0.1 alpha plan. All items have been implemented. See [Roadmap](./roadmap.md) for current status.

# Alpha Release Plan (v0.1.0-alpha)

## Goal

Enable any opencode session to register with petfish-remote so the user can control it via Telegram.

## Architecture: One Connector Per Session

```
opencode (project A)  ──→  connector-A  ──→  wss://remote.petfish.ai/ws/connector
opencode (project B)  ──→  connector-B  ──→  wss://remote.petfish.ai/ws/connector
                                                        ↕
                                              Telegram Bot (server)
                                                        ↕
                                              @petfish_bot ← user
```

Each opencode session starts its own connector sidecar. The server dynamically maps project IDs to connected connectors.

## Changes Required

### 1. Dynamic Connector ID

Current: `connectorId: kyle-desktop` (hardcoded in connector.yaml)
New: `connectorId` derived automatically from `hostname + projectId` or `hostname + sessionId`

**connector.yaml changes:**
```yaml
connectorId: auto              # auto = ${hostname}-${projectId}
serverUrl: "wss://remote.petfish.ai/ws/connector"
token: "shared-token-or-per-project"
projects:
  - id: my-project             # must match server's projects.yaml
    path: /home/user/dev/my-project
```

### 2. Server Dynamic Routing

Current: `config/connectors.yaml` hardcodes `kyle-desktop` runtime
New: Server accepts any connector that registers with a valid token + projectId, and routes tasks to whichever connector announced that project.

**Registration payload change:**
```json
{
  "connectorId": "kyle-desktop-my-project",
  "token": "...",
  "hostname": "DESKTOP-J3QIBUN",
  "projects": [{ "id": "my-project", "path": "/home/user/dev/my-project" }]
}
```

Server's `RuntimeRouter` looks up: projectId → find connected connector that registered this projectId → route task there.

### 3. opencode Integration (Auto-Start)

Option A: `.opencode/hooks/on-start.sh` (if opencode supports hooks)
Option B: opencode MCP server that spawns connector on init
Option C: Shell alias/wrapper: `alias oc='opencode && petfish-connect'`
Option D: Background process in `.bashrc` / tmux plugin

**Recommended for alpha**: Simple shell script that wraps opencode:
```bash
#!/bin/bash
# petfish-connect: start connector alongside opencode
opencode "$@" &
OPENCODE_PID=$!
sleep 2
OPENCODE_PID=$OPENCODE_PID node /path/to/petfish-remote/dist/connector/main.js &
wait $OPENCODE_PID
```

Or better: connector discovers opencode by scanning for the process in the project directory.

### 4. Project Registration on Server

For alpha, keep `config/projects.yaml` as the source of truth for which projects exist and who can access them. But runtimes become dynamic:

```yaml
# projects.yaml (alpha)
projects:
  my-project:
    name: "My Project"
    runtime: "auto"              # "auto" = accept any registered connector
    path: "/home/user/dev/my-project"
    allowed_users:
      - "telegram:685608515"
```

When `runtime: "auto"`, the server routes to whichever connector most recently registered with this project ID.

### 5. User Flow (Alpha)

1. User adds project to server's `projects.yaml`
2. User creates `connector.yaml` in their project (or uses global config)
3. User starts opencode with connector: `OPENCODE_PID=$$ node dist/connector/main.js &`
4. Connector auto-discovers opencode port (via PID), connects to server
5. User sends `/pf use my-project` in Telegram
6. User sends `/pf ask do something` → routed to correct connector/session

### 6. Token Strategy (Alpha)

For alpha: single shared token for all connectors from the same user.
Later: per-project tokens with proper auth.

## Implementation Order

1. Make connectorId dynamic in connector config + registration
2. Server: RuntimeRouter accepts dynamic connectors (lookup by projectId)
3. Server: handle multiple connectors for different projects
4. Create `scripts/petfish-connect.sh` helper script
5. Test with 2 sessions simultaneously
6. Tag v0.1.0-alpha

## Non-Goals (Alpha)

- Per-project auth tokens (use shared token)
- Automatic opencode hook integration (use manual script)
- Multi-user support (single user only)
- Session handoff between TUI and IM (already works for bound session)
