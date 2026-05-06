# Client Installation and Usage Guide

## Overview
The Connector bridges your local OpenCode session to Telegram via the bot server. It allows you to control your local AI agents remotely.

## Prerequisites
* Node.js >= 18
* git
* curl

## Quick Install (Recommended)
Run the following command to install the connector:

```bash
curl -sSL https://remote.petfish.ai/install | bash -s -- <token> [project-id]
```

To get your token, send `/start` to `@petfish_bot` on Telegram.

Arguments:
* `token`: The one-time token from the Telegram bot.
* `project-id`: Optional. The identifier for your project.
* `--project-path`: Optional. The path to your project.
* `--project-name`: Optional. The display name of your project.
* `--no-start`: Optional. Install without starting the connector.
* `--agent <type>`: Optional. AI agent to use: auto, opencode, gemini, codex (default: auto)

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

```bash
petfish-connect.sh start ./connector.yaml
```
```

## Telegram Commands
Manage your sessions via `@petfish_bot` on Telegram.

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

To configure, use the `--agent` flag during installation or set the `agent:` field in your `connector.yaml` file. The installer runs a pre-flight check and warns if the selected agent binary is not found in your PATH.

## Configuration
The `connector.yaml` file holds your configuration. 

**SECURITY WARNING:** Do NOT commit `connector.yaml` to git. It contains sensitive credentials.

Example `connector.yaml`:
```yaml
connectorToken: "your-token"
serverUrl: "https://remote.petfish.ai"
projectId: "my-project"
agent: opencode
```

Key fields:
* `connectorToken`: The persistent authentication token obtained after registration.
* `serverUrl`: The target bot server (default: `https://remote.petfish.ai`).
* `projectId`: Your project identifier.
* `agent`: The AI agent to use (e.g., `opencode`).

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
| Invalid token | Token expired or used | Request a new token via `/start` in Telegram |
| Process exits | Missing Node.js | Verify Node.js >= 18 is installed |
