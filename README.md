# PetFish Remote 胖鱼遥控器

> Control your opencode AI agent from Telegram — anywhere, anytime.
>
> 用 Telegram 遥控你的 opencode AI 编程助手。

[![Beta](https://img.shields.io/badge/status-beta-blue)](https://remote.petfish.ai)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-green)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-gray)](./LICENSE)

## Architecture 架构

```
┌─────────────┐        ┌─────────────────┐        ┌─────────────────────┐
│  Telegram   │◄──────►│   Bot Server    │◄──WSS──►│   Connector (你的机器) │
│  (You/你)   │  Bot API│ remote.petfish.ai│        │                     │
└─────────────┘        └─────────────────┘        │  ┌───────────────┐  │
                                                   │  │ Session Bridge │  │
                                                   │  │  ↕ opencode   │  │
                                                   │  └───────────────┘  │
                                                   └─────────────────────┘
```

**Three components / 三大组件:**

| Component | Role | Runs on |
|-----------|------|---------|
| **Bot Server** | Telegram bot + connector registry | Cloud (remote.petfish.ai or self-hosted) |
| **Connector** | Maintains WebSocket to server, manages session bridges | Your dev machine |
| **Session Bridge** | Injects prompts into a running opencode session, collects output | Per opencode process |

## Quick Start 快速开始

### 1. Get a token 获取 Token

Send `/start` to [@petfish_bot](https://t.me/petfish_bot) on Telegram. You'll receive a one-time setup token.

### 2. Install 安装

```bash
curl -sSL https://remote.petfish.ai/install | bash -s -- <token>
```

Done. Your connector is running. Send any message in Telegram to start controlling opencode.

**Windows?** See the [full install & upgrade guide](./docs/install.md) for PowerShell instructions.

### 3. Use 使用

| Action | How |
|--------|-----|
| Send instruction | Just type in Telegram (default = ask mode) |
| Switch project | `/pf use <project-id>` |
| Show menu | `/pf` (InlineKeyboard) |
| New session | `/pf new` |
| List projects | `/pf list` |

## Features 特性

- **Default Ask Mode** — Text messages go directly to opencode (no prefix needed)
- **InlineKeyboard** — `/pf` shows a button menu for common actions
- **Multi-Project** — One connector can bridge multiple project workspaces
- **Auto-Update** — Connector checks server version on start, auto-upgrades if outdated
- **Session Management** — Create fresh sessions, see output in real-time with typing indicators
- **Secure** — Token-based auth, encrypted WebSocket, user allowlist
- **AI Agent Integration** — Add to AGENTS.md for auto-start on every opencode session
- **One-Liner Install** — `curl | bash` with dynamic server URL injection

## Documentation 文档

| | 中文 | English |
|--|------|---------|
| Install Guide | — | [Install & Upgrade](./docs/install.md) |
| Client Guide | [客户端指南](./docs/zh/client-guide.md) | [Client Guide](./docs/en/client-guide.md) |
| Server Guide | [服务器部署](./docs/zh/server-guide.md) | [Server Guide](./docs/en/server-guide.md) |
| Web | [remote.petfish.ai](https://remote.petfish.ai) | [remote.petfish.ai](https://remote.petfish.ai) |

## Self-Hosting 自部署

Want to run your own bot server? See the [Server Deployment Guide](./docs/en/server-guide.md).

Requirements: Node.js ≥ 20, systemd, nginx, domain + SSL, Telegram bot token.

## Development 开发

```bash
git clone https://github.com/kylecui/petfish_remote.git
cd petfish_remote
npm install
npm run dev        # Watch mode
npm run build      # Compile
npm run test       # 19 tests
npm run typecheck  # Type check
```

## Tech Stack

- TypeScript / Node.js (ESM)
- grammY (Telegram Bot)
- WebSocket (ws)
- YAML + Zod (Config validation)

## License

MIT
