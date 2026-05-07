# Feishu Adapter Implementation Plan

## Context

PetFish Remote currently supports Telegram as the sole IM platform. We're adding Feishu (飞书/Lark) as a second platform, running simultaneously on the same server instance. This requires extracting an adapter interface from the existing monolithic TelegramAdapter and building a parallel FeishuAdapter.

## Current State

- **TelegramAdapter**: Concrete class, no base class or interface. Uses grammY library.
- **Integration**: Direct instantiation in `main.ts`, callback injection for inbound events, setter methods for reply handlers.
- **OutputBatcher**: Hardcodes `TELEGRAM_MAX_MESSAGE_LENGTH = 4096` and Telegram markdown formatting.
- **Core layer** (`TaskManager`, `SessionManager`, `CommandRouter`, etc.): Fully platform-agnostic.
- **Platform-agnostic types**: `ChatEvent`, `ChatResponse` in `src/types.ts`.

## Architecture Decision

### IMAdapter Interface + BaseIMAdapter Abstract Class

```typescript
type Platform = 'telegram' | 'feishu';
type Unsubscribe = () => void;

// Outbound interactive messages (questions, permissions)
type OutboundInteraction =
  | { type: 'question'; chatId: string; questionId: string; prompt: string;
      options?: Array<{ id: string; label: string }>; allowFreeText?: boolean }
  | { type: 'permission'; chatId: string; taskId: string; permissionId: string;
      tool: string; input: Record<string, unknown> };

// Inbound replies to interactive messages
type InteractionReply =
  | { type: 'question'; chatId: string; userId: string; questionId: string; answer: string }
  | { type: 'permission'; chatId: string; userId: string; taskId: string;
      permissionId: string; approved: boolean };

// Unified inbound event stream
type AdapterInboundEvent =
  | { type: 'message'; event: ChatEvent }
  | { type: 'interactionReply'; event: InteractionReply }
  | { type: 'error'; error: Error };

// Public contract
interface IMAdapter {
  readonly platform: Platform;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(response: ChatResponse): Promise<void>;
  sendTyping(chatId: string): Promise<void>;
  sendInteraction(request: OutboundInteraction): Promise<void>;
  onEvent(handler: (event: AdapterInboundEvent) => void): Unsubscribe;
}
```

### BaseIMAdapter (shared logic)

Provides:
- Typed event emitter (`emit` / `onEvent` / `listeners`)
- Pending interaction tracking (`pendingByChat` map)
- Free-text reply consumption (`tryConsumeFreeTextReply`)

### MessageRenderPolicy (decouple OutputBatcher)

```typescript
interface MessageRenderPolicy {
  maxLength: number;
  render(response: ChatResponse): string;
  split(rendered: string): string[];
}
```

Each adapter creates its own OutputBatcher with platform-specific policy.

### Design Rationale

1. **Interface + abstract class**: Interface for public contract (main.ts depends on this), abstract class for shared state/event plumbing. Avoids single-inheritance lock-in.
2. **Unified event stream** replaces constructor callback + setQuestionReplyHandler + setPermissionReplyHandler. Scales to N adapters.
3. **`sendInteraction` discriminated union** instead of separate `sendQuestion`/`sendPermission` methods. Abstracts business intent, not platform primitives.
4. **Adapter-owned batcher**: Each adapter composes OutputBatcher with its own RenderPolicy. OutputBatcher stays platform-ignorant.
5. **Rendering at adapter boundary**: `ChatResponse.text` carries raw content. Markdown/formatting applied by adapter's render policy, not by core.

## Implementation Phases

### Phase 1: Extract Interface + Refactor TelegramAdapter

**Files changed:**
- NEW: `src/adapters/types.ts` — IMAdapter, BaseIMAdapter, OutboundInteraction, InteractionReply, AdapterInboundEvent, MessageRenderPolicy
- MODIFY: `src/adapters/telegram/TelegramAdapter.ts` — extend BaseIMAdapter, implement IMAdapter, replace callbacks with emit()
- MODIFY: `src/main.ts` — use IMAdapter interface, subscribe via adapter.onEvent()
- MODIFY: `src/types.ts` — add Platform type, ensure ChatEvent/ChatResponse are clean

**Success criteria:**
- All 36 existing tests pass
- Typecheck clean
- Behavior unchanged (Telegram still works identically)
- main.ts references IMAdapter interface, not TelegramAdapter directly

**Risk:** Low — pure refactor, no new behavior.

### Phase 2: Decouple OutputBatcher

**Files changed:**
- MODIFY: `src/render/OutputBatcher.ts` — accept MessageRenderPolicy, remove hardcoded TELEGRAM constants
- NEW: `src/adapters/telegram/telegramRenderPolicy.ts` — maxLength: 4096, Telegram markdown formatting, split logic
- MODIFY: `src/adapters/telegram/TelegramAdapter.ts` — instantiate batcher with telegramRenderPolicy

**Success criteria:**
- All tests pass
- OutputBatcher has no Telegram-specific imports or constants
- Telegram behavior unchanged

**Risk:** Low — parameterize existing code.

### Phase 3: Implement FeishuAdapter

**Files created:**
- `src/adapters/feishu/FeishuAdapter.ts` — main adapter class
- `src/adapters/feishu/feishuRenderPolicy.ts` — maxLength: 30000, Feishu card markdown
- `src/adapters/feishu/feishuTypes.ts` — Feishu-specific type conversions

**Feishu platform mapping:**
| Feature | Implementation |
|---------|---------------|
| Transport | `Lark.WSClient` (WebSocket, no public IP needed) |
| Receive messages | `im.message.receive_v1` event |
| Send text | `client.im.message.create` with `msg_type: 'text'` |
| Send rich content | Interactive card (msg_type: 'interactive', Schema 2.0) |
| Buttons (questions) | Card buttons with `value` payload |
| Button callbacks | `card.action.trigger` event |
| Typing indicator | Placeholder card → `im.message.patch` to update in-place |
| Markdown | Only inside card `{tag: 'markdown'}` elements |

**Dependencies:**
- `@larksuiteoapi/node-sdk` (official, TypeScript, v1.62.1)

**Config:**
- `FEISHU_APP_ID` — from Feishu developer console
- `FEISHU_APP_SECRET` — from Feishu developer console
- `FEISHU_DOMAIN` — 'feishu' (China) or 'lark' (international)

**Success criteria:**
- FeishuAdapter implements IMAdapter
- Can receive messages and reply
- Interactive cards work for questions/permissions
- Render policy handles Feishu markdown + length limits

**Risk:** Medium — new platform integration, SDK behavior to validate.

### Phase 3.5: Platform-aware Session/Storage Keys

**Problem:** `SessionManager` and SQLite storage key sessions by bare `chat_id`. With two platforms sharing the server, `chat_id` values can collide across platforms (e.g., Telegram numeric ID vs Feishu `ou_` string could theoretically overlap in maps).

**Files changed:**
- MODIFY: `src/core/SessionManager.ts` — use composite key `${platform}:${chatId}` internally
- MODIFY: `src/storage/sqlite.ts` — add `platform` column to sessions/tasks tables, migrate schema
- MODIFY: `src/main.ts` — pass `platform` from ChatEvent when creating/looking up sessions
- MODIFY: `src/types.ts` — ensure `ChatEvent.platform` is always populated

**Migration:** Add `platform TEXT DEFAULT 'telegram'` column to existing tables. Existing rows default to 'telegram'.

**Success criteria:**
- Existing Telegram sessions continue working (migration preserves data)
- Two adapters can independently maintain sessions without key collision
- All reply-routing maps (questions, permissions, tasks) are platform-scoped

**Risk:** Medium — schema migration, must not lose existing data.

### Phase 4: Multi-adapter Routing in main.ts

**Files changed:**
- MODIFY: `src/main.ts` — config-driven adapter instantiation, all adapters share same event router
- MODIFY: `src/config.ts` — add Feishu config schema (optional)

**Logic:**
```typescript
const adapters: IMAdapter[] = [];
if (process.env.TELEGRAM_BOT_TOKEN) adapters.push(new TelegramAdapter(...));
if (process.env.FEISHU_APP_ID) adapters.push(new FeishuAdapter(...));

const adapterMap = new Map<Platform, IMAdapter>();
for (const adapter of adapters) {
  adapterMap.set(adapter.platform, adapter);
  adapter.onEvent((evt) => handleInboundEvent(evt, adapter));
  await adapter.start();
}

// Responses route back via platform key
function getAdapter(platform: Platform): IMAdapter {
  return adapterMap.get(platform)!;
}
```

**Success criteria:**
- Server runs with Telegram only, Feishu only, or both — based on env vars
- Messages from either platform route through same core logic
- Responses go back to correct adapter based on ChatEvent.platform
- Session/task lookups are platform-scoped (no cross-platform leakage)

**Risk:** Low — wiring only (identity collision solved in Phase 3.5).

## Testing Strategy (Per-Phase QA)

### Phase 1 QA: Interface extraction
```bash
npm run typecheck   # Must pass — no type errors
npm run test        # All 36 existing tests pass (regression)
```
- Verify: `main.ts` imports `IMAdapter` from `src/adapters/types.ts`, not `TelegramAdapter` directly
- Verify: `TelegramAdapter` class signature shows `extends BaseIMAdapter implements IMAdapter`
- Manual: Send a message to @petfish_bot → confirm reply works as before

### Phase 2 QA: OutputBatcher decoupling
```bash
npm run typecheck
npm run test
```
- Verify: `OutputBatcher` has zero imports from `src/adapters/telegram/`
- Verify: grep for `4096` — only appears in `telegramRenderPolicy.ts`, not in OutputBatcher
- Add test: `OutputBatcher` with custom policy (maxLength: 100) correctly splits a 250-char message into 3 chunks

### Phase 3 QA: FeishuAdapter
```bash
npm run typecheck
npm run test        # Including new feishu adapter unit tests
```
- New tests (mocked SDK):
  - `FeishuAdapter.start()` connects WSClient
  - `FeishuAdapter.sendMessage()` calls `im.message.create` with correct payload
  - `FeishuAdapter.sendInteraction({ type: 'question' })` sends interactive card with buttons
  - `FeishuAdapter.onEvent` emits inbound message when `im.message.receive_v1` fires
  - `FeishuAdapter.onEvent` emits interactionReply when `card.action.trigger` fires
- Manual (requires Feishu test app):
  1. Create Feishu bot app → get APP_ID/APP_SECRET
  2. Set env vars, start server with `FEISHU_APP_ID` + `FEISHU_APP_SECRET`
  3. Send "hello" in Feishu chat → expect text reply echoed back
  4. Trigger a question → expect interactive card with buttons
  5. Click button → expect task proceeds with selected answer

### Phase 3.5 QA: Platform-aware keys
```bash
npm run typecheck
npm run test
```
- New tests:
  - SessionManager with platform='telegram' and platform='feishu' using same chatId → independent sessions
  - Storage migration: existing rows get `platform='telegram'` default
  - Reply routing: question reply from Telegram doesn't match Feishu pending question with same chatId
- Verify: SQLite schema has `platform` column in relevant tables

### Phase 4 QA: Multi-adapter routing
```bash
npm run typecheck
npm run test
```
- New test: Instantiate mock TelegramAdapter + mock FeishuAdapter → send events from both → verify both route to same core handler
- New test: Response with platform='feishu' routes to FeishuAdapter.sendMessage, not TelegramAdapter
- Verify: Server starts with only TELEGRAM_BOT_TOKEN set → no Feishu adapter instantiated (no crash)
- Verify: Server starts with only FEISHU_APP_ID set → no Telegram adapter instantiated
- Manual: Run with both env vars → send from Telegram AND Feishu → both work independently

## Constraints

- Do NOT break existing Telegram functionality at any phase
- Each phase committed separately with passing tests
- Feishu SDK (`@larksuiteoapi/node-sdk`) is a regular dependency in package.json. It's lightweight and tree-shakeable; the adapter simply won't be instantiated if env vars are absent.
- Website/docs update deferred until feature is stable

## Decisions (resolved)

1. **`@larksuiteoapi/node-sdk`**: Regular dependency. The package is small, TypeScript-native, and tree-shakeable. Optional/peer adds complexity for minimal gain since we control the deployment.
2. **User allowlist**: Per-platform. Each adapter has its own allowlist config (Telegram user IDs ≠ Feishu open_ids). Shared policy engine applies after identity resolution.
3. **Cross-platform control**: Yes — one connector can be controlled from both platforms. The connector is project-bound, not platform-bound. Session state is platform-scoped (separate sessions per platform), but both can dispatch tasks to the same connector.
