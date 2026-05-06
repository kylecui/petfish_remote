# PetFish Remote — Connector Setup (AI-Executable Runbook)

This document is designed for both humans and AI agents (opencode, Claude Code, etc.) to follow step-by-step. An AI agent in an opencode session can execute these steps to self-register with PetFish Remote.

## Prerequisites

- The petfish_remote repo must be cloned and built on this machine:
  ```bash
  git clone https://github.com/kylecui/petfish_remote.git /home/kylecui/dev/petfish_remote
  cd /home/kylecui/dev/petfish_remote
  npm install
  npm run build
  ```
- Node.js 18+
- A running opencode session for the project you want to control
- SSH access to `root@38.55.160.238` (the PetFish Remote server)

## Step 1: Create connector.yaml in Your Project

Create a file called `connector.yaml` in the root of the project you want to control:

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

**Replace:**
- `YOUR_PROJECT_ID` — a short slug (e.g., `my-app`, `petfish-tester`). This MUST match the key used in Step 2.
- `/absolute/path/to/your/project` — the absolute path to your project directory (same directory where this `connector.yaml` lives)

## Step 2: Register the Project on Server

SSH into the server:

```bash
ssh root@38.55.160.238
```

Edit `/opt/petfish-remote/config/projects.yaml`. Append a new entry under the top-level `projects:` key:

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

**Important:** The `YOUR_PROJECT_ID` key here must exactly match `projects[0].id` in your `connector.yaml`.

Then restart the server for config to take effect:

```bash
systemctl restart petfish-remote
```

Verify it started successfully:

```bash
systemctl is-active petfish-remote
```

Expected output: `active`

If it shows `failed` or `activating`, check the error:

```bash
journalctl -u petfish-remote --no-pager -n 20
```

Common config error: missing required fields. All of these are required: `name`, `runtime`, `path`, `default_mode`, `allowed_users`, `readme_files`, `test_commands`, `risk_profile`, `secrets_policy`.

## Step 3: Start the Connector Process

The connector must run alongside your opencode session. It bridges the Telegram bot to your live opencode session via WebSocket.

**Run this in a separate terminal, tmux pane, or background process:**

```bash
cd /path/to/your/project

OPENCODE_PID=$(pgrep -xf "opencode" | head -1) \
  node /home/kylecui/dev/petfish_remote/dist/connector/main.js ./connector.yaml
```

**Alternatively**, use the helper script:

```bash
cd /path/to/your/project

OPENCODE_PID=$(pgrep -xf "opencode" | head -1) \
  /home/kylecui/dev/petfish_remote/scripts/petfish-connect.sh ./connector.yaml
```

### Expected Output (success)

```
SessionBridge: session=ses_XXXXX port=NNNNN lastAssistant=msg_XXXXX
SessionBridge mode: routing tasks to active opencode session
PetFish Connector starting (hostname-projectid, 1 projects)
Connecting to wss://remote.petfish.ai/ws/connector...
Connected, sending registration...
[ws-recv] type=registered taskId=none
Registration accepted by server
```

### Verifying Connection on Server

From the server, confirm the connector registered:

```bash
ssh root@38.55.160.238 "journalctl -u petfish-remote --no-pager -n 10 | grep -i register"
```

You should see: `Connector registered: <your-auto-id> (<hostname>, 1 projects)`

If you do NOT see your connector in server logs, the connector is not connected. Check:
1. Is the connector process still running? (`ps aux | grep connector`)
2. Does the token match? (compare `connector.yaml` token with server's `config/connectors.yaml`)
3. Network connectivity to `remote.petfish.ai:443`

## Step 4: Use via Telegram

Open @petfish_bot in Telegram:

```
/pf list                    — shows all registered projects
/pf use YOUR_PROJECT_ID     — binds this chat to your project
```

After binding, any message you send (without `/pf` prefix) goes directly to the opencode session as an instruction.

## Restarting the Connector

If the server was restarted, or the connector lost connection, restart it:

```bash
# Kill existing connector
kill $(pgrep -f "dist/connector/main.js")

# Restart
cd /path/to/your/project
OPENCODE_PID=$(pgrep -xf "opencode" | head -1) \
  node /home/kylecui/dev/petfish_remote/dist/connector/main.js ./connector.yaml
```

The connector has auto-reconnect with exponential backoff (5s → 60s max), but if it was built from an older version of the code, you must rebuild first:

```bash
cd /home/kylecui/dev/petfish_remote
git pull
npm run build
```

Then restart the connector.

## Full Example: Adding "petfish-tester"

### On the client machine:

```bash
cd /home/kylecui/dev/petfish-tester

cat > connector.yaml << 'EOF'
connectorId: auto
serverUrl: "wss://remote.petfish.ai/ws/connector"
token: "e80Mft2NAjly5hQSSo9C1juSfjH9x_mVCcSI2VmFgKE"
reconnectIntervalMs: 5000
maxReconnectIntervalMs: 60000

projects:
  - id: petfish-tester
    path: /home/kylecui/dev/petfish-tester
    opencodeBin: opencode
EOF

OPENCODE_PID=$(pgrep -xf "opencode" | head -1) \
  node /home/kylecui/dev/petfish_remote/dist/connector/main.js ./connector.yaml
```

### On the server (already done for petfish-tester):

The project `petfish-tester` is already registered in `/opt/petfish-remote/config/projects.yaml`.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `AUTH_FAILED` | Token mismatch | Verify token in `connector.yaml` matches server `config/connectors.yaml` wildcard entry |
| `SessionBridge init failed` | OPENCODE_PID wrong or opencode not running | Run `ps -p $OPENCODE_PID -o comm=` — must output `opencode` |
| Project not in `/pf list` | Not in server `projects.yaml` | Add it, then `systemctl restart petfish-remote` on server |
| `Access denied` on `/pf use` | User not in `allowed_users` | Add `"telegram:685608515"` to project's `allowed_users` |
| Messages sent but no response | Connector not connected | Check server logs: `journalctl -u petfish-remote -n 10 \| grep register` |
| Connector shows "registered" but messages fail | Server restarted after connector connected | Restart the connector process |

## Server Reference

| Item | Value |
|------|-------|
| Host | root@38.55.160.238 |
| Service | petfish-remote (systemd) |
| Config dir | /opt/petfish-remote/config/ |
| Gateway port | 9100 (WebSocket, behind nginx) |
| Domain | remote.petfish.ai |
| Bot | @petfish_bot |
| Connector token (alpha) | e80Mft2NAjly5hQSSo9C1juSfjH9x_mVCcSI2VmFgKE |
| Telegram user ID (Kyle) | 685608515 |
