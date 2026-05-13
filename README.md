# PetFish Remote 胖鱼遥控器

> Control your opencode AI agent from anywhere — Telegram, Slack, Feishu, WeCom, or Web.
>
> 从任何平台遥控你的 opencode AI 编程助手。

[![Beta](https://img.shields.io/badge/status-beta-blue)](https://remote.petfish.ai)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Apache--2.0%20%2B%20Proprietary-blue)](./LICENSE)

## Architecture 架构

```
┌─────────────┐
│  Telegram   │◄──┐
├─────────────┤   │
│   Slack     │◄──┤     ┌─────────────────┐        ┌─────────────────────┐
├─────────────┤   ├────►│   Bot Server    │◄──WSS──►│  Connector (你的机器)  │
│   Feishu    │◄──┤     │ remote.petfish.ai│        │                     │
├─────────────┤   │     └─────────────────┘        │  ┌───────────────┐  │
│   WeCom     │◄──┤                                │  │ Session Bridge │  │
├─────────────┤   │                                │  │  ↕ opencode   │  │
│   Web UI    │◄──┘                                │  └───────────────┘  │
└─────────────┘                                    └─────────────────────┘
```

**Three components / 三大组件:**

| Component | Role | Runs on |
|-----------|------|---------|
| **Bot Server** | Multi-platform bot + connector registry | Cloud (remote.petfish.ai or self-hosted) |
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
| Send instruction | Just type in chat (default = ask mode) |
| Switch project | `/pf use <project-id>` |
| Show menu | `/pf` (InlineKeyboard / Block Kit / Card) |
| New session | `/pf new` |
| List projects | `/pf list` |
| Switch session | `/pf sessions` → `/pf switch <n>` |
| Override model | `/pf model <provider/model>` |
| Sub-agent control | `/pf agents` / `/pf subagents <silent\|summary\|verbose>` |
| Admin commands | `/pf users` / `/pf audit` / `/pf role` |

## Features 特性

- **Multi-Platform** — Telegram, Slack, Feishu (Lark), WeCom, and Web console
- **Default Ask Mode** — Text messages go directly to opencode (no prefix needed)
- **InlineKeyboard / Block Kit / Cards** — `/pf` shows native interactive menus per platform
- **Multi-Project** — One connector can bridge multiple project workspaces
- **Session Management** — Create, list, and switch sessions; real-time output with typing indicators
- **Sub-Agent Attribution** — Track child/sub-agent sessions under the root session, configurable verbosity (`silent`/`summary`/`verbose`)
- **Model Override** — `/pf model` to switch models mid-session (workaround for compaction bugs)
- **Multi-User Permissions** — Role-based access control (admin/operator/viewer) with 9-event audit trail
- **opencode Plugin** — Bun plugin with tool interception, permission auto-handling, and context injection
- **SSH Runtime** — Execute opencode on remote machines via SSH
- **Self-Daemonizing Connector** — Supervisor with auto-respawn, exponential backoff, PID management
- **Auto-Update** — Connector checks server version on start, auto-upgrades if outdated
- **Secure** — Token-based auth, encrypted WebSocket, user allowlist, policy engine
- **AI Agent Integration** — Add to AGENTS.md for auto-start on every opencode session
- **One-Liner Install** — `curl | bash` with dynamic server URL injection

## Documentation 文档

| | 中文 | English |
|--|------|---------|
| Install Guide | — | [Install & Upgrade](./docs/install.md) |
| Client Guide | [客户端指南](./docs/zh/client-guide.md) | [Client Guide](./docs/en/client-guide.md) |
| Server Guide | [服务器部署](./docs/zh/server-guide.md) | [Server Guide](./docs/en/server-guide.md) |
| API Reference | — | [API](./docs/api.md) |
| Architecture | — | [Architecture](./docs/architecture.md) |
| Security Model | — | [Security](./docs/security-model.md) |
| Deployment | — | [Deployment](./docs/deployment.md) |
| opencode Integration | — | [Integration](./docs/opencode-integration.md) |
| Agent Setup | — | [Install](./docs/agent-install.md) · [Upgrade](./docs/agent-upgrade.md) |
| Development | — | [Development Guide](./docs/development.md) · [Contributing](./CONTRIBUTING.md) |
| Roadmap | — | [Roadmap](./docs/roadmap.md) |
| Changelog | — | [CHANGELOG](./CHANGELOG.md) |
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
npm run test       # 95 tests across 8 files
npm run typecheck  # Type check
```

See the [Development Guide](./docs/development.md) for project structure, patterns, and configuration.

## Tech Stack

- **Language**: TypeScript / Node.js (ESM, strict mode)
- **Telegram**: grammY
- **Slack**: @slack/bolt (Socket Mode)
- **Feishu**: @larksuiteoapi/node-sdk
- **WeCom**: @wecom/aibot-node-sdk
- **opencode**: @opencode-ai/sdk
- **WebSocket**: ws (noServer mode with route-based upgrade)
- **Storage**: better-sqlite3
- **Config**: YAML + Zod validation
- **Testing**: vitest
- **Web UI**: Single-page dark-themed chat (vanilla HTML/CSS/JS)

## License

This project uses a split license model:

| Component | License | Directories |
|-----------|---------|-------------|
| Connector / Protocol | [Apache-2.0](./LICENSE) | `src/connector/`, `src/protocol/`, `src/opencode/`, `scripts/` |
| Server / Adapters / Runtime | [Proprietary](./LICENSE-SERVER) | `src/server/`, `src/adapters/`, `src/core/`, `src/runtime/`, `src/render/`, `src/storage/` |

Trademarks: See [TRADEMARKS.md](./TRADEMARKS.md).

Copyright 2026 PEtFiSh Contributors.
