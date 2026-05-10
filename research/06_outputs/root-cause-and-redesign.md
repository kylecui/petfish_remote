# 胖鱼遥控器 opencode 集成：根因诊断与架构重设计

**研究状态**: 完成  
**日期**: 2026-05-10  
**研究范围**: petfish_remote 与 opencode server 的集成架构

---

## 执行摘要

petfish_remote 不稳定的根因不是 `opencode serve` vs `opencode` 的选择问题。opencode 启动时（无论 TUI 还是 headless）已自带完整的 HTTP server + OpenAPI 3.1 + SSE 事件流 + TypeScript SDK。**问题在于我们绕过了 opencode 的原生 API，用了错误的接口表面。**

三个核心错误：
1. 通过 `/tui/*` 端点注入 prompt（TUI 耦合）
2. 按 `time.updated` 排序发现 session（session 漂移）
3. 依赖 `/session/status` 全局 busy 判断完成（settlement 死锁）

修复方案已在设计文档中详细定义（5阶段计划），但**一行代码都没有实施**。

---

## 1. opencode 机制：用户的直觉是对的

### 1.1 TUI + Server 架构

opencode 官方文档原文：

> "When you run `opencode` it starts a TUI and a server. Where the TUI is the client that talks to the server."

```
opencode（正常启动）
  ├── HTTP Server  ← OpenAPI 3.1, SSE, 所有 API
  └── TUI Client   ← 作为 server 的一个客户端连接
```

- 启动 `opencode` 时，server **已经自动启动**
- 可以通过 `--hostname` 和 `--port` 固定端口
- `opencode serve` 是**独立的 headless server**，不附带 TUI
- 如果 TUI 已在运行，`opencode serve` 会启动一个**新的 server 实例**

**结论：用户说"启动 opencode 时已经是 TUI+Server 模式"完全正确。不需要额外的 `opencode serve` 来获得 API 能力。**

### 1.2 opencode 提供的原生能力

| 能力 | 内置？ | 我们是否正确使用 |
|------|--------|-----------------|
| HTTP server | ✅ | ⚠ 使用了，但走错误端点 |
| OpenAPI 3.1 spec | ✅ | ❌ 未利用 |
| TypeScript SDK (`@opencode-ai/sdk`) | ✅ | ❌ 未使用，用 `execSync(curl)` 代替 |
| Session CRUD | ✅ | ⚠ 部分使用，但发现逻辑有缺陷 |
| 发送消息（同步/异步） | ✅ | ❌ 用 `/tui/*` 代替 |
| SSE 实时事件流 | ✅ | ⚠ 已连接，但未正确作为 settlement 依据 |
| 多客户端支持 | ✅ | ❌ 架构不支持多客户端共享 |
| 结构化输出（JSON schema） | ✅ | ❌ 未使用 |
| mDNS 发现 | ✅ | ❌ 未使用 |

### 1.3 正确的 API 端点

| 用途 | 正确端点 | 我们用的 |
|------|---------|---------|
| 发送 prompt | `POST /session/:id/message`（同步）或 `POST /session/:id/prompt_async`（异步） | `/tui/clear-prompt` → `/tui/append-prompt` → `/tui/submit-prompt` |
| 获取 session | `GET /session` + 显式绑定 rootSessionId | `GET /session` + 按 `time.updated` 排序取最新 |
| 判断完成 | SSE `/event` 中的 `session.idle` 事件 | `GET /session/status` 轮询全局 busy |
| 获取消息 | `GET /session/:id/message` | SSE 事件流拼装 |
| HTTP 调用 | `@opencode-ai/sdk` 的 typed client | `execSync(curl ...)` 阻塞调用 |

---

## 2. 根因诊断：三个结构性失败

### 2.1 Wrong-session attachment（session 漂移）

**现象**: IM 用户发送的消息偶尔被投递到错误的 session，或者 PC 端 TUI 的操作干扰 IM 端的 session 绑定。

**根因**: `discoverSession()` 按 `time.updated` 降序排列所有 session，取第一个。

```typescript
// OpenCodeBridge.ts — 当前实现
sessions.sort((a, b) => b.time.updated - a.time.updated);
return sessions[0].id;
```

问题：
- opencode 会创建 child session（subagent 任务）
- child session 的 `time.updated` 会比 root session 更新
- 导致 `discoverSession()` 返回 child session ID
- IM 用户的下一条消息被发送到一个 child session——用户看不到响应

**证据**: git log 中有 15+ commits 修复 session 绑定问题，包括 "fix session discovery regression"、"add session validation"、"prevent child session hijack" 等。

### 2.2 Indefinite busy / settlement 死锁

**现象**: IM 用户发送消息后，系统长时间显示"处理中"不返回结果，或者超时。

**根因**: 使用 `/session/status` 全局 busy 状态作为 settlement 判断依据。

```typescript
// OpenCodeBridge.ts — 当前实现
isSessionBusyByStatus() {
  const result = execSync(`curl -s http://...${this.port}/session/status`);
  // 解析全局 busy 状态
}
```

问题：
- `/session/status` 返回**所有** session 的状态
- 如果任意 session（包括无关的 child session）处于 busy 状态，全局就是 busy
- 我们的 settlement 逻辑等待全局 non-busy，但无关 session 可能永远不结束
- 结果：settlement 超时 → 用户收不到响应

### 2.3 TUI 耦合的 prompt 注入

**现象**: prompt 发送偶尔失败，或者与 PC 端 TUI 操作冲突。

**根因**: 使用 `/tui/*` 端点注入 prompt。

```typescript
// OpenCodeBridge.ts — 当前实现
await doPost('/tui/clear-prompt', clearBody);
await doPost('/tui/append-prompt', appendBody);
await doPost('/tui/submit-prompt', submitBody);
```

问题：
- `/tui/*` 端点设计用途是**远程控制 TUI 界面**（如 IDE 插件），不是发送消息
- 三步操作不是原子的：clear → append → submit 之间可能被 TUI 用户操作打断
- 如果 PC 端用户正在 TUI 中输入，`clear-prompt` 会清掉用户正在编辑的内容
- 如果 TUI 未运行（headless 模式），`/tui/*` 端点的行为未定义

### 2.4 附加问题：`execSync(curl)` 阻塞

`isSessionBusyByStatus()`、`discoverPort()`、`discoverSession()`、`requestNewSession()` 等方法大量使用 `execSync(curl ...)` 做同步 HTTP 调用。

问题：
- `execSync` 会阻塞 Node.js 事件循环
- 在 curl 等待期间，所有 SSE 事件、WebSocket 消息、定时器都被冻结
- 如果 curl 超时（默认 30s），整个 bot 冻结 30 秒
- 与 grammY bot 的 long-poll 循环冲突——poll 回调无法执行

---

## 3. 架构重设计方案

### 3.1 目标架构

```
┌─────────────────────────────────────────────┐
│                petfish_remote               │
│                                             │
│  ┌───────────┐    ┌──────────────────────┐  │
│  │ Telegram  │    │   OpenCode Client    │  │
│  │ Bot       │◄──►│   (@opencode-ai/sdk) │  │
│  │ (grammY)  │    │                      │  │
│  ├───────────┤    │  - typed API calls   │  │
│  │ Feishu    │    │  - SSE event stream  │  │
│  │ Bot       │◄──►│  - session binding   │  │
│  └───────────┘    │  - request tracking  │  │
│                   └──────────┬───────────┘  │
└──────────────────────────────┼──────────────┘
                               │ HTTP (localhost)
                    ┌──────────▼───────────┐
                    │   opencode server    │
                    │   (TUI or headless)  │
                    │                      │
                    │  /session/:id/message │
                    │  /session/:id/prompt  │
                    │  /event (SSE)        │
                    └──────────────────────┘
```

### 3.2 关键设计决策

#### 决策 1: 使用 `@opencode-ai/sdk` 替换所有 `execSync(curl)`

```typescript
// Before (阻塞，无类型安全)
const result = execSync(`curl -s http://localhost:${port}/session`);
const sessions = JSON.parse(result.toString());

// After (异步，完全类型安全)
import { createOpencodeClient } from "@opencode-ai/sdk"
const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` })
const { data: sessions } = await client.session.list()
```

#### 决策 2: 使用 `POST /session/:id/message` 替换 `/tui/*` 三步注入

```typescript
// Before (非原子，TUI 耦合)
await doPost('/tui/clear-prompt', {});
await doPost('/tui/append-prompt', { text: userMessage });
await doPost('/tui/submit-prompt', {});

// After (原子，独立于 TUI)
const result = await client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: userMessage }],
  },
})
// result.data 包含完整的 AI 响应
```

对于不需要等待响应的场景（如长时间任务）：

```typescript
// 异步发送，通过 SSE 获取结果
await client.session.promptAsync({
  path: { id: sessionId },
  body: { parts: [{ type: "text", text: userMessage }] },
})
// 在 SSE 事件流中监听 session.idle 判断完成
```

#### 决策 3: 显式 root-session 绑定替换 latest-updated 排序

```typescript
// Before (漂移风险)
const sessions = await client.session.list();
sessions.sort((a, b) => b.time.updated - a.time.updated);
return sessions[0].id; // 可能是 child session

// After (显式绑定)
class SessionRegistry {
  private rootSessionId: string | null = null;

  async getOrCreateRootSession(): Promise<string> {
    if (this.rootSessionId) {
      // 验证 session 仍然存在
      try {
        await client.session.get({ path: { id: this.rootSessionId } });
        return this.rootSessionId;
      } catch {
        this.rootSessionId = null;
      }
    }

    // 创建新 session
    const { data: session } = await client.session.create({
      body: { title: "petfish-remote" },
    });
    this.rootSessionId = session.id;
    return this.rootSessionId;
  }
}
```

#### 决策 4: SSE 事件流 + request-correlated 状态机替换全局 busy 轮询

```typescript
// Before (全局 busy 死锁)
while (isSessionBusyByStatus()) {
  await sleep(1000);
}

// After (request-correlated)
class RequestTracker {
  private pending = new Map<string, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
  }>();

  async sendAndWait(sessionId: string, text: string): Promise<MessagePart[]> {
    // 方式 A: 同步 API（最简单）
    const result = await client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text }] },
    });
    return result.data.parts;

    // 方式 B: 异步 API + SSE（用于流式响应）
    // 1. 发送异步请求
    // 2. 在 SSE 中监听 message.part.updated 事件获取流式内容
    // 3. 在 SSE 中监听 session.idle 事件判断完成
  }
}
```

### 3.3 实施路线（基于已有设计文档，重新排序）

| 阶段 | 内容 | 预估工作量 | 影响 |
|------|------|----------|------|
| **Phase 0** | 引入 `@opencode-ai/sdk`，替换所有 `execSync(curl)` | 1-2天 | 消除事件循环阻塞 |
| **Phase 1** | 替换 `/tui/*` 为 `/session/:id/message` | 1天 | 消除 TUI 耦合和竞争条件 |
| **Phase 2** | 实现 root-session 显式绑定 | 1天 | 消除 session 漂移 |
| **Phase 3** | 使用 SSE `session.idle` 替换全局 busy 轮询 | 1天 | 消除 settlement 死锁 |
| **Phase 4** | IM 独立交互模型（可选） | 2-3天 | IM 用户体验独立于 TUI |

Phase 0-3 是**必要修复**，Phase 4 是**体验增强**。

### 3.4 连接策略

有两种连接模式可选：

**模式 A: 连接到用户已启动的 TUI**（当前场景）

```bash
# 用户在 PC 上启动 opencode，固定端口
opencode --port=4096
```

```typescript
// petfish_remote 连接到已运行的 server
const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })
```

优点：PC 和 IM 共享同一个 opencode 实例和 session。
缺点：依赖用户手动启动 opencode。

**模式 B: petfish_remote 自行管理 opencode 实例**

```typescript
// 使用 SDK 启动 headless server
import { createOpencode } from "@opencode-ai/sdk"
const { client, server } = await createOpencode({
  hostname: "127.0.0.1",
  port: 4096,
})
```

优点：完全自主，无需用户操作。
缺点：PC 端 TUI 需要另外连接（或不使用 TUI）。

**推荐：先实现模式 A**（连接已运行 TUI），这是用户当前的使用场景。模式 B 作为后续可选功能。

---

## 4. 与设计文档的关系

### 4.1 已有设计文档的价值

以下设计文档对问题的诊断是正确的：

- `docs/design/shared-session-architecture.md` — 正确识别了三个结构性失败
- `docs/design/phase-1-root-session-binding.md` — Phase 1 任务分解详细可用
- `docs/design/phase-2-request-lifecycle.md` — Phase 2 任务分解详细可用
- `docs/design/shared-session-implementation-plan.md` — 5阶段计划方向正确

### 4.2 设计文档的不足

1. **没有提到 `@opencode-ai/sdk`** — 所有设计文档仍假设用 HTTP 直接调用，未考虑使用官方 SDK
2. **未区分 `/tui/*` 和 `/session/:id/message`** — 设计文档提到要替换 TUI 端点，但没有明确指出正确端点是什么
3. **Phase 0（消除 execSync）未被识别为独立阶段** — 事件循环阻塞是一个独立的严重问题
4. **一行代码都没有实施** — 设计文档写于数周前，但实际代码未做任何改变

---

## 5. 关键证据索引

| 证据 | 来源 | 结论 |
|------|------|------|
| "opencode starts a TUI and a server" | opencode.ai/docs/server | 用户直觉正确，TUI 已含 server |
| `POST /session/:id/message` 存在 | opencode.ai/docs/server API 列表 | 不需要 `/tui/*` 注入 |
| `POST /session/:id/prompt_async` 存在 | opencode.ai/docs/server API 列表 | 异步发送 prompt 有原生支持 |
| `session.idle` SSE 事件存在 | opencode SDK types.gen.ts | 不需要轮询 `/session/status` |
| `@opencode-ai/sdk` 提供 typed client | opencode.ai/docs/sdk | 不需要 `execSync(curl)` |
| 15+ git commits 修 session 绑定 | petfish_remote git log | session 漂移是反复出现的问题 |
| `discoverSession()` 按 `time.updated` 排序 | OpenCodeBridge.ts 源码 | 直接证据：session 漂移根因 |
| `isSessionBusyByStatus()` 用 `execSync` | OpenCodeBridge.ts 源码 | 直接证据：事件循环阻塞 |
| 设计文档 5阶段计划完整但未实施 | docs/design/*.md | 方案存在但未执行 |

---

## 6. 一句话结论

**停止发明轮子，用 opencode 原生 SDK 和 API。**

把 `OpenCodeBridge.ts` 中的 935 行代码替换为基于 `@opencode-ai/sdk` 的 ~200 行实现：
- `createOpencodeClient()` 替换 `execSync(curl)`
- `client.session.prompt()` 替换 `/tui/*` 三步注入
- 显式 `rootSessionId` 替换 `discoverSession()` 排序
- `session.idle` SSE 事件替换 `isSessionBusyByStatus()` 轮询

预计 Phase 0-3 总工作量：4-5 天。

---

## 附录 A: opencode 完整 API 端点清单

见 librarian agent 研究结果中的完整 API 表格。

## 附录 B: opencode SDK 使用示例

见 librarian agent 研究结果中的代码示例。
