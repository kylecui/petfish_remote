# PetFish Remote

> Control your opencode AI agent from anywhere — Telegram, Slack, Feishu, WeCom, or Web.

## Architecture

```
┌─────────────┐
│  Telegram   │◄──┐
├─────────────┤   │
│   Slack     │◄──┤     ┌─────────────────┐        ┌─────────────────────┐
├─────────────┤   ├────►│   Bot Server    │◄──WSS──►│  Connector         │
│   Feishu    │◄──┤     │ remote.petfish.ai│        │                     │
├─────────────┤   │     └─────────────────┘        │  ┌───────────────┐  │
│   WeCom     │◄──┤                                │  │ Session Bridge │  │
├─────────────┤   │                                │  │  ↕ opencode   │  │
│   Web UI    │◄──┘                                │  └───────────────┘  │
└─────────────┘                                    └─────────────────────┘
```

**Three components:**

| Component | Role | Runs on |
|-----------|------|---------|
| **Bot Server** | Multi-platform bot + connector registry | Cloud (remote.petfish.ai or self-hosted) |
| **Connector** | Maintains WebSocket to server, manages session bridges | Your dev machine |
| **Session Bridge** | Injects prompts into a running opencode session, collects output | Per opencode process |

## Features

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

## Documentation

- [Client Guide](./client-guide.md)
- [Server Guide](./server-guide.md)
- [Install & Upgrade](../install.md)
- [API Reference](../api.md)
- [Architecture](../architecture.md)
- [Security Model](../security-model.md)
- [Deployment](../deployment.md)
- [opencode Integration](../opencode-integration.md)
- [Agent Setup](../agent-install.md) · [Upgrade](../agent-upgrade.md)
- [Development](../development.md) · [Contributing](../../CONTRIBUTING.md)
- [Roadmap](../roadmap.md)
- [Changelog](../../CHANGELOG.md)

## Status

Project version: 0.4.x (Beta)
