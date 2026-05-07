# Install & Upgrade — PetFish Remote

> One connector, all your AI coding agents, controlled from Telegram and Feishu.

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| Node.js | ≥ 18 | `node -v` |
| git | any | `git --version` |
| curl (bash) or PowerShell 5+ (Windows) | — | — |

## Quick Install (macOS / Linux / WSL)

```bash
curl -sSL https://remote.petfish.ai/install | bash -s -- <token>
```

**What this does:**
1. Checks prerequisites
2. Clones (or pulls) `petfish_remote` to `~/.petfish/remote`
3. Runs `npm install && npm run build`
4. Registers your machine with the bot server using the token
5. Starts the connector daemon in the background

To use a non-default AI agent, add --agent: `curl ... | bash -s -- <token> --agent gemini`

**Get a token:** Send `/start` to the bot on Telegram or Feishu. Tokens expire in 5 minutes.

### Environment overrides

| Variable | Default | Description |
|----------|---------|-------------|
| `PETFISH_REMOTE_DIR` | `~/.petfish/remote` | Install location |
| `PETFISH_SERVER_URL` | `https://remote.petfish.ai` | Server URL (self-hosted) |

## Windows (PowerShell)

Windows uses a two-step process: clone + register with the server.

### Step 1 — Clone & Build

```powershell
git clone https://github.com/kylecui/petfish_remote.git $env:USERPROFILE\.petfish\remote
cd $env:USERPROFILE\.petfish\remote
npm install
npm run build
```

### Step 2 — Register & Generate Config

```powershell
.\scripts\petfish-connect.ps1 setup -Token <your-token> -ProjectId my-project
```

This exchanges the one-time token with the server and generates `connector.yaml` automatically.

Optional parameters:
- `-ProjectPath "C:\Users\you\code\my-project"` (defaults to current directory)
- `-Server "https://your-server.com"` (defaults to `https://remote.petfish.ai`)
- `-Agent gemini` (optional AI agent: auto, opencode, gemini, codex)

### Step 3 — Start the daemon

```powershell
.\scripts\petfish-connect.ps1 start .\connector.yaml
```

The script uses `Start-Process` to launch a background daemon that persists after the terminal closes.

### Management commands (PowerShell)

```powershell
.\scripts\petfish-connect.ps1 status              # Check if running
.\scripts\petfish-connect.ps1 stop                # Stop daemon
.\scripts\petfish-connect.ps1 restart connector.yaml  # Restart
.\scripts\petfish-connect.ps1 logs                # Tail logs
```

## Multi-Platform Setup (Telegram + Feishu)

PetFish Remote supports controlling the same projects from both Telegram and Feishu simultaneously. One connector handles both platforms — no duplicated setup needed.

### Adding a Second Platform

If you already have a working connector (e.g. set up via Telegram), adding Feishu (or vice versa) is a single command:

1. Send `/start` to the bot on the **new** platform to get a token
2. Run the installer from the project directory where `connector.yaml` exists:

```bash
cd ~/dev/my-project
curl -sSL https://remote.petfish.ai/install | bash -s -- <token-from-new-platform>
```

The installer detects the existing `connector.yaml` and calls `/api/add-platform` instead of creating a new registration. Your connector config is unchanged, no restart required.

### What Happens Behind the Scenes

- The new platform's user ID is added to `allowed_users` for each project in your connector
- The existing connector token and WebSocket connection remain untouched
- Both platform users can now send commands to the same projects

### Force Fresh Registration

To replace the existing connector identity entirely (e.g. after a token refresh or if you want to start over):

```bash
curl -sSL https://remote.petfish.ai/install | bash -s -- <token> --force-register
```

This overwrites `connector.yaml` with a new connector token. The old token becomes invalid.

### Manual Setup (petfish-connect.sh)

```bash
# Add platform to existing connector:
bash scripts/petfish-connect.sh setup --token <new-platform-token>

# Force fresh registration:
bash scripts/petfish-connect.sh setup --token <token> --project-id my-project --force-register
```

## Token Types & Re-binding

PetFish Remote uses two distinct tokens. Understanding them prevents common mistakes:

| Token | Source | Lifetime | Format |
|-------|--------|----------|--------|
| **One-time setup token** | `/start` in Telegram or Feishu | 5 minutes | 32-character hex string |
| **Connector token** | Generated during registration | Permanent (until revoked) | Base64url string in `connector.yaml` |

**Important:**

- The `/start` token is a one-time exchange credential. It is consumed during registration and cannot be reused.
- The `token` field in `connector.yaml` is your persistent connector token — **do not manually edit or replace it**.
- If you paste a `/start` token into the `token` field of `connector.yaml`, the connector will fail to authenticate. The error message will indicate that you may have used a one-time setup token instead of a connector token.
- To add a new platform (e.g., Feishu after Telegram), use the standard add-platform flow described above — **never manually edit the token**.
- To start completely fresh, use `--force-register` which performs a new registration and generates a new connector token.

## Upgrade

### Bash (macOS / Linux / WSL)

Re-run the same install command — it detects the existing installation and upgrades in place:

```bash
curl -sSL https://remote.petfish.ai/install | bash -s -- <token>
```

Or manually:

```bash
cd ~/.petfish/remote
git pull
npm install
npm run build
bash scripts/petfish-connect.sh restart connector.yaml
```

### PowerShell (Windows)

```powershell
cd $env:USERPROFILE\.petfish\remote
git pull
npm install
npm run build
.\scripts\petfish-connect.ps1 restart .\connector.yaml
```

## Daemon Management (Bash)

```bash
cd ~/.petfish/remote
bash scripts/petfish-connect.sh start connector.yaml   # Start
bash scripts/petfish-connect.sh stop                    # Stop
bash scripts/petfish-connect.sh restart connector.yaml  # Restart
bash scripts/petfish-connect.sh status                  # Check PID
bash scripts/petfish-connect.sh logs                    # Tail logs
bash scripts/petfish-connect.sh logs -n 100             # Last 100 lines
```

The daemon writes logs to `.runtime/connector.log` and PID to `.runtime/connector.pid`.

## Multi-Agent Support

PetFish Remote supports multiple AI coding agents per project. You can set this during installation using the `--agent` flag (or `-Agent` on Windows), or configure it manually:

| Agent | Config value | Status |
|-------|-------------|--------|
| OpenCode | `opencode` | ✅ Stable |
| Gemini CLI | `gemini` | 🧪 Beta |
| Codex CLI | `codex` | 🧪 Beta |

Configure per-project in `connector.yaml`:

```yaml
connectorId: auto
serverUrl: "wss://remote.petfish.ai/ws/connector"
token: "<connector-auth-token>"

projects:
  - id: frontend
    path: ~/code/frontend
    agent: opencode
  - id: backend
    path: ~/code/backend
    agent: gemini
```

## Uninstall

### Bash

```bash
cd ~/.petfish/remote
bash scripts/petfish-connect.sh stop
cd ~ && rm -rf ~/.petfish/remote
```

### PowerShell

```powershell
cd $env:USERPROFILE\.petfish\remote
.\scripts\petfish-connect.ps1 stop
cd $env:USERPROFILE
Remove-Item -Recurse -Force $env:USERPROFILE\.petfish\remote
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `node: command not found` | Install Node.js ≥ 18: https://nodejs.org |
| Token expired | Send `/start` again in Telegram or Feishu for a fresh token |
| Connector won't start | Check `scripts/petfish-connect.sh logs` or `.runtime/connector.log` |
| Already running | `petfish-connect.sh status` shows PID — stop first, then restart |
| Windows: "not digitally signed" | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Agent binary not found | Selected agent (gemini/codex) not in PATH \| Install the agent CLI or use --agent auto |

## Links

- **Bot**: [@petfish_bot](https://t.me/petfish_bot)
- **Website**: [remote.petfish.ai](https://remote.petfish.ai)
- **Source**: [github.com/kylecui/petfish_remote](https://github.com/kylecui/petfish_remote)
- **Docs**: [Client Guide](./en/client-guide.md) · [Server Guide](./en/server-guide.md)
