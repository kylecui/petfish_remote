# Development Guide

## Prerequisites

- Node.js ≥ 20
- npm

## Setup

```bash
git clone https://github.com/kylecui/petfish_remote.git
cd petfish_remote
npm install
```

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| dev | `npm run dev` | Watch mode with tsx (auto-restart on changes) |
| build | `npm run build` | Compile TypeScript to `dist/` |
| start | `npm run start` | Run compiled bot server |
| start:connector | `npm run start:connector` | Run compiled connector only |
| typecheck | `npm run typecheck` | Type-check without emitting (`tsc --noEmit`) |
| lint | `npm run lint` | Run ESLint on `src/` |
| test | `npm run test` | Run tests once with vitest |
| test:watch | `npm run test:watch` | Run tests in watch mode |

## Project Structure

```
src/
├── main.ts                  # Bot server entry point
├── config.ts                # YAML config loader + Zod validation
├── types.ts                 # Shared types (Platform, ChatEvent, ChatResponse, etc.)
├── adapters/                # IM platform adapters
│   ├── types.ts             # IMAdapter interface
│   ├── telegram/            # Telegram adapter (grammY)
│   ├── slack/               # Slack adapter (@slack/bolt, Socket Mode)
│   ├── feishu/              # Feishu/Lark adapter (@larksuiteoapi/node-sdk)
│   ├── wecom/               # WeCom adapter (@wecom/aibot-node-sdk)
│   └── web/                 # Web UI adapter (vanilla HTML/CSS/JS)
├── core/                    # Business logic
│   ├── CommandRouter.ts     # Parse /pf commands and natural language
│   ├── PolicyEngine.ts      # Command whitelist + task policy evaluation
│   ├── TaskManager.ts       # Task lifecycle with state machine
│   ├── SessionManager.ts    # Per-user session tracking
│   ├── ProjectRegistry.ts   # Project registration + routing
│   ├── AuditLogger.ts       # Audit trail
│   └── ApprovalManager.ts   # Approval queue for sensitive actions
├── connector/               # Connector (runs on dev machine)
│   ├── main.ts              # Connector entry point
│   └── bridges/             # OpenCodeBridge, OpencodeClient (SDK wrapper)
├── protocol/                # WebSocket protocol (Envelope, MSG types, Zod schemas)
├── server/                  # ConnectorGateway (HTTP + WebSocket server)
├── runtime/                 # RuntimeRouter, LocalRuntime, RemoteRuntime
├── render/                  # MessageRenderer, OutputBatcher, render policies
├── plugin/                  # opencode Bun plugin (tool interception, permission auto-handling)
└── storage/                 # SQLite persistence
```

## TypeScript Configuration

- Target: ES2022, Module: Node16
- Strict mode enabled
- `noUnusedLocals` and `noUnusedParameters` enforced
- ESM (`"type": "module"` in package.json)

All imports use `.js` extensions (Node16 module resolution).

## Testing

Tests use [vitest](https://vitest.dev/) and live in the `tests/` directory. The test suite includes **95 tests across 8 test files** covering protocol, adapters, core, and rendering.

```bash
npm run test           # single run
npm run test:watch     # watch mode
```

## Architecture Overview

PetFish Remote has three runtime components:

1. **Bot Server** (`npm run start`) — receives messages from Telegram, Slack, Feishu, WeCom, or Web, manages connector registry, dispatches tasks over WebSocket
2. **Connector** (`npm run start:connector`) — runs on your dev machine, receives tasks from the bot server, bridges to opencode via SDK
3. **Session Bridge** (inside connector) — manages per-opencode-session communication using `@opencode-ai/sdk`

### Key Design Patterns

- **State machine**: `TaskManager` enforces valid status transitions via `VALID_TRANSITIONS` table. Terminal states (`completed`, `failed`, `cancelled`, `timeout`) accept no outbound transitions.
- **Policy evaluation**: `PolicyEngine.evaluate()` runs before every task dispatch. `evaluateCommand()` checks command whitelist before execution.
- **Adapter abstraction**: `IMAdapter` interface decouples platform-specific logic. Each adapter handles `sendMessage(ChatResponse)`, typing indicators, and interactive elements.
- **Output batching**: `OutputBatcher` collects streaming chunks and flushes on intervals, respecting per-platform character limits (Telegram: 4096, Slack: 3000, Feishu: 30000, WeCom: 4000, Web: 65536).

## Configuration

Config files live in `./config/` (override with `PETFISH_CONFIG_DIR` env var):

- `server.yaml` — bot server settings (port, adapters, auth)
- `connector.yaml` — connector settings (server URL, token, projects)

See `src/config.ts` for the full Zod schema.

## License

Split license model — see [LICENSE](../LICENSE) (Apache-2.0 for connector/protocol) and [LICENSE-SERVER](../LICENSE-SERVER) (proprietary for server/adapters/core).
