# PetFish Remote — Connector Installation Guide (for AI Agents)

> If you are an AI coding assistant reading this document, follow the steps below to install the PetFish Remote connector for the user. Do NOT summarize or skip steps. Execute them in order.

---

## What is PetFish Remote?

PetFish Remote lets users control their AI coding sessions (opencode, Gemini CLI, Codex CLI) from messaging apps like Telegram, Feishu, Slack, and WeCom. The **connector** runs on the user's dev machine, bridges the messaging platform to the local AI agent.

---

## Step 0: Collect the setup token

The user should have received a **setup token** from the `/start` command on their messaging platform. It looks like a 32-character hex string and expires in 5 minutes.

If the user has NOT provided a token, tell them:

```
I need a setup token to install PetFish Remote.
Send /start to the PetFish bot on your messaging platform (Telegram / Feishu / Slack / WeCom) and paste the token here.
```

Once you have the token, proceed.

---

## Step 1: Detect environment

Detect the operating system:
- If macOS, Linux, or WSL → use **Bash** commands
- If Windows (native, not WSL) → use **PowerShell** commands

Tell the user:

```
><(((^> PetFish Remote — Connector Setup

OS detected: [macOS / Linux / WSL / Windows]
I'll install the PetFish Remote connector on this machine.
```

---

## Step 2: Check prerequisites

Verify these are available:

| Requirement | Check command |
|-------------|---------------|
| Node.js ≥ 18 | `node -v` |
| git | `git --version` |
| curl (Bash) or PowerShell 5+ (Windows) | `curl --version` or `$PSVersionTable` |

If any prerequisite is missing, tell the user what to install before proceeding.

---

## Step 3: Ask about AI agent type (optional)

If the user has not specified which AI agent they use, ask:

```
Which AI coding agent do you use?
1. opencode (default)
2. Gemini CLI
3. Codex CLI
4. Auto-detect
```

This determines the `--agent` flag. Default is `opencode` if not specified.

---

## Step 4: Install

### Bash (macOS / Linux / WSL)

Run:

```bash
curl -sSL https://remote.petfish.ai/install | bash -s -- <TOKEN>
```

Replace `<TOKEN>` with the user's setup token.

To specify a non-default agent:

```bash
curl -sSL https://remote.petfish.ai/install | bash -s -- <TOKEN> --agent gemini
```

**What this does:**
1. Checks prerequisites (Node.js, git)
2. Clones (or updates) `petfish_remote` to `~/.petfish/remote`
3. Runs `npm install && npm run build`
4. Registers the machine with the bot server using the token
5. Generates `connector.yaml` with the connector auth token
6. Starts the connector daemon in the background

### PowerShell (Windows)

Windows uses a multi-step process:

**Step 4a — Clone & Build:**

```powershell
git clone https://github.com/kylecui/petfish_remote.git $env:USERPROFILE\.petfish\remote
cd $env:USERPROFILE\.petfish\remote
npm install
npm run build
```

**Step 4b — Register & Generate Config:**

```powershell
.\scripts\petfish-connect.ps1 setup -Token <TOKEN>
```

Replace `<TOKEN>` with the user's setup token.

Optional parameters:
- `-ProjectId my-project` — custom project ID
- `-ProjectPath "C:\Users\you\code\my-project"` — project directory (defaults to current)
- `-Server "https://your-server.com"` — custom server URL
- `-Agent gemini` — AI agent type (opencode, gemini, codex)

**Step 4c — Start the daemon:**

```powershell
.\scripts\petfish-connect.ps1 start .\connector.yaml
```

---

## Step 5: Verify

After installation, verify the connector is running:

### Bash

```bash
cd ~/.petfish/remote
bash scripts/petfish-connect.sh status
```

Should show a running PID.

### PowerShell

```powershell
cd $env:USERPROFILE\.petfish\remote
.\scripts\petfish-connect.ps1 status
```

Tell the user:

```
><(((^> PetFish Remote connector is running!

The connector is connected to the bot server and ready to receive commands.
Go back to your messaging app and send any message to start controlling your AI agent.

Useful commands (in your messaging app):
  /pf list    — List available projects
  /pf new     — Start a new AI session
  /pf         — Show the control panel
```

---

## Step 6: Adding a second messaging platform (optional)

If the user already has a working connector (e.g. from Telegram) and wants to add Feishu (or vice versa):

1. Send `/start` to the bot on the **new** platform to get a fresh token
2. Run the installer again from the project directory where `connector.yaml` exists:

```bash
cd ~/dev/my-project
curl -sSL https://remote.petfish.ai/install | bash -s -- <NEW_TOKEN>
```

The installer detects the existing `connector.yaml` and adds the new platform — no restart required.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `node: command not found` | Install Node.js ≥ 18 from https://nodejs.org |
| Token expired | Send `/start` again on the messaging platform for a fresh token |
| Connector won't start | Check logs: `bash scripts/petfish-connect.sh logs` |
| Already running | Stop first: `bash scripts/petfish-connect.sh stop`, then restart |
| Windows execution policy | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Agent binary not found | Install the chosen agent CLI (gemini/codex) or use `--agent opencode` |

---

## Environment overrides

| Variable | Default | Description |
|----------|---------|-------------|
| `PETFISH_REMOTE_DIR` | `~/.petfish/remote` | Install location |
| `PETFISH_SERVER_URL` | `https://remote.petfish.ai` | Server URL (for self-hosted setups) |

---

## Links

- **Website**: https://remote.petfish.ai
- **Docs**: https://remote.petfish.ai/docs/install
- **Source**: https://github.com/kylecui/petfish_remote
