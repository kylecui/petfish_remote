# 使用指南

本文档面向 PetFish Remote 的日常使用者，聚焦“怎么用命令完成任务”。

## 1. 命令概览

以下是 `/pf` 前缀下的 15 个核心命令：

| 命令 | 语法 | 说明 |
|---|---|---|
| 显示帮助 | `/pf help` | 显示可用命令与基础用法。 |
| 列出项目 | `/pf list` | 列出当前用户可访问的已注册项目。 |
| 绑定项目 | `/pf use <project>` | 将当前聊天会话绑定到指定项目。 |
| 查看绑定 | `/pf where` | 显示当前会话绑定的项目。 |
| 创建只读分析任务 | `/pf ask <instruction>` | 发起只读分析任务，不写文件。 |
| 创建编辑任务 | `/pf edit <instruction>` | 发起编辑任务，命中策略时需要审批。 |
| 运行测试 | `/pf test [name]` | 运行项目预设测试命令（`unit`/`build`/`lint` 或自定义名称）。 |
| 查看任务状态 | `/pf status` | 查看当前任务状态（如 running、waiting_approval、completed）。 |
| 查看代码变更 | `/pf diff` | 查看当前任务产生的代码差异。 |
| 审批通过 | `/pf approve` | 通过待审批操作，任务继续执行。 |
| 审批拒绝 | `/pf deny` | 拒绝待审批操作，任务停止或按策略结束。 |
| 停止任务 | `/pf stop` | 停止当前任务执行。 |
| 查看最近日志 | `/pf log` | 查看最近任务日志与执行信息。 |
| 创建 PR | `/pf pr` | 基于当前变更创建 Pull Request。 |
| 提交变更 | `/pf commit` | 将当前代码变更提交为 Git commit。 |

---

## 2. 执行模式

PetFish Remote 任务会运行在以下 5 种模式之一：

### `read_only`
- 只读分析模式。
- 可读取、搜索、分析代码。
- 不允许写文件，不允许执行高风险变更。

### `suggest`
- 建议模式。
- 可以给出修改建议、补丁建议。
- 默认不直接写入文件，适合先评审再落地。

### `edit_guarded`
- 受保护编辑模式。
- 允许编辑，但命中风险策略（`require_approval`）的操作会暂停等待审批。

### `execute_guarded`
- 受保护执行模式。
- 可运行白名单或已审批命令。
- 命中策略控制时同样进入审批流程。

### `admin`
- 完全访问模式（仅本地）。
- 适用于受信任环境下的高权限操作。

---

## 3. 工作流示例

### 3.1 基础工作流
1. `/pf list`
2. `/pf use myproject`
3. `/pf ask "分析代码结构"`
4. 用 `/pf status` 或任务消息查看分析结果。

适用场景：先理解项目、做只读 Review、梳理模块关系。

### 3.2 编辑工作流
1. `/pf use myproject`
2. `/pf edit "修复登录bug"`
3. `/pf status`
4. 若进入待审批，执行 `/pf approve`
5. `/pf diff`
6. `/pf commit`

适用场景：从需求到修复闭环，且有审批兜底。

### 3.3 测试工作流
1. `/pf test unit`
2. `/pf status`
3. 查看测试输出与结果。

说明：`/pf test [name]` 里的 `name` 来自项目的 `projects.yaml` 中 `test_commands`。

### 3.4 PR 工作流
1. `/pf edit "add feature"`
2. `/pf approve`
3. `/pf pr`

适用场景：完成变更后直接进入协作提交流程。

---

## 4. 审批机制

### 4.1 哪些操作需要审批
是否需要审批由策略引擎决定，核心依据是 `policies.yaml` 的 `require_approval` 规则。

- 典型示例：
  - 写入源码文件（如 `write:**/*.ts`、`write:**/*.js`）
  - 执行受控命令（如 `exec:npm install *`、`exec:make *`）
  - `docker:*` 类操作

策略判断顺序可理解为：
1. 命中 `deny` => 直接拒绝
2. 命中 `require_approval` => 进入审批
3. 其他 => `allow`

### 4.2 审批流程
1. Bot 识别到需要审批的动作并创建审批请求（状态 `pending`）。
2. 任务进入 `waiting_approval`。
3. 用户执行 `/pf approve` 或 `/pf deny`。
4. 审批结果写回后，任务继续或终止。

### 4.3 审批超时行为
- 审批记录本身只有 `pending/approved/denied` 状态。
- 当前实现中未提供独立的“审批自动超时后自动批准/自动拒绝”机制。
- 实际超时通常由任务执行层或会话层控制（例如任务进入 `timeout`），具体表现以运行时策略为准。

### 4.4 角色权限
角色来自 `users.yaml`：

- `owner`：可审批全部操作（`can_approve: true`）
- `developer`：可审批（`can_approve: true`）
- `viewer`：不可审批（`can_approve: false`）

---

## 5. 自然语言支持

除了显式 `/pf` 命令，也支持自然语言输入，系统会做意图映射。

- 示例：`帮我看看代码结构` → 等效 `/pf ask`
- 示例：`修改登录功能` → 等效 `/pf edit`

当无法识别明确意图时，默认回退为 `/pf ask`（只读分析路径）。

---

## 6. 多项目管理

- 用 `/pf list` 查看所有可用项目。
- 用 `/pf use <project>` 切换当前会话绑定项目。
- 用 `/pf where` 确认当前绑定是否正确。
- 每个聊天会话独立维护绑定状态，互不干扰。

建议：在任何分析或编辑前先执行一次 `/pf where`，避免在错误项目上操作。

---

## 7. 使用场景

### 场景 1：代码 Review
`/pf ask "review the auth module for security issues"`

适合先做安全与结构审查，不触发代码修改。

### 场景 2：Bug 修复
`/pf edit "fix the null pointer in UserService.ts line 42"`

若命中风险策略，走审批后执行。

### 场景 3：运行测试
- `/pf test unit`
- `/pf test build`

用于回归验证与构建检查。

### 场景 4：远程开发
在 SSH runtime 绑定的项目中执行 `/pf edit`，通过审批后完成远程修改与验证。

适合跨机器开发、远端环境修复、远端流水线预检。
