# PetFish Remote — Connector Setup (AI-Executable Runbook)

This document is designed for both humans and AI agents (opencode, Claude Code, etc.) to follow step-by-step.

## Overview

To control an opencode session via Telegram, you need:
1. A `connector.yaml` in your project (client-side)
2. The project registered in `config/projects.yaml` on the server
3. The connector process running alongside opencode

## Step 1: Create connector.yaml

Create `connector.yaml` in your project root:

```yaml
connectorId: auto
serverUrl: "wss://remote.petfish.ai/ws/connector"
token: "e80Mft2NAjly5hQSSo9C1juSfjH9x_mVCcSI2VmFgKE"
reconnectIntervalMs: 5000
maxReconnectIntervalMs: 60000

projects:
  - id: YOUR_PROJECT_ID
    path: /absolute/path/to/your/project
    opencodeBin: opencode
```

Replace:
- `YOUR_PROJECT_ID` — a short slug (e.g., `my-app`, `petfish-tester`). Must match what you register on the server in Step 2.
- `/absolute/path/to/your/project` — the full path to the project directory

## Step 2: Register Project on Server

SSH into the server and append your project to the config:

```bash
ssh root@38.55.160.238
```

Edit `/opt/petfish-remote/config/projects.yaml` and add a new entry under `projects:`:

```yaml
  YOUR_PROJECT_ID:
    name: "Human-Readable Project Name"
    runtime: "kyle-desktop"
    path: "/absolute/path/to/your/project"
    default_mode: "read_only"
    allowed_users:
      - "telegram:685608515"
    readme_files: []
    test_commands: {}
    risk_profile: "default"
    secrets_policy: "deny_read"
```

Required fields:
- `name` — display name
- `runtime` — use `"kyle-desktop"` (resolved dynamically by projectId)
- `path` — project path on the machine running the connector
- `default_mode` — `"read_only"` recommended
- `allowed_users` — list of `"telegram:<user_id>"` strings
- `readme_files` — list of readme paths (can be `[]`)
- `test_commands` — map of command names to shell commands (can be `{}`)
- `risk_profile` — `"default"`
- `secrets_policy` — `"deny_read"`

Then restart the server:

```bash
systemctl restart petfish-remote
```

Verify it started:

```bash
systemctl is-active petfish-remote
# Expected output: active
```

If it fails, check logs:

```bash
journalctl -u petfish-remote --no-pager -n 20
```

## Step 3: Start the Connector

On the machine running opencode, in a **separate terminal or tmux pane**:

```bash
# Find the opencode PID
OPENCODE_PID=$(pgrep -f "opencode" | head -1)

# Start the connector
cd /path/to/your/project
OPENCODE_PID=$OPENCODE_PID node /home/kylecui/dev/petfish_remote/dist/connector/main.js ./connector.yaml
```

Or use the helper script:

```bash
OPENCODE_PID=$(pgrep -f "opencode" | head -1) \
  /home/kylecui/dev/petfish_remote/scripts/petfish-connect.sh ./connector.yaml
```

Expected output on success:

```
SessionBridge: session=ses_XXXXX port=NNNNN lastAssistant=msg_XXXXX
SessionBridge mode: routing tasks to active opencode session
PetFish Connector starting (auto-generated-id, 1 projects)
Connecting to wss://remote.petfish.ai/ws/connector...
Connected, sending registration...
[ws-recv] type=registered taskId=none
Registration accepted by server
```

If you see `AUTH_FAILED`, verify the token in `connector.yaml` matches the server's `config/connectors.yaml` wildcard entry.

## Step 4: Use via Telegram (@petfish_bot)

```
/pf list                    — lists all registered projects
/pf use YOUR_PROJECT_ID     — binds your chat to the project
```

After binding, any message you send goes directly to the opencode session.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `AUTH_FAILED` | Token mismatch | Check `connector.yaml` token matches server's `config/connectors.yaml` |
| `SessionBridge init failed` | OPENCODE_PID wrong or opencode not running | Verify with `ps -p $OPENCODE_PID -o comm=` |
| Project not in `/pf list` | Not in server's `projects.yaml` | Add it and `systemctl restart petfish-remote` |
| `Access denied` on `/pf use` | User not in `allowed_users` | Add `"telegram:YOUR_ID"` to project config |
| Connector keeps reconnecting | Server down or network issue | Check `systemctl status petfish-remote` on server |

## Server Details

- **Host**: root@38.55.160.238
- **Service**: petfish-remote (systemd)
- **Config dir**: /opt/petfish-remote/config/
- **Gateway port**: 9100 (WebSocket)
- **Domain**: remote.petfish.ai
- **Bot**: @petfish_bot
