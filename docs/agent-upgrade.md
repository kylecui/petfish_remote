# PetFish Remote — Connector Upgrade Guide (for AI Agents)

> If you are an AI coding assistant reading this document, follow the steps below to upgrade the PetFish Remote connector for the user. Do NOT summarize or skip steps. Execute them in order.

---

## When to use this guide

Use this guide when:
- The user already has PetFish Remote connector installed
- The user wants to update to the latest version
- The connector is reporting a version mismatch with the server

If the connector is NOT installed yet, use `docs/agent-install.md` instead.

---

## Step 0: Assess current state

Check if the connector is installed and running:

### Bash (macOS / Linux / WSL)

```bash
cd ~/.petfish/remote 2>/dev/null && bash scripts/petfish-connect.sh status && echo "---" && git log --oneline -1
```

### PowerShell (Windows)

```powershell
cd $env:USERPROFILE\.petfish\remote
.\scripts\petfish-connect.ps1 status
git log --oneline -1
```

Tell the user:

```
><(((^> PetFish Remote — Upgrade Check

Current state:
- Install dir: [path]
- Running: [yes/no, PID if running]
- Current version: [git commit or tag]

I'll upgrade to the latest version now.
```

If the install directory does NOT exist, tell the user this is a fresh install and switch to `docs/agent-install.md`.

---

## Step 1: Stop the connector

Before upgrading, stop the running connector:

### Bash

```bash
cd ~/.petfish/remote
bash scripts/petfish-connect.sh stop
```

### PowerShell

```powershell
cd $env:USERPROFILE\.petfish\remote
.\scripts\petfish-connect.ps1 stop
```

---

## Step 2: Pull latest code and rebuild

### Bash

```bash
cd ~/.petfish/remote
git pull
npm install
npm run build
```

### PowerShell

```powershell
cd $env:USERPROFILE\.petfish\remote
git pull
npm install
npm run build
```

---

## Step 3: Restart the connector

### Bash

```bash
cd ~/.petfish/remote
bash scripts/petfish-connect.sh restart connector.yaml
```

### PowerShell

```powershell
cd $env:USERPROFILE\.petfish\remote
.\scripts\petfish-connect.ps1 restart .\connector.yaml
```

---

## Step 4: Verify

Check the connector is running with the new version:

### Bash

```bash
cd ~/.petfish/remote
bash scripts/petfish-connect.sh status
git log --oneline -1
```

### PowerShell

```powershell
cd $env:USERPROFILE\.petfish\remote
.\scripts\petfish-connect.ps1 status
git log --oneline -1
```

Tell the user:

```
><(((^> PetFish Remote upgraded!

New version: [git commit/tag]
Status: running (PID [number])

Your connector is back online. Go to your messaging app — everything should work as before.
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `git pull` fails with merge conflicts | `git stash && git pull && git stash pop` — or `git reset --hard origin/dev && git pull` if no local changes matter |
| `npm install` fails | Delete `node_modules` and retry: `rm -rf node_modules && npm install` |
| Connector won't start after upgrade | Check logs: `bash scripts/petfish-connect.sh logs` |
| Config format changed | The connector auto-migrates `connector.yaml` on start. Check logs for migration messages. |

---

## Links

- **Website**: https://remote.petfish.ai
- **Full install/upgrade docs**: https://remote.petfish.ai/docs/install
- **Source**: https://github.com/kylecui/petfish_remote
