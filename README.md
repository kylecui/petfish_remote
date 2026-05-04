# PetFish Remote 胖鱼遥控器

Chat-based control plane for safely operating opencode agents across project workspaces.

> 用聊天工具安全遥控你的opencode项目Agent。

## Quick Start

```bash
# Install
./scripts/install.sh

# Configure
cp .env.example .env
# Edit .env with your Telegram bot token
# Edit config/projects.yaml with your projects

# Run
npm run dev
```

## Architecture

```
Telegram / Slack / Feishu
    ↓ Webhook / Bot API
PetFish Remote Bridge
    ↓ Runtime Router
Execution Runtime (local / wsl / ssh)
    ↓
opencode CLI / SDK
    ↓
Project Workspace
```

## Commands

| Command | Description |
|---|---|
| `/pf help` | Show help |
| `/pf list` | List available projects |
| `/pf use <project>` | Bind chat to a project |
| `/pf where` | Show current binding |
| `/pf ask <instruction>` | Create read-only analysis task |
| `/pf edit <instruction>` | Create edit task (guarded) |
| `/pf test [name]` | Run preset test command |
| `/pf status` | Show current task status |
| `/pf diff` | Show current task diff |
| `/pf approve` | Approve pending operation |
| `/pf deny` | Deny pending operation |
| `/pf stop` | Stop current task |
| `/pf log` | Show recent task log |

## Execution Modes

| Mode | Capabilities |
|---|---|
| `read_only` | Read files, search, analyze |
| `suggest` | Propose changes without writing |
| `edit_guarded` | Edit with approval on risky changes |
| `execute_guarded` | Run whitelisted/approved commands |
| `admin` | Full access (local only) |

## Configuration

- `config/projects.yaml` — Registered projects
- `config/runtimes.yaml` — Execution environments
- `config/policies.yaml` — Security policies
- `config/users.yaml` — User roles and permissions
- `config/adapters.yaml` — Chat platform settings
- `config/runtime.yaml` — Runtime settings (storage, limits)

## Tech Stack

- TypeScript / Node.js (ESM)
- grammY (Telegram Bot)
- better-sqlite3 (Storage)
- YAML + Zod (Config)

## Development

```bash
npm run dev        # Watch mode
npm run build      # Compile
npm run test       # Run tests
npm run typecheck  # Type check
```

## License

MIT
