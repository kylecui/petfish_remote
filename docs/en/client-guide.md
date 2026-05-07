# Client Installation and Usage Guide

## Overview
The Connector bridges your local OpenCode session to Telegram and Feishu via the bot server. It allows you to control your local AI agents remotely.

## Prerequisites
* Node.js >= 18
* git
* curl

## Quick Install (Recommended)
Run the following command to install the connector:

```bash
curl -sSL https://remote.petfish.ai/install | bash -s -- <token> [project-id]
```

To get your token, send `/start` to `@petfish_bot` on Telegram or your Feishu bot.

Arguments:
* `token`: The one-time token from the Telegram or Feishu bot.
* `project-id`: Optional. The identifier for your project.
* `--project-path`: Optional. The path to your project.
* `--project-name`: Optional. The display name of your project.
* `--no-start`: Optional. Install without starting the connector.
* `--agent <type>`: Optional. AI agent to use: auto, opencode, gemini, codex (default: auto)
* `--force-register`: Optional. Start completely fresh and ignore existing configuration.

The default install path is `~/.petfish/remote/`. You can customize this by setting the `PETFISH_REMOTE_DIR` environment variable before installation.

## Manual Install
If you prefer to install manually, follow these steps:

```bash
git clone https://github.com/kylecui/petfish_remote
cd petfish_remote
npm install
npm run build
./petfish-connect.sh setup
./petfish-connect.sh start ./connector.yaml
```

## Daily Usage
Manage the connector daemon using the provided script:

* Start: `petfish-connect.sh start ./connector.yaml`
* Stop: `petfish-connect.sh stop`
* Restart: `petfish-connect.sh restart`
* Status: `petfish-connect.sh status`
* Logs: `petfish-connect.sh logs`

Note: On Windows, use `petfish-connect.ps1` instead of `petfish-connect.sh`.

## AI Agent Auto-Start Integration
You can configure your OpenCode agent to launch the connector automatically. Add this template to your `AGENTS.md` file:

```markdown
# PetFish Remote Integration

To enable remote access, start the connector in the background:

\`\`\`bash
petfish-connect.sh start ./connector.yaml
\`\`\`
```

## Commands (Telegram & Feishu)
Manage your sessions via `@petfish_bot` on Telegram or the Feishu bot interface. Feishu uses the exact same commands as Telegram.

* `/pf use <project>`: Bind a specific project to your current chat.
* Direct text: Sending plain text acts as an "ask" instruction for the bound project (default mode).
* `/pf`: Shows an InlineKeyboard with action options.
* `/pf new`: Start a fresh session.
* `/pf list`: List all available projects.

## Multi-Agent Support

PetFish Remote supports multiple AI coding agents.

| Agent | Status |
|-------|--------|
| opencode | Stable |
| gemini | Beta |
| codex | Beta |

To configure, use the `--agent` flag during installation or set the `agent` field in your `connector.yaml` file. The installer runs a pre-flight check and warns if the selected agent binary is not found in your PATH.

### Auto Agent
When `agent` is set to `auto` (the default), the connector auto-detects available agents at startup. The detection priority is opencode, then gemini, and finally codex. The connector exits with an error if no agent binary is found.

## Multi-Platform Setup
PetFish Remote supports both Telegram and Feishu simultaneously. 

To add a second platform, send `/start` on the new platform. Then re-run the install command from the project directory where your `connector.yaml` exists. The installer auto-detects the existing `connector.yaml` file and calls the `/api/add-platform` endpoint. Your existing connector token and WebSocket connection remain untouched.

Use `--force-register` to start completely fresh.

## Configuration
The `connector.yaml` file holds your configuration. 

**SECURITY WARNING:** Do NOT commit `connector.yaml` to git. It contains sensitive credentials.

Example `connector.yaml`:
```yaml
connectorId: auto
serverUrl: "wss://remote.petfish.ai/ws/connector"
token: "<connector-auth-token>"
reconnectIntervalMs: 5000
maxReconnectIntervalMs: 60000

projects:
  - id: my-project
    path: /home/user/code/my-project
    agent: opencode
```

Key fields:
* `connectorId`: Connector identity (use `auto` to let the server assign one).
* `serverUrl`: WebSocket URL of the bot server. Note that this uses the `wss://` protocol rather than `https://`.
* `token`: Persistent connector authentication token. This is generated during registration. Do NOT manually edit it.
* `reconnectIntervalMs` / `maxReconnectIntervalMs`: WebSocket reconnection timing (optional, defaults shown).
* `projects`: Array of local project definitions. Each project has `id`, `path`, `name` (optional), and `agent`.

## Token Types & Re-binding

* **One-time setup token**: Obtained from `/start`. Expires in 5 minutes. Formatted as a 32-character hex string.
* **Connector token**: Generated during registration. Permanent base64url string stored in `connector.yaml`.

**WARNING:** Do NOT manually edit the token field in `connector.yaml`. 
**WARNING:** Do NOT paste a `/start` token into `connector.yaml`. It will fail with a specific error.

To add a platform, use the add-platform flow. To start fresh, use `--force-register`.

## Environment Variables
* `PETFISH_REMOTE_DIR`: Overrides the default `~/.petfish/remote/` installation directory.
* `OPENCODE_PID`: The process ID of the OpenCode session (only relevant for the opencode agent).
* `PETFISH_SERVER_URL`: The target server URL.

## Auto-Update
The connector includes an auto-update mechanism. On start, it compares its version against `/api/version` on the server. If there is a mismatch, the connector updates itself automatically.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Connection refused | Server unreachable | Check network and `serverUrl` in `connector.yaml` |
| Invalid token | Token expired or used | Request a new token via `/start` |
| Process exits | Missing Node.js | Verify Node.js >= 18 is installed |
