> ℹ️ **Point-in-time review** from the V0.1 era. High-priority issues (P1, P2, P13) have been resolved in V0.2+. See [Architecture](./architecture.md) for the current design.

# PetFish Remote 技术架构审查报告

> 审查日期: 2026-05-08
> 审查范围: 全系统架构、状态机、注册流程、协议、存储、适配器
> 代码版本: commit 8326294 (dev branch)

---

## 1. 系统架构总览

### 1.1 组件拓扑

```
用户 (Telegram/Feishu)
    │
    ▼
┌─────────────────────────────────────────────┐
│  Bot Server (remote.petfish.ai:9100)        │
│                                             │
│  ┌─────────┐  ┌─────────┐                  │
│  │Telegram │  │ Feishu  │  ← IM Adapters   │
│  │Adapter  │  │Adapter  │                  │
│  └────┬────┘  └────┬────┘                  │
│       └──────┬─────┘                        │
│              ▼                              │
│  ┌──────────────────┐                       │
│  │    main.ts        │ ← 中央编排器          │
│  │  (handleChatEvent)│                      │
│  └────────┬─────────┘                       │
│           │                                 │
│  ┌────────▼─────────┐  ┌────────────────┐  │
│  │  CommandRouter    │  │ SessionManager │  │
│  │  TaskManager      │  │ PolicyEngine   │  │
│  │  ProjectRegistry  │  │ AuditLogger    │  │
│  └────────┬─────────┘  └────────────────┘  │
│           │                                 │
│  ┌────────▼─────────┐                       │
│  │  RuntimeRouter    │                      │
│  │  ├ LocalRuntime   │                      │
│  │  └ RemoteRuntime ─┼──► ConnectorGateway │
│  └──────────────────┘   │  (WebSocket)     │
│                          └────────┬────────┘│
└───────────────────────────────────┼─────────┘
                                    │ WSS
                         ┌──────────▼──────────┐
                         │  Connector Client    │
                         │  (用户开发机)         │
                         │  └ SessionBridge     │
                         │    └ opencode CLI    │
                         └─────────────────────┘
```

### 1.2 数据流向

```
入站: 用户消息 → Adapter → handleChatEvent → CommandRouter → TaskManager
      → RuntimeRouter → RemoteRuntime → WebSocket → Connector → opencode

出站: opencode stdout → Connector → WebSocket → RemoteRuntime → OutputBatcher
      → Adapter.sendMessage → 用户

交互: opencode question → TASK_QUESTION → Adapter InlineKeyboard/Card
      → 用户回答 → QUESTION_REPLY → opencode
```

### 1.3 技术栈

| 层      | 技术                  |
|---------|----------------------|
| 语言     | TypeScript (ESM)      |
| IM      | grammY (Telegram), Lark SDK (Feishu) |
| 传输     | WebSocket (ws库)      |
| 存储     | SQLite (better-sqlite3) |
| 配置     | YAML + Zod 校验        |
| 构建     | tsc, vitest           |

---

## 2. 状态机分析

### 2.1 Task 状态机

**定义位置**: `src/types.ts:5-14`

```
TaskStatus = 'created' | 'queued' | 'running' | 'waiting_approval'
           | 'waiting_user_input' | 'completed' | 'failed' | 'cancelled' | 'timeout'
```

**实际实现的状态转换** (`src/core/TaskManager.ts`):

```
created ──► queued     (runtime未连接时, line 69)
created ──► running    (runtime已连接, line 73)
created ──► failed     (project未找到, line 61)
running ──► completed  (exitCode === 0, line 89)
running ──► failed     (exitCode !== 0 或异常, lines 89/93)
  any   ──► cancelled  (用户取消, line 111)
```

#### 🔴 问题 P1: Task状态机缺少转换守卫

`updateStatus()` (line 102-108) 直接覆盖状态，不验证当前状态是否允许转换:

```typescript
public updateStatus(taskId: string, status: TaskStatus): void {
  const existing = this.storage.getTask(taskId);
  if (!existing) throw new Error(`Task not found: ${taskId}`);
  // ← 这里没有检查 existing.status 是否允许转换到 status
  this.storage.updateTask({ ...existing, status, updated_at: ... });
}
```

**风险**: 可以从 `completed → running`、`failed → created` 等无效转换。虽然目前调用方行为正确，但没有防御性保护。

#### 🔴 问题 P2: 3个已定义状态从未使用

- `waiting_approval`: 定义了但 TaskManager 从未设置此状态。PolicyEngine.evaluate() 存在但从未被 TaskManager 调用。
- `waiting_user_input`: 定义了但从未使用。
- `timeout`: 定义了但从未使用。超时由 OpenCodeCliRunner 处理，产生的是 `failed` 而非 `timeout`。

#### 🟡 问题 P3: Task状态测试为空壳

`tests/task-state.test.ts` 所有 8 个测试用例都是 `expect(true).toBe(true)` 占位符，无实际验证逻辑。

### 2.2 Session 状态

**定义位置**: `src/types.ts:104-113`

```typescript
interface SessionState {
  id: string;
  platform: Platform;
  chat_id: string;
  project_id: string;
  opencode_session_id?: string;
  active_task_id?: string;
  mode: ExecutionMode;
  updated_at: string;
}
```

**评估**: SessionManager (`src/core/SessionManager.ts`) 不是状态机，是简单的 CRUD 封装。这对当前需求是合理的 —— Session 只需要记录"当前绑定了哪个项目"和"当前活跃的 task"。

#### 🟡 问题 P4: Session 默认模式硬编码为 'suggest'

`SessionManager.bindProject()` (line 30) 创建新 session 时硬编码 `mode: 'suggest'`，但实际 dispatch 时 `handleChatEvent` 中的 `ask` 命令使用 `'read_only'`。两者不一致，虽然 mode 字段目前主要用于 display。

### 2.3 Connector 生命周期

**定义位置**: `src/server/ConnectorRegistry.ts`

```
unregistered ──► registered      (WebSocket连接 + REGISTER消息认证通过)
registered   ──► disconnected    (WebSocket关闭, 进入60s grace window)
disconnected ──► registered      (60s内重连成功)
disconnected ──► unregistered    (60s超时, grace window过期)
     any     ──► unregistered    (显式 unregister)
```

**评估**: 这是全系统实现最健壮的状态机:
- 有明确的 grace window (60s)
- 断开时消息排队，重连后 drain
- 定时器管理正确（重连时清除旧 timer）
- 替换旧连接时正确关闭前一个 WebSocket

✅ Connector 生命周期设计合理，无明显问题。

### 2.4 Adapter 生命周期

Adapter 没有显式状态机，只有 `start()` / `stop()` 方法。在本次 session 中添加了 `adapterStatuses` 追踪 (`starting` / `connected` / `error: ...`)。

#### 🟡 问题 P5: Adapter 缺少重连/恢复机制

- Telegram: `bot.start()` 在后台运行，如果 polling 停止（如网络问题），无法自动恢复。
- Feishu: WebSocket 断开后无重连逻辑（依赖 Lark SDK 内部处理）。
- 两个 adapter 都没有错误状态恢复能力。

---

## 3. 注册流程分析

### 3.1 完整注册链路

```
1. 用户在 IM 发送 /start
   → Adapter 调用 deps.generateRegistrationToken(userId)
   → RegistrationService.generateToken() 生成 16-byte hex token
   → 返回给用户（5分钟TTL）

2. 用户在开发机运行 curl install.sh | bash -- <token>
   → Installer 调用 POST /api/register
   → 验证 token → 生成 connectorToken (32-byte base64url)
   → 持久化 userId → connectorToken, userId → projectId 到 SQLite
   → 返回 { connectorToken, projectId, serverUrl }

3. Connector 启动，WebSocket 连接
   → 发送 REGISTER { connectorId, token: connectorToken, hostname, projects }
   → ConnectorAuth.verify() 校验 token
   → RegistrationService.resolveUserByToken() 解析 userId
   → ConnectorRegistry.register() 注册连接
   → 自动将 projects 添加到 ProjectRegistry

4. (可选) 多平台绑定
   → 新平台 /start 获取 registrationToken
   → POST /api/add-platform { registrationToken, connectorToken, projectId }
   → 验证两个 token → 绑定 newUserId → projectId
```

### 3.2 Token 体系

| Token 类型 | 生成方式 | 长度 | TTL | 持久化 | 用途 |
|-----------|---------|------|-----|--------|------|
| Registration Token | `randomBytes(16).hex()` | 32 chars hex | 5 min | ❌ 仅内存 | 一次性注册凭证 |
| Connector Token | `randomBytes(32).base64url()` | ~43 chars | 永久 | ✅ SQLite | WebSocket 认证 |

#### 🟡 问题 P6: Registration Token 不持久化

服务重启后所有 pending registration token 丢失。如果用户 `/start` 获取 token 后服务重启，token 失效。考虑到 5 分钟 TTL，影响较小但值得记录。

### 3.3 认证机制

**ConnectorAuth** (`src/server/ConnectorAuth.ts`):
- 支持精确匹配 (`connectorId → token`) 和通配符匹配 (`* → token`)
- 使用 timing-safe comparison 防止时序攻击 ✅
- 动态添加 wildcard token（注册时）

#### 🟡 问题 P7: ConnectorAuth wildcard tokens 无上限

`wildcardTokens` 是一个 `string[]`，每次注册新用户都会 push，无清理机制。长期运行后数组会无限增长，verify() 中的线性扫描变慢。

#### 🟡 问题 P8: 无 token 撤销机制

没有 API 或命令可以撤销已注册的 connector token。如果 token 泄露，只能手动操作数据库。

---

## 4. 协议与消息流

### 4.1 Envelope 格式

```typescript
interface Envelope {
  type: MSG;           // 消息类型
  payload: unknown;    // Zod schema 校验的负载
  taskId?: string;     // 关联的 task ID
  timestamp: string;   // ISO 8601
  id: string;          // nanoid
}
```

### 4.2 消息类型清单 (21种)

| MSG 类型 | 方向 | 用途 |
|----------|------|------|
| REGISTER | C→S | Connector 认证注册 |
| REGISTERED | S→C | 注册确认 |
| TASK_START | S→C | 分发任务到 connector |
| TASK_ACCEPTED | C→S | Connector 接受任务 |
| TASK_REJECTED | C→S | Connector 拒绝任务 |
| TASK_OUTPUT | C→S | 流式输出 (stdout/stderr) |
| TASK_STATE | C→S | 任务状态更新 |
| TASK_COMPLETE | C→S | 任务完成 |
| TASK_FAIL | C→S | 任务失败 |
| TASK_CONTROL | S→C | 控制指令 (cancel) |
| TASK_QUESTION | C→S | opencode 提问 |
| QUESTION_REPLY | S→C | 问题回答 |
| TASK_PERMISSION | C→S | 权限请求 |
| PERMISSION_REPLY | S→C | 权限回复 |
| SESSION_NEW | S→C | 新建 opencode session |
| RESUME_RUNNING | C→S | 恢复运行中的任务 |
| UPGRADE_AVAILABLE | S→C | 版本升级通知 |
| ERROR | S→C | 错误消息 |
| PING / PONG | 双向 | 心跳保活 |

### 4.3 OutputBatcher 机制

**位置**: `src/render/OutputBatcher.ts`

- 缓冲 opencode 输出，按 3s 间隔或 3000 字符阈值 flush
- 首次 flush 附加项目名 header
- 完成时发送统计摘要（字符数、消息数、exit code）
- 支持 markdown 发送失败后降级为 plaintext

**评估**: 设计合理，适合流式输出到 IM 的场景。

#### 🟡 问题 P9: OutputBatcher 无平台感知

构造时接收 `policy` 参数默认为 `telegramRenderPolicy`，即使实际目标是 Feishu。Feishu 有不同的消息长度限制 (30000 vs Telegram 4096)。目前通过 `feishuRenderPolicy.ts` 定义了策略但未在 `main.ts` 的 batcher 创建时传入。

---

## 5. 适配器层分析

### 5.1 抽象接口

```typescript
interface IMAdapter {
  readonly platform: Platform;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(response: ChatResponse): Promise<void>;
  sendTyping(chatId: string): Promise<void>;
  sendInteraction(interaction: OutboundInteraction): Promise<void>;
  hasPendingInteraction(chatId: string): boolean;
  onEvent(handler: AdapterEventHandler): void;
}
```

### 5.2 平台差异对比

| 能力 | Telegram | Feishu |
|------|----------|--------|
| 消息接收 | Long-polling (grammY) | WebSocket (Lark SDK) |
| Typing 指示 | ✅ sendChatAction | ❌ 空实现 |
| Markdown | ✅ parse_mode: Markdown | ❌ 纯文本 |
| 消息长度 | 4096 chars | 30000 chars |
| 交互式元素 | InlineKeyboard + callback | Interactive Card |
| 消息去重 | ❌ | ✅ LRU cache |
| 文本回答问题 | ✅ handleCustomTextAnswer | ❌ 仅卡片按钮 |
| 用户-chatId映射 | ❌ | ✅ 持久化 user_chat_map |

#### 🟡 问题 P10: 平台功能不对称

- Feishu 无 typing indicator（SDK 限制）
- Telegram 无消息去重（可能导致 webhook replay 场景下重复处理）
- Feishu 不支持文本自由回答 question，只能点按钮

### 5.3 AdapterDeps 注入

```typescript
interface AdapterDeps {
  listProjects: (userId: string) => ProjectConfig[];
  getBinding: (platform: Platform, chatId: string) => SessionState | undefined;
  bindProject: (platform: Platform, chatId: string, projectId: string) => SessionState;
  isUserAllowed: (projectId: string, userId: string) => boolean;
  generateRegistrationToken?: (userId: string) => string;
  getUserChatId: (platform: Platform, userId: string) => string | undefined;
  setUserChatId: (platform: Platform, userId: string, chatId: string) => void;
  getAllUserChatIds: (platform: Platform) => Map<string, string>;
}
```

**评估**: 依赖注入设计合理，adapter 与业务逻辑解耦。

---

## 6. 配置与存储

### 6.1 配置加载

**位置**: `src/config.ts`

- 读取 `configDir` 下所有 YAML 文件（按文件名排序）
- 每个文件用 Zod schema 校验
- 数组类型合并（concat），对象类型合并（shallow merge）
- 支持 YAML map → array 自动转换（`{ key: { fields } }` → `[{ id: key, ...fields }]`）

**评估**: 设计灵活，支持拆分配置到多文件。

### 6.2 存储层 (SQLite)

**位置**: `src/storage/sqlite.ts`

| 表 | 用途 | 主键 |
|---|------|------|
| users | 用户配置 | id |
| sessions | 聊天会话绑定 | id, UNIQUE(platform, chat_id) |
| tasks | 任务记录 | task_id |
| approvals | 审批记录 | approval_id |
| audit_logs | 审计日志 | id |
| connector_tokens | 持久化 connector token | user_id |
| registered_projects | 持久化用户-项目映射 | (project_id, user_id) |
| user_chat_map | 平台用户-chatId映射 | (platform, user_id) |

#### 🟡 问题 P11: 无索引优化

除主键外无额外索引。`getChatIdByProject()` 查询 `WHERE project_id = ? ORDER BY updated_at DESC` 在 sessions 表上无索引。数据量小时可接受，规模增长后会变慢。

#### 🟡 问题 P12: tasks 表无清理机制

每个用户消息都会创建 task 记录，永不删除。长期运行后 tasks 表会无限增长。

### 6.3 环境变量

| 变量 | 必须 | 默认值 | 说明 |
|------|------|--------|------|
| TELEGRAM_BOT_TOKEN | 至少一个 | — | Telegram Bot token |
| FEISHU_APP_ID + FEISHU_APP_SECRET | 至少一个 | — | Feishu 应用凭证 |
| FEISHU_DOMAIN | ❌ | 'feishu' | feishu 或 lark |
| PETFISH_SERVER_URL | ❌ | 'https://remote.petfish.ai' | 服务器 URL |
| PETFISH_CONFIG_DIR | ❌ | './config' | 配置目录 |
| PETFISH_RUNTIME_DIR | ❌ | './.runtime' | 运行时数据目录 |
| PETFISH_ADMIN_CHAT_ID | ❌ | — | 管理员通知 chatId |
| PETFISH_ADMIN_PLATFORM | ❌ | 'telegram' | 管理员通知平台 |
| ADMIN_API_KEY | ❌ | — | /api/status 认证密钥 |

---

## 7. PolicyEngine 分析

**位置**: `src/core/PolicyEngine.ts`

```typescript
evaluate(action: PolicyAction): PolicyDecision  // 'allow' | 'deny' | 'require_approval'
```

评估逻辑:
1. target 包含 blockedTargets 中任一项 → `deny`
2. project_profile 在 highRiskProfiles 中 → `require_approval`
3. action.type 在 requireApprovalActions 中 → `require_approval`
4. 否则 → `allow`

#### 🔴 问题 P13: PolicyEngine 完全未接入

`TaskManager` 构造函数接收 `policyEngine` 但用 `void this.policyEngine` 忽略了它 (line 30)。这意味着:
- 所有任务不经过策略检查直接执行
- config 中定义的 deny/require_approval 规则形同虚设
- `waiting_approval` 状态永远不会被触发
- Approval 相关的存储、UI 流程实际上是死代码

---

## 8. 整改建议汇总

### 高优先级 (P1-P2)

| # | 问题 | 建议 | 工作量 |
|---|------|------|--------|
| P1 | Task状态转换无守卫 | 在 `updateStatus()` 中添加合法转换表校验，非法转换抛异常 | 小 |
| P2 | 3个状态从未使用 | 决定: (a) 接入 PolicyEngine 启用 `waiting_approval`; 或 (b) 从 TaskStatus 中移除未用状态，减少认知负担 | 中 |
| P13 | PolicyEngine 未接入 | 在 `dispatchTask()` 中加入 `policyEngine.evaluate()` 调用，根据结果设置 `waiting_approval` 或 `deny`。这是安全相关功能，应尽早启用 | 大 |

### 中优先级 (P3-P9)

| # | 问题 | 建议 | 工作量 |
|---|------|------|--------|
| P3 | Task状态测试为空壳 | 实现真实的状态转换测试用例 | 小 |
| P4 | Session默认mode不一致 | 统一默认为 `read_only` 或从 project config 读取 | 小 |
| P5 | Adapter无重连机制 | Telegram: 监听 polling 停止事件，自动重启。Feishu: 添加 WebSocket 断开重连 | 中 |
| P7 | wildcard tokens 无上限 | 改用 `Set<string>` 并定期清理已撤销的 token | 小 |
| P8 | 无 token 撤销机制 | 添加 `/revoke` 命令或管理 API | 中 |
| P9 | OutputBatcher 无平台感知 | 在 `main.ts` 创建 batcher 时根据平台传入对应的 renderPolicy | 小 |

### 低优先级 (P10-P12)

| # | 问题 | 建议 | 工作量 |
|---|------|------|--------|
| P10 | 平台功能不对称 | 记录为已知限制。考虑 Feishu 是否需要消息去重 | — |
| P11 | 无索引优化 | 为 sessions.project_id, tasks.user_id 添加索引 | 小 |
| P12 | tasks 表无清理 | 添加定时清理: 保留最近 N 天或 N 条记录 | 小 |

---

## 9. 架构评价

### 优点

1. **协议设计清晰**: 21 种消息类型覆盖完整的 task 生命周期，Zod schema 保证类型安全
2. **Connector 生命周期健壮**: grace window + 消息排队 + 重连，处理了常见的网络不稳定场景
3. **配置系统灵活**: YAML 多文件合并 + Zod 校验，支持拆分关注点
4. **依赖注入**: AdapterDeps 让 adapter 与业务逻辑解耦
5. **存储设计合理**: 关键数据持久化，支持服务重启恢复
6. **认证安全**: timing-safe comparison, 一次性 token + 持久 token 分离

### 需要关注

1. **PolicyEngine 是最大的架构空洞**: 策略引擎写了但没接，等于没有权限控制
2. **Task 状态机名存实亡**: 定义了 9 个状态只用了 5 个，无转换守卫
3. **main.ts 过重**: 660+ 行的 God Object，混合了初始化、事件处理、路由逻辑
4. **测试覆盖不足**: 59 个测试中 8 个是空壳，核心 TaskManager 和 main.ts 无测试

### 架构成熟度评级

**Transitional** — 有清晰的设计意图和类型系统，但部分模块（PolicyEngine、Task 状态机、测试）还停留在 scaffold 阶段。核心数据通路（消息收发、connector 管理）已达生产质量。
