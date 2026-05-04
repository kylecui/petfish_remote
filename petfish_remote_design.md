# 胖鱼遥控器 PetFish Remote 设计文档

> 版本：v0.1 Draft  
> 定位：面向opencode项目工作区的聊天式远程控制面  
> 推荐首版平台：Telegram Bot + opencode CLI Runner  
> 后续扩展：opencode SDK、opencode plugin、Slack、飞书、企业微信、Web控制台

---

## 1. 项目概述

### 1.1 项目名称

中文名：

> 胖鱼遥控器

英文名：

> PetFish Remote

推荐仓库名：

```text
petfish-remote
```

一句话定位：

> 胖鱼遥控器是一个面向opencode项目工作区的聊天式远程控制面，用于通过Telegram、Slack、飞书、企业微信等聊天工具，安全地创建、跟踪、审批和管理opencode任务。

更简洁的产品口号：

> 用聊天工具安全遥控你的opencode项目Agent。

英文描述：

> PetFish Remote is a chat-based control plane for safely operating opencode agents across project workspaces.

---

## 2. 背景与问题

opencode适合作为桌面端、终端端或服务器端的项目级AI Agent工作环境，但在手机和聊天工具场景下存在明显不足：

1. 手机不适合承载完整TUI、复杂终端和多文件工程操作。
2. opencode长任务执行时，用户无法方便地在移动端跟踪状态。
3. Agent执行命令、修改文件、访问密钥、推送代码等操作存在安全风险。
4. 多项目、多仓库、多会话容易混淆上下文。
5. IM消息天然碎片化，缺少任务状态机和工程执行边界。
6. 手机端更适合作为控制面，而不是执行面。

因此，合理方向不是“把opencode搬到手机上”，而是：

```text
聊天工具 / 手机
    ↓
胖鱼遥控器控制面
    ↓
opencode执行环境
    ↓
项目目录 / skills / MCP / Git / Test / Deploy
```

即：

> 手机和聊天工具负责控制、审批、跟踪；opencode继续在桌面、WSL、Linux服务器或云主机中执行实际工程任务。

---

## 3. 核心目标

胖鱼遥控器需要解决五类问题。

| 问题 | 设计目标 |
|---|---|
| 手机上无法舒服地使用opencode | 使用聊天工具作为轻量控制入口 |
| opencode长任务不方便远程跟踪 | 支持任务状态、进度摘要、完成通知 |
| Agent执行存在风险 | 引入权限、审批、策略、审计 |
| 多项目、多仓库容易混乱 | 建立项目注册表与会话绑定 |
| IM消息太碎，难以驱动工程任务 | 将自然语言消息转换为结构化任务 |

核心能力可以概括为：

```text
胖鱼遥控器 = 聊天入口 + 项目路由 + Agent任务状态机 + 安全审批 + 结果摘要
```

---

## 4. 非目标

胖鱼遥控器首版不追求以下目标：

1. 不做手机版opencode。
2. 不搬运完整TUI到聊天工具。
3. 不直接在手机本地运行复杂开发环境。
4. 不默认允许自动push、自动部署、自动删除文件。
5. 不在首版支持复杂多人协同审批。
6. 不在首版支持微信个人号等非标准接口。
7. 不把聊天工具作为代码审查和大规模diff展示的主界面。
8. 不绕过opencode自身的项目规则、AGENTS.md、skills和MCP配置。

---

## 5. 设计原则

### 5.1 控制面与执行面分离

聊天工具只做控制面：

```text
- 下发任务
- 查看状态
- 审批操作
- 获取摘要
- 触发测试
- 要求继续
- 要求停止
```

opencode和项目环境做执行面：

```text
- 阅读项目
- 修改代码
- 调用工具
- 执行命令
- 生成diff
- 运行测试
- 整理结果
```

### 5.2 默认安全

所有来自聊天工具的任务默认采用低权限模式。

推荐默认模式：

```text
read_only
```

或者：

```text
edit_guarded
```

禁止默认进入：

```text
admin
```

### 5.3 项目显式注册

胖鱼遥控器不得允许用户随意指定任意系统路径。

所有可被远程控制的项目都必须在`projects.yaml`中显式注册。

### 5.4 操作可审计

所有关键事件必须记录：

```text
- 用户消息
- 项目绑定
- 任务创建
- 模式切换
- 文件写入请求
- 命令执行请求
- 审批通过/拒绝
- 任务完成/失败
- 生成的diff摘要
```

### 5.5 移动端友好输出

聊天工具不适合承载长日志。

所有输出应优先采用：

```text
- 结论先行
- 分点说明
- 控制长度
- 只推送关键节点
- 长日志保存为附件或文件链接
```

---

## 6. 总体架构

```text
┌──────────────────────────────────────────┐
│              聊天工具入口                 │
│ Telegram / Slack / 飞书 / 企业微信 / Discord │
└──────────────────┬───────────────────────┘
                   │ Webhook / Bot API
                   ▼
┌──────────────────────────────────────────┐
│              胖鱼遥控器 Bridge             │
│                                          │
│  1. 用户鉴权                               │
│  2. 项目路由                               │
│  3. 指令解析                               │
│  4. 任务状态机                             │
│  5. 审批与权限控制                          │
│  6. 消息摘要与结果回传                      │
│  7. 审计日志                               │
└──────────────────┬───────────────────────┘
                   │ SDK / HTTP / CLI
                   ▼
┌──────────────────────────────────────────┐
│              opencode Runtime             │
│                                          │
│  opencode server                          │
│  opencode session                         │
│  opencode plugin hooks                    │
│  AGENTS.md / skills / MCP                 │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│              项目执行环境                  │
│                                          │
│  Git repo                                 │
│  文件系统                                  │
│  测试命令                                  │
│  Docker / uv / npm / Makefile             │
│  远程部署环境                               │
└──────────────────────────────────────────┘
```

---

## 7. 系统分层

### 7.1 Chat Adapter层

职责：

1. 对接不同聊天平台。
2. 接收用户消息。
3. 校验消息来源。
4. 将平台消息转换为统一内部事件。
5. 将系统响应发送回聊天平台。

推荐目录：

```text
src/adapters/
  telegram/
  slack/
  feishu/
  wecom/
  discord/
```

统一输入事件：

```json
{
  "platform": "telegram",
  "chat_id": "123456",
  "user_id": "78910",
  "username": "kyle",
  "message_id": "456",
  "text": "/pf ask rswitch 修复devmap egress hook问题，先不要改代码",
  "attachments": [],
  "timestamp": "2026-05-04T16:30:00+01:00"
}
```

统一输出消息：

```json
{
  "platform": "telegram",
  "chat_id": "123456",
  "reply_to": "456",
  "message_type": "text",
  "text": "已创建任务 task_001，模式：read_only。"
}
```

---

### 7.2 Command Router层

职责：

1. 解析显式命令。
2. 识别自然语言任务。
3. 绑定当前会话项目。
4. 推断执行模式。
5. 生成结构化任务请求。

支持两类输入。

#### 7.2.1 显式命令

```text
/pf help
/pf list
/pf use <project>
/pf where
/pf ask <instruction>
/pf edit <instruction>
/pf test [name]
/pf status
/pf diff
/pf approve
/pf deny
/pf stop
/pf log
/pf pr
/pf commit
```

#### 7.2.2 自然语言输入

用户：

```text
帮我看一下rswitch里的VOQd调度逻辑，先不要改代码，只给结论。
```

解析结果：

```json
{
  "intent": "ask",
  "project": "rswitch",
  "mode": "read_only",
  "instruction": "阅读VOQd调度逻辑，先不要改代码，只给结论。"
}
```

第一版可以采用规则解析：

```text
当前聊天已绑定项目 → 默认使用该项目
包含“不要改代码” → read_only
包含“分析/阅读/看看/定位” → read_only
包含“修复/修改/生成/实现” → edit_guarded
包含“运行/测试/部署/安装” → execute_guarded
```

---

### 7.3 Project Registry层

职责：

1. 管理可被远程控制的项目。
2. 记录项目路径、权限、策略和预设命令。
3. 禁止访问未注册项目。
4. 为任务构造项目上下文。

配置文件示例：

```yaml
projects:
  rswitch:
    name: "rSwitch"
    path: "/home/kyle/workspace/rswitch"
    default_mode: "guarded"
    default_agent: "code-reviewer"
    allowed_users:
      - "telegram:78910"
    readme_files:
      - "AGENTS.md"
      - "README.md"
      - "docs/architecture.md"
    test_commands:
      unit: "make test"
      build: "make build"
      lint: "make lint"
    risk_profile: "kernel-ebpf"
    secrets_policy: "deny_read"

  skills-team:
    name: "Skills Team"
    path: "/home/kyle/workspace/skills-team"
    default_mode: "guarded"
    allowed_users:
      - "telegram:78910"
    readme_files:
      - "AGENTS.md"
      - "README.md"
    test_commands:
      validate: "python scripts/validate_skills.py"
    risk_profile: "docs-and-tools"
    secrets_policy: "deny_read"
```

项目配置字段建议：

| 字段 | 含义 |
|---|---|
| `name` | 项目显示名称 |
| `path` | 本地项目路径 |
| `default_mode` | 默认执行模式 |
| `default_agent` | 默认Agent或角色 |
| `allowed_users` | 允许访问该项目的用户 |
| `readme_files` | 任务开始前优先读取的文件 |
| `test_commands` | 允许通过`/pf test`触发的命令 |
| `risk_profile` | 风险策略配置 |
| `secrets_policy` | 密钥读取策略 |

---

### 7.4 Session Manager层

职责：

1. 维护聊天会话与项目的绑定关系。
2. 维护聊天会话与opencode session的关系。
3. 支持用户连续补充需求。
4. 防止跨项目上下文污染。

会话状态示例：

```json
{
  "chat_id": "telegram:123456",
  "bound_project": "rswitch",
  "active_session": "oc_sess_abc123",
  "active_task": "task_20260504_001",
  "mode": "guarded",
  "last_activity": "2026-05-04T16:40:00+01:00"
}
```

需要Session Manager的原因：

聊天消息天然碎片化。用户可能连续发送：

```text
先看一下这个问题。
不要改代码。
现在可以改。
跑一下测试。
把diff发我。
```

系统必须知道这些消息属于：

```text
哪个用户
哪个聊天
哪个项目
哪个任务
哪个opencode session
哪个权限模式
```

---

### 7.5 Task Manager层

职责：

1. 创建任务。
2. 调度任务。
3. 维护任务状态。
4. 接收opencode结果。
5. 处理取消、失败、超时。
6. 生成任务摘要。

任务对象：

```json
{
  "task_id": "task_20260504_001",
  "project": "rswitch",
  "user": "telegram:78910",
  "instruction": "分析devmap egress hook没有触发的问题",
  "mode": "read_only",
  "status": "running",
  "created_at": "2026-05-04T16:30:00+01:00",
  "opencode_session_id": "oc_sess_abc123",
  "risk_level": "low",
  "approvals": [],
  "artifacts": []
}
```

---

### 7.6 Policy Engine层

职责：

1. 评估文件读取、写入、命令执行和Git操作风险。
2. 判断允许、拒绝或需要审批。
3. 根据项目风险画像应用不同策略。
4. 生成审批说明。

策略配置示例：

```yaml
policies:
  default:
    deny:
      - "read:*.env"
      - "read:**/.env"
      - "read:**/id_rsa"
      - "read:**/*secret*"
      - "exec:curl * | bash"
      - "exec:rm -rf *"
      - "git:push"
      - "git:reset --hard"
    require_approval:
      - "write:**/*.py"
      - "write:**/*.ts"
      - "write:**/*.js"
      - "write:**/*.c"
      - "exec:make *"
      - "exec:npm install *"
      - "exec:uv add *"
      - "docker:*"
    allow:
      - "read:**"
      - "exec:git status"
      - "exec:git diff"
      - "exec:rg *"

  kernel-ebpf:
    inherit: "default"
    require_approval:
      - "write:**/*.bpf.c"
      - "write:**/*.h"
      - "exec:make *"
      - "exec:sudo *"
      - "exec:bpftool *"
      - "exec:ip link *"
    deny:
      - "exec:sudo rm *"
      - "exec:bpftool prog detach *"
      - "exec:ip link set * down"
      - "exec:git push *"
```

---

### 7.7 Approval Manager层

职责：

1. 创建审批请求。
2. 发送审批消息。
3. 接收`/pf approve`或`/pf deny`。
4. 将审批结果传回Task Manager。
5. 记录审计日志。

审批对象：

```json
{
  "approval_id": "appr_001",
  "task_id": "task_20260504_001",
  "action_type": "exec",
  "action_payload": {
    "command": "make build"
  },
  "risk_level": "medium",
  "reason": "验证eBPF对象和用户态组件是否可以正常构建",
  "status": "pending",
  "requested_at": "2026-05-04T16:45:00+01:00"
}
```

审批消息示例：

```text
胖鱼请求审批：

项目：rSwitch
任务：修复devmap egress hook问题
操作：运行命令
命令：make build
风险级别：中
原因：验证eBPF对象和用户态组件是否可以正常构建

回复：
/pf approve
/pf deny
```

---

### 7.8 OpenCode Runner层

职责：

1. 调用opencode。
2. 管理opencode session。
3. 注入任务Prompt。
4. 收集执行结果。
5. 处理超时、中断、错误。

建议支持三种Runner。

#### 7.8.1 CLI Runner

用于MVP。

```bash
cd /home/kyle/workspace/rswitch
opencode run "请阅读AGENTS.md，然后分析devmap egress hook没有触发的问题。不要修改文件。"
```

优点：

```text
- 实现最快
- 易于调试
- 对opencode内部API依赖少
```

缺点：

```text
- session管理较弱
- 事件流较弱
- 审批和中断能力有限
```

#### 7.8.2 SDK Runner

用于正式版。

```text
胖鱼遥控器
    ↓
@opencode-ai/sdk
    ↓
opencode server
```

优点：

```text
- 更适合session复用
- 更适合长任务
- 更适合事件流
- 更适合多项目和多会话
```

#### 7.8.3 Plugin Runner

作为opencode内部插件配合Bridge使用。

职责：

```text
- 捕获opencode事件
- 上报进度
- 拦截风险动作
- 注入PetFish上下文
- 输出结构化摘要
```

推荐最终结构：

```text
胖鱼遥控器 Bridge = 外部服务
opencode-petfish-plugin = opencode内部插件
```

---

## 8. 执行模式

胖鱼遥控器需要定义明确的执行模式。

| 模式 | 能力 | 典型用途 |
|---|---|---|
| `read_only` | 只能读文件、搜索、总结、分析 | 代码阅读、文档分析、问题定位 |
| `suggest` | 可以生成patch建议，但不落盘 | 方案设计、修改建议 |
| `edit_guarded` | 可以改文件，但关键diff需要确认 | 日常开发 |
| `execute_guarded` | 可以运行白名单命令或审批后的命令 | build、test、lint |
| `admin` | 可以执行高风险操作 | 仅本机手动开启，不建议远程默认启用 |

默认策略：

```text
所有来自聊天工具的新任务默认 read_only。
```

当用户明确要求修改时：

```text
进入 edit_guarded。
```

当用户明确要求运行测试或命令时：

```text
进入 execute_guarded，并触发策略检查。
```

---

## 9. 风险动作分类

### 9.1 低风险动作

可自动允许：

```text
- 读取普通项目文件
- grep / rg 搜索
- git diff
- git status
- 查看README / AGENTS.md / docs
```

### 9.2 中风险动作

通常需要审批或受项目策略约束：

```text
- 修改普通源码文件
- 新增文档
- 运行make test
- 运行pytest
- 运行npm test
- 生成patch
```

### 9.3 高风险动作

必须强审批，部分操作默认禁止：

```text
- 删除文件
- 批量重命名
- 修改.env
- 修改密钥文件
- 执行curl | bash
- 安装依赖
- docker compose down
- git reset --hard
- git push
- ssh远程执行
- 部署到生产环境
```

### 9.4 禁止动作建议

首版建议直接禁止：

```text
- 读取.env、私钥、token文件
- 访问项目目录之外的路径
- git push
- git reset --hard
- rm -rf
- curl | bash
- 自动部署生产环境
- 未经确认的sudo命令
```

---

## 10. 任务状态机

每个任务必须进入状态机。

### 10.1 状态定义

```text
created
queued
running
waiting_approval
waiting_user_input
completed
failed
cancelled
timeout
```

### 10.2 状态流转

```text
created
  ↓
queued
  ↓
running
  ├── waiting_approval
  │       ├── approved → running
  │       └── denied   → cancelled / running with alternative
  ├── waiting_user_input
  │       └── user_reply → running
  ├── completed
  ├── failed
  └── cancelled
```

### 10.3 状态含义

| 状态 | 含义 |
|---|---|
| `created` | 任务已创建但尚未进入队列 |
| `queued` | 任务等待执行 |
| `running` | 任务正在执行 |
| `waiting_approval` | 等待用户审批风险操作 |
| `waiting_user_input` | 等待用户补充信息 |
| `completed` | 任务完成 |
| `failed` | 任务失败 |
| `cancelled` | 用户取消 |
| `timeout` | 超时终止 |

---

## 11. 命令体系

命令前缀建议使用：

```text
/pf
```

`pf`对应PetFish，也比`/op`更具产品识别度。

### 11.1 基础命令

```text
/pf help
显示帮助

/pf list
列出可用项目

/pf use <project>
绑定当前聊天到某个项目

/pf where
查看当前绑定项目和活跃任务

/pf ask <instruction>
创建一个分析任务，默认read_only

/pf edit <instruction>
创建一个修改任务，默认edit_guarded

/pf test [name]
运行项目预设测试

/pf status
查看当前任务状态

/pf diff
查看当前任务diff摘要

/pf approve
批准当前等待审批的操作

/pf deny
拒绝当前等待审批的操作

/pf stop
停止当前任务

/pf log
查看最近任务日志摘要

/pf pr
生成PR说明

/pf commit
生成commit message
```

### 11.2 命令示例

绑定项目：

```text
用户：
/pf use rswitch

胖鱼：
已绑定项目：rSwitch
路径：/home/kyle/workspace/rswitch
默认模式：guarded
当前策略：kernel-ebpf
```

只读分析：

```text
用户：
/pf ask 帮我分析一下XDP_REDIRECT返回4但是devmap egress hook没有触发的可能原因，先不要改代码。

胖鱼：
已创建任务 task_001。
模式：read_only
我会先阅读AGENTS.md、相关XDP/devmap代码和文档，然后返回结论。
```

修改代码：

```text
用户：
/pf edit 根据刚才的分析，增加一段debug trace，不要改核心转发逻辑。

胖鱼：
已创建修改任务 task_002。
模式：edit_guarded
任何文件落盘修改都会在diff后等待确认。
```

请求审批：

```text
胖鱼：
任务 task_002 请求写入文件：

文件：
- src/xdp/egress.bpf.c

变更类型：
- 新增trace日志
- 未改变转发路径

风险级别：中

回复：
/pf approve
/pf deny
/pf diff
```

运行测试：

```text
用户：
/pf test build

胖鱼：
请求执行命令：
make build

风险级别：中
原因：构建eBPF对象和用户态组件

回复：
/pf approve
```

---

## 12. 消息摘要设计

### 12.1 任务开始消息

```text
胖鱼开始任务：

项目：rSwitch
任务：分析devmap egress hook未触发问题
模式：read_only
策略：kernel-ebpf
任务ID：task_001
```

### 12.2 进度消息

进度消息不应刷屏，只在关键节点推送。

```text
胖鱼进度更新：

已完成：
1. 阅读AGENTS.md
2. 定位devmap redirect相关代码
3. 检查驱动/网卡约束相关文档

初步发现：
问题可能不在bpf_redirect_map返回值，而在native redirect路径或驱动对devmap egress program支持不足。
```

### 12.3 结果消息

```text
胖鱼任务完成：

结论：
XDP_REDIRECT返回4只表示BPF程序选择了redirect动作，不等价于devmap egress program一定被执行。

主要可能原因：
1. 驱动未走支持devmap egress hook的native路径
2. redirect目标ifindex或devmap配置异常
3. egress program attach方式不正确
4. generic/native模式行为差异
5. AF_XDP路径绕开了预期egress处理

建议下一步：
先验证网卡驱动与XDP模式，再用tracepoint确认dev_map_enqueue/dev_map_flush路径。
```

### 12.4 Diff消息

```text
胖鱼生成了修改：

文件变更：
1. src/xdp/egress.bpf.c
   - 新增3处trace日志
   - 未改变转发逻辑

2. docs/debug/devmap-egress.md
   - 新增排查步骤

风险判断：
低到中。修改集中在debug路径。

可选操作：
/pf approve
/pf deny
/pf test build
```

### 12.5 测试结果消息

```text
胖鱼测试完成：

命令：
make build

结果：
通过

摘要：
- eBPF对象构建成功
- 用户态组件构建成功
- 未发现编译错误

建议：
可以继续运行更完整的集成测试。
```

---

## 13. 文件与附件处理

聊天工具可能发送：

```text
- 日志文件
- patch文件
- 截图
- 配置文件
- 报错文本
```

附件处理原则：

1. 附件不得直接覆盖项目文件。
2. 附件必须保存到隔离目录。
3. 附件路径必须作为任务上下文显式注入。
4. 高风险附件需要标记。
5. 敏感附件不得进入长期日志。

推荐目录：

```text
.runtime/
  attachments/
    task_001/
      error.log
      screenshot.png
      config.yaml
```

注入opencode任务的上下文：

```text
用户上传了附件：
- .runtime/attachments/task_001/error.log

请先阅读该日志，再结合项目代码分析问题。
```

---

## 14. 数据模型

MVP可使用SQLite。

### 14.1 users

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### 14.2 projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  policy_profile TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### 14.3 sessions

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  opencode_session_id TEXT,
  active_task_id TEXT,
  mode TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 14.4 tasks

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  instruction TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_level TEXT,
  opencode_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 14.5 approvals

```sql
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_payload TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_at TEXT
);
```

### 14.6 audit_logs

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  user_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

---

## 15. Prompt设计

胖鱼遥控器不能只是把用户原话丢给opencode，而应构造受控Prompt。

### 15.1 通用任务Prompt

```text
You are operating under PetFish Remote Control.

Project:
{{project_name}}

Working directory:
{{project_path}}

Execution mode:
{{mode}}

User instruction:
{{instruction}}

Rules:
1. Read AGENTS.md first if it exists.
2. Do not access files outside the project directory.
3. Do not read secrets, credentials, private keys, or .env files.
4. Do not execute commands unless explicitly allowed by the task mode.
5. If code changes are needed but the mode is read_only, provide a patch plan only.
6. If a risky operation is required, stop and request approval.
7. Return a concise mobile-friendly summary.
```

### 15.2 read_only模式Prompt

```text
Mode: read_only

You may:
- Read project files.
- Search code.
- Analyze errors.
- Provide conclusions and recommendations.

You must not:
- Modify files.
- Execute build/test/deploy commands.
- Install dependencies.
- Change git state.
```

### 15.3 suggest模式Prompt

```text
Mode: suggest

You may:
- Read project files.
- Search code.
- Propose file changes.
- Produce patch-like suggestions.

You must not:
- Modify files directly.
- Execute commands.
- Change git state.
```

### 15.4 edit_guarded模式Prompt

```text
Mode: edit_guarded

You may:
- Propose file changes.
- Prepare patches.
- Modify files only when allowed by policy.

Before finalizing:
- Summarize changed files.
- Explain risk.
- Provide test suggestions.
- Stop if approval is required.
```

### 15.5 execute_guarded模式Prompt

```text
Mode: execute_guarded

You may request command execution.

Before any command:
- Explain the command.
- Explain why it is needed.
- Estimate risk.
- Wait for approval unless it is explicitly whitelisted.
```

---

## 16. 项目目录结构

推荐项目结构：

```text
petfish-remote/
├── README.md
├── AGENTS.md
├── package.json
├── tsconfig.json
├── .env.example
├── config/
│   ├── projects.yaml
│   ├── policies.yaml
│   ├── adapters.yaml
│   └── users.yaml
├── src/
│   ├── main.ts
│   ├── adapters/
│   │   ├── telegram/
│   │   │   ├── TelegramAdapter.ts
│   │   │   └── telegramTypes.ts
│   │   ├── slack/
│   │   ├── feishu/
│   │   └── wecom/
│   ├── core/
│   │   ├── CommandRouter.ts
│   │   ├── ProjectRegistry.ts
│   │   ├── SessionManager.ts
│   │   ├── TaskManager.ts
│   │   ├── PolicyEngine.ts
│   │   ├── ApprovalManager.ts
│   │   └── AuditLogger.ts
│   ├── opencode/
│   │   ├── OpenCodeClient.ts
│   │   ├── OpenCodeCliRunner.ts
│   │   ├── OpenCodeSdkRunner.ts
│   │   └── PromptBuilder.ts
│   ├── storage/
│   │   ├── sqlite.ts
│   │   └── schema.sql
│   ├── render/
│   │   ├── MessageRenderer.ts
│   │   ├── DiffRenderer.ts
│   │   └── ApprovalRenderer.ts
│   └── utils/
│       ├── shell.ts
│       ├── paths.ts
│       └── security.ts
├── plugins/
│   └── opencode-petfish-plugin/
│       ├── package.json
│       └── src/
├── scripts/
│   ├── dev.sh
│   ├── install.sh
│   └── doctor.ts
├── tests/
│   ├── policy.test.ts
│   ├── command-router.test.ts
│   └── task-state.test.ts
└── docs/
    ├── architecture.md
    ├── security-model.md
    ├── telegram-setup.md
    ├── opencode-integration.md
    └── roadmap.md
```

---

## 17. 配置文件设计

### 17.1 adapters.yaml

```yaml
adapters:
  telegram:
    enabled: true
    token_env: TELEGRAM_BOT_TOKEN
    webhook:
      enabled: false
      url: ""
    polling:
      enabled: true

  slack:
    enabled: false
    signing_secret_env: SLACK_SIGNING_SECRET
    bot_token_env: SLACK_BOT_TOKEN

  feishu:
    enabled: false
    app_id_env: FEISHU_APP_ID
    app_secret_env: FEISHU_APP_SECRET
```

### 17.2 users.yaml

```yaml
users:
  - id: "telegram:78910"
    name: "Kyle"
    role: "owner"
    allowed_projects:
      - "rswitch"
      - "skills-team"
    allowed_modes:
      - "read_only"
      - "suggest"
      - "edit_guarded"
      - "execute_guarded"

roles:
  owner:
    can_approve: true
    can_manage_projects: true
    can_run_tests: true

  developer:
    can_approve: true
    can_manage_projects: false
    can_run_tests: true

  viewer:
    can_approve: false
    can_manage_projects: false
    can_run_tests: false
```

### 17.3 runtime.yaml

```yaml
runtime:
  storage: "sqlite"
  sqlite_path: ".runtime/petfish.db"
  attachments_dir: ".runtime/attachments"
  logs_dir: ".runtime/logs"
  max_task_runtime_seconds: 1800
  max_message_length: 3500
  default_mode: "read_only"
```

---

## 18. opencode插件设计

插件名称：

```text
opencode-petfish-plugin
```

插件职责：

```text
1. 捕获opencode事件
2. 向Bridge报告任务进度
3. 拦截高风险工具调用
4. 给opencode注入PetFish上下文
5. 输出适合IM展示的结构化结果
```

插件配置示例：

```json
{
  "plugin": [
    "opencode-petfish-plugin"
  ],
  "server": {
    "port": 4096
  },
  "petfish": {
    "bridgeUrl": "http://127.0.0.1:8787",
    "projectId": "rswitch",
    "policyProfile": "kernel-ebpf"
  }
}
```

插件不是MVP必需，但正式版应加入。

---

## 19. MVP实现路线

### 19.1 V0.1：Telegram + CLI Runner

目标：

> 最快跑通从聊天工具下发任务到opencode执行并回传摘要的闭环。

功能：

```text
- Telegram Bot接收消息
- /pf help
- /pf list
- /pf use <project>
- /pf ask <instruction>
- /pf status
- /pf stop
- 调用opencode run
- 返回最终摘要
- SQLite记录任务
```

暂不做：

```text
- 实时流式输出
- 复杂审批
- 多Agent
- opencode插件hook
- 多聊天平台
```

技术栈建议：

```text
Node.js / TypeScript
grammY 或 Telegraf
SQLite
YAML配置
child_process 调用 opencode CLI
```

---

### 19.2 V0.2：任务状态机 + 审批

新增：

```text
- TaskManager
- ApprovalManager
- PolicyEngine
- /pf approve
- /pf deny
- /pf diff
- 命令白名单
- 操作风险判断
```

这版开始具备“遥控器”的核心价值。

---

### 19.3 V0.3：opencode SDK接入

新增：

```text
- OpenCodeSdkRunner
- session复用
- 事件流监听
- 更稳定的长任务
- 中间进度推送
```

---

### 19.4 V0.4：Diff与测试集成

新增：

```text
- /pf diff
- /pf test
- /pf commit
- /pf pr
- changed files summary
- test result summary
```

---

### 19.5 V0.5：opencode插件

新增：

```text
- opencode-petfish-plugin
- opencode事件hook
- 风险动作上报
- 更细粒度执行控制
```

---

### 19.6 V1.0：多平台正式版

支持：

```text
- Telegram
- Slack
- 飞书
- 企业微信
- Web控制台
- 多用户权限
- 多项目注册
- 审计日志
- 任务历史
- 项目级策略
```

---

## 20. 首版验收标准

V0.1首版验收不以“Bot能回复”为标准，而以完成真实闭环为标准。

最小闭环：

```text
1. 用户在Telegram中输入 /pf list。
2. 胖鱼返回可用项目。
3. 用户输入 /pf use rswitch。
4. 胖鱼绑定rSwitch项目。
5. 用户输入 /pf ask 分析某个问题，要求不要改代码。
6. 胖鱼调用opencode在rSwitch目录中执行只读分析。
7. 胖鱼返回结构化结论。
8. 用户输入 /pf status 能看到任务状态。
9. 用户输入 /pf stop 可以中止未完成任务。
10. 所有任务和关键事件被写入SQLite审计表。
```

扩展闭环：

```text
1. 用户要求生成修改方案。
2. 胖鱼进入suggest或edit_guarded模式。
3. 胖鱼返回diff摘要。
4. 用户批准运行测试。
5. 胖鱼执行预设测试命令。
6. 胖鱼返回测试结果。
7. 胖鱼生成commit message或PR说明。
```

---

## 21. 安全模型

### 21.1 威胁模型

需要重点防范：

| 威胁 | 说明 |
|---|---|
| 未授权用户控制Agent | 攻击者向Bot发送指令 |
| 项目越权访问 | 用户访问未授权项目 |
| 路径穿越 | 指令诱导Agent读取项目外文件 |
| 密钥泄露 | 读取.env、私钥、token |
| 危险命令执行 | rm、curl pipe bash、sudo、docker down |
| Git破坏性操作 | reset、push、force push |
| 供应链风险 | 自动安装依赖 |
| Prompt Injection | 项目文件或附件诱导Agent绕过策略 |
| 日志泄露 | 审计日志中保存敏感信息 |
| 群聊误触发 | 群内普通消息被错误执行 |

### 21.2 安全控制

| 控制点 | 设计 |
|---|---|
| 用户鉴权 | 平台ID白名单 |
| 项目鉴权 | 每个项目配置allowed_users |
| 路径约束 | 只能访问注册项目目录 |
| 密钥保护 | 默认禁止读取.env和私钥 |
| 命令白名单 | `/pf test`只能调用预设命令 |
| 风险审批 | 中高风险操作必须审批 |
| 审计日志 | 记录所有关键事件 |
| 输出过滤 | 避免向IM回传密钥和长日志 |
| 群聊保护 | 群聊中必须显式@Bot或使用命令前缀 |
| 超时控制 | 长任务自动终止或进入等待状态 |

---

## 22. 与PEtFiSh生态的关系

胖鱼遥控器可以作为PEtFiSh体系中的远程控制模块。

```text
PEtFiSh
  ├── 项目初始化器
  │     └── 初始化AGENTS.md / skills / MCP / uv / tests
  │
  ├── Skills Installer
  │     └── 根据项目类型安装skills
  │
  ├── 胖鱼遥控器 PetFish Remote
  │     └── 通过聊天工具远程控制opencode
  │
  └── Policy Guard
        └── 统一权限、审批、审计
```

对应关系：

| 模块 | 职责 |
|---|---|
| 项目初始化器 | 创建Agent友好工作区 |
| Skills Installer | 安装项目所需skills |
| 胖鱼遥控器 | 提供远程控制面 |
| Policy Guard | 约束Agent行为 |

---

## 23. 推荐实施顺序

建议按以下顺序启动：

```text
1. 创建petfish-remote仓库
2. 建立TypeScript项目
3. 实现config加载
4. 实现Telegram Adapter
5. 实现Project Registry
6. 实现Session Manager
7. 实现CLI Runner
8. 实现/pf list、/pf use、/pf ask、/pf status、/pf stop
9. 加入SQLite任务记录
10. 在一个真实opencode项目中跑通闭环
11. 加入Policy Engine
12. 加入Approval Manager
13. 加入Diff/Test能力
14. 再考虑SDK与plugin
```

---

## 24. 初始开发任务拆分

### Task 1：项目脚手架

交付物：

```text
- package.json
- tsconfig.json
- src/main.ts
- config示例
- README.md
- AGENTS.md
```

### Task 2：配置加载

交付物：

```text
- ConfigLoader
- projects.yaml解析
- users.yaml解析
- policies.yaml解析
```

### Task 3：Telegram Adapter

交付物：

```text
- 接收消息
- 发送消息
- 用户ID解析
- 命令前缀过滤
```

### Task 4：Command Router

交付物：

```text
- /pf help
- /pf list
- /pf use
- /pf ask
- /pf status
- /pf stop
```

### Task 5：Project Registry

交付物：

```text
- 项目查找
- 用户授权检查
- 项目路径校验
```

### Task 6：Session Manager

交付物：

```text
- 聊天与项目绑定
- 活跃任务记录
- 会话恢复
```

### Task 7：OpenCode CLI Runner

交付物：

```text
- child_process封装
- cwd限制
- 超时控制
- stdout/stderr捕获
- 结果摘要返回
```

### Task 8：SQLite Storage

交付物：

```text
- schema.sql
- users表
- sessions表
- tasks表
- audit_logs表
```

### Task 9：Policy Engine

交付物：

```text
- allow/deny/require_approval匹配
- 文件路径策略
- 命令策略
- 项目profile继承
```

### Task 10：Approval Manager

交付物：

```text
- 审批请求创建
- /pf approve
- /pf deny
- 审批状态流转
```

---

## 25. 结论

胖鱼遥控器的价值不在于“做一个聊天机器人”，而在于建立一个面向项目级AI Agent的远程控制平面。

它把手机、聊天工具、opencode、skills、MCP、项目目录、安全策略和审计日志连接成一个完整闭环：

```text
用户意图
  ↓
聊天工具
  ↓
胖鱼遥控器
  ↓
opencode
  ↓
项目工作区
  ↓
结果摘要 / diff / 审批 / 测试反馈
```

首版应该保持克制：

```text
Telegram Bot
+ 项目注册表
+ 只读任务
+ opencode CLI Runner
+ SQLite任务记录
```

随后逐步增强：

```text
审批
+ 策略
+ diff
+ test
+ SDK
+ plugin
+ 多平台
```

只要能够完成以下闭环，胖鱼遥控器就已经成立：

```text
手机发起任务
→ opencode在项目目录执行
→ 返回结构化结论
→ 用户审批风险操作
→ 查看diff和测试结果
→ 生成commit/PR说明
```

这是一条比“手机版opencode”更稳、更安全、更符合工程现实的路线。


---

## 26. 多执行环境支持设计

### 26.1 问题背景

胖鱼遥控器不能假设opencode只运行在当前Host上。

真实使用中，opencode可能运行在多种环境中：

```text
- Windows Host
- Linux Host
- macOS Host
- WSL / WSL2
- Hyper-V Guest
- VMware Guest
- 远程Linux服务器
- 云主机
- Docker开发容器
```

这些环境的差异包括：

| 差异点 | 说明 |
|---|---|
| 路径格式 | Windows路径、Linux路径、WSL路径不同 |
| Shell环境 | PowerShell、cmd、bash、zsh不同 |
| 网络访问 | Host到Guest、Guest到Host、NAT、Bridge差异 |
| 进程管理 | 本地进程、SSH进程、VM内部进程不同 |
| 文件同步 | 共享目录、Git clone、rsync、9p、SMB、VMware shared folder |
| 凭据管理 | SSH key、Bot token、opencode auth位置不同 |
| opencode安装位置 | 每个Runtime中可能有不同版本 |
| MCP连接方式 | MCP server可能运行在Host，也可能在Guest |
| 安全边界 | VM/WSL/Host之间隔离程度不同 |

因此，胖鱼遥控器必须引入一个独立抽象：

> Runtime Connector

也可以称为：

> Execution Runtime Adapter

其目标是让胖鱼遥控器不直接关心opencode到底跑在Host、WSL、Hyper-V还是VMware中，而是通过统一接口调度任务。

---

### 26.2 新增核心抽象：Execution Runtime

原始简化链路：

```text
Chat Adapter
  ↓
PetFish Bridge
  ↓
opencode CLI / SDK
  ↓
Project Workspace
```

需要升级为：

```text
Chat Adapter
  ↓
PetFish Bridge
  ↓
Runtime Router
  ↓
Execution Runtime
  ↓
opencode CLI / SDK / Server
  ↓
Project Workspace
```

架构图：

```text
┌──────────────────────────────┐
│        Telegram / Slack       │
└───────────────┬──────────────┘
                ▼
┌──────────────────────────────┐
│      PetFish Remote Bridge    │
│                              │
│  - Chat Adapter               │
│  - Command Router             │
│  - Project Registry           │
│  - Session Manager            │
│  - Policy Engine              │
│  - Approval Manager           │
└───────────────┬──────────────┘
                ▼
┌──────────────────────────────┐
│        Runtime Router         │
│                              │
│  根据project.runtime选择执行端 │
└───────────────┬──────────────┘
                ▼
┌──────────────────────────────┐
│      Execution Runtime        │
│                              │
│  local-host                   │
│  wsl                          │
│  ssh                          │
│  hyperv-guest                 │
│  vmware-guest                 │
│  docker                       │
└───────────────┬──────────────┘
                ▼
┌──────────────────────────────┐
│        opencode Runtime       │
│                              │
│  CLI / SDK / Server / Plugin  │
└───────────────┬──────────────┘
                ▼
┌──────────────────────────────┐
│       Project Workspace       │
└──────────────────────────────┘
```

---

### 26.3 Runtime类型

胖鱼遥控器应至少支持以下Runtime类型。

| Runtime类型 | 典型场景 | 推荐接入方式 |
|---|---|---|
| `local` | opencode跑在胖鱼遥控器同一Host | 本地child_process |
| `wsl` | opencode跑在WSL2 | `wsl.exe -d <distro> -- bash -lc` |
| `ssh` | opencode跑在远程Linux/VM | SSH |
| `hyperv` | opencode跑在Hyper-V Guest | 优先SSH，备选PowerShell Direct |
| `vmware` | opencode跑在VMware Guest | 优先SSH，备选vmrun |
| `docker` | opencode跑在开发容器 | `docker exec` |
| `server` | opencode server已启动 | HTTP/SDK |

第一版不需要全部实现，但配置模型必须为它们预留。

---

### 26.4 Runtime配置文件

新增配置文件：

```text
config/runtimes.yaml
```

示例：

```yaml
runtimes:
  win-host:
    type: local
    name: "Windows Host"
    shell: "powershell"
    working_root: "D:\\MyWorkSpaces"
    opencode_bin: "opencode"
    path_style: "windows"

  wsl-ubuntu:
    type: wsl
    name: "WSL Ubuntu"
    distro: "Ubuntu-24.04"
    shell: "bash"
    working_root: "/home/kyle/workspaces"
    opencode_bin: "opencode"
    path_style: "linux"

  rswitch-vm:
    type: ssh
    name: "rSwitch Linux VM"
    host: "192.168.56.101"
    port: 22
    user: "kyle"
    identity_file: "~/.ssh/id_ed25519"
    working_root: "/home/kyle/workspaces"
    opencode_bin: "/home/kyle/.local/bin/opencode"
    path_style: "linux"

  hyperv-lab:
    type: hyperv
    name: "Hyper-V Ubuntu Lab"
    vm_name: "ubuntu-opencode-lab"
    preferred_transport: "ssh"
    ssh:
      host: "192.168.122.50"
      port: 22
      user: "kyle"
      identity_file: "~/.ssh/id_ed25519"
    working_root: "/home/kyle/workspaces"
    opencode_bin: "opencode"
    path_style: "linux"

  vmware-lab:
    type: vmware
    name: "VMware Ubuntu Lab"
    vmx_path: "D:\\VMs\\ubuntu-opencode\\ubuntu-opencode.vmx"
    preferred_transport: "ssh"
    ssh:
      host: "192.168.88.130"
      port: 22
      user: "kyle"
      identity_file: "~/.ssh/id_ed25519"
    working_root: "/home/kyle/workspaces"
    opencode_bin: "opencode"
    path_style: "linux"

  opencode-server-rswitch:
    type: server
    name: "opencode server for rSwitch"
    base_url: "http://192.168.56.101:4096"
    working_root: "/home/kyle/workspaces"
    path_style: "linux"
```

---

### 26.5 Project与Runtime绑定

`projects.yaml`中应新增`runtime`字段。

示例：

```yaml
projects:
  rswitch:
    name: "rSwitch"
    runtime: "wsl-ubuntu"
    path: "/home/kyle/workspaces/rswitch"
    default_mode: "guarded"
    risk_profile: "kernel-ebpf"
    allowed_users:
      - "telegram:78910"
    test_commands:
      build: "make build"
      unit: "make test"

  threat-detection-system:
    name: "Threat Detection System"
    runtime: "vmware-lab"
    path: "/home/kyle/workspaces/threat-detection-system"
    default_mode: "guarded"
    risk_profile: "java-docker"
    allowed_users:
      - "telegram:78910"
    test_commands:
      build: "mvn test"
      compose: "docker compose ps"

  skills-team:
    name: "Skills Team"
    runtime: "win-host"
    path: "D:\\MyWorkSpaces\\skills-team"
    default_mode: "guarded"
    risk_profile: "docs-and-tools"
    allowed_users:
      - "telegram:78910"
```

这样用户只需要：

```text
/pf use rswitch
```

胖鱼遥控器自动知道：

```text
项目：rswitch
Runtime：wsl-ubuntu
执行路径：/home/kyle/workspaces/rswitch
调用方式：wsl.exe -d Ubuntu-24.04 -- bash -lc ...
```

---

### 26.6 Runtime Connector统一接口

所有Runtime Connector需要实现统一接口。

TypeScript接口示例：

```ts
export interface RuntimeConnector {
  id: string;
  type: RuntimeType;

  healthCheck(): Promise<RuntimeHealth>;

  run(command: RuntimeCommand): Promise<RuntimeResult>;

  runStreaming(
    command: RuntimeCommand,
    handlers: RuntimeStreamHandlers
  ): Promise<RuntimeResult>;

  resolvePath(projectPath: string): Promise<string>;

  readFile(path: string): Promise<string>;

  writeFile(path: string, content: string): Promise<void>;

  stop(taskId: string): Promise<void>;
}

export interface RuntimeCommand {
  cwd: string;
  command: string;
  timeoutSeconds?: number;
  env?: Record<string, string>;
  taskId?: string;
}

export interface RuntimeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
}

export interface RuntimeHealth {
  ok: boolean;
  runtimeId: string;
  opencodeAvailable: boolean;
  opencodeVersion?: string;
  message?: string;
}
```

核心原则：

> Task Manager只调用RuntimeConnector，不直接调用本地shell。

---

### 26.7 Local Runtime

适用场景：

```text
- 胖鱼遥控器和opencode运行在同一个Host
- 例如Linux服务器上同时运行Telegram Bot和opencode
```

调用方式：

```text
child_process.spawn(command, { cwd })
```

示例：

```bash
cd /home/kyle/workspaces/rswitch
opencode run "..."
```

适合：

```text
- Linux Host
- macOS Host
- Windows Host
```

Windows Host要注意PowerShell转义问题。

---

### 26.8 WSL Runtime

适用场景：

```text
- 胖鱼遥控器运行在Windows Host
- opencode运行在WSL/WSL2
```

推荐调用方式：

```powershell
wsl.exe -d Ubuntu-24.04 -- bash -lc 'cd /home/kyle/workspaces/rswitch && opencode run "...";'
```

WSL Runtime需要处理：

```text
- Windows路径与Linux路径转换
- distro选择
- bash命令转义
- 环境变量传递
- opencode认证文件位置
- WSL是否正在运行
```

配置示例：

```yaml
wsl-ubuntu:
  type: wsl
  distro: "Ubuntu-24.04"
  shell: "bash"
  working_root: "/home/kyle/workspaces"
  opencode_bin: "opencode"
```

路径转换规则：

```text
D:\MyWorkSpaces\repo
  ↓
/mnt/d/MyWorkSpaces/repo
```

但建议首版避免自动转换，直接要求项目路径使用Runtime内部路径。

也就是：

```yaml
path: "/home/kyle/workspaces/rswitch"
```

不要写：

```yaml
path: "D:\\MyWorkSpaces\\rswitch"
```

---

### 26.9 SSH Runtime

适用场景：

```text
- opencode运行在远程Linux服务器
- opencode运行在Hyper-V Guest
- opencode运行在VMware Guest
- opencode运行在云主机
```

推荐优先实现SSH Runtime，因为它可以统一覆盖大部分VM和远程场景。

调用方式：

```bash
ssh -i ~/.ssh/id_ed25519 kyle@192.168.56.101 \
  'cd /home/kyle/workspaces/rswitch && opencode run "..."'
```

SSH Runtime需要处理：

```text
- SSH连接配置
- known_hosts策略
- identity file权限
- 远程cwd
- 远程环境变量
- 超时
- 断线重试
- stdout/stderr回传
- 远程opencode版本检查
```

建议第一版使用系统ssh命令，而不是直接引入复杂SSH库。

---

### 26.10 Hyper-V Runtime

Hyper-V Guest有两种接入方式。

#### 方式一：SSH

推荐首选。

```text
Windows Host
  ↓ SSH
Hyper-V Ubuntu Guest
  ↓
opencode
```

优点：

```text
- 与VMware、远程服务器统一
- 易于调试
- 跨平台心智简单
```

#### 方式二：PowerShell Direct

仅适用于Windows Host控制Windows/部分Linux Hyper-V场景，复杂度较高。

示例方向：

```powershell
Invoke-Command -VMName "ubuntu-opencode-lab" -ScriptBlock { ... }
```

不建议MVP实现。

结论：

> Hyper-V Guest首版按SSH Runtime处理即可。

---

### 26.11 VMware Runtime

VMware Guest也有两种接入方式。

#### 方式一：SSH

推荐首选。

```text
Host
  ↓ SSH
VMware Guest
  ↓
opencode
```

#### 方式二：vmrun

VMware提供`vmrun`命令，可以在Guest中执行程序，但涉及VMware Tools、Guest账号、命令转义和输出捕获，复杂度较高。

示例方向：

```bash
vmrun -T ws -gu kyle -gp password runProgramInGuest xxx.vmx /bin/bash -lc "..."
```

不建议MVP实现。

结论：

> VMware Guest首版也按SSH Runtime处理即可。

---

### 26.12 opencode Server Runtime

当opencode server已经运行时，可以通过HTTP/SDK接入。

适用场景：

```text
- opencode长期运行在某个VM/服务器中
- 胖鱼遥控器只作为控制网关
- 希望复用opencode session和事件流
```

配置示例：

```yaml
opencode-server-rswitch:
  type: server
  base_url: "http://192.168.56.101:4096"
```

安全要求：

```text
- 不应直接暴露到公网
- 应通过Tailscale/WireGuard/SSH tunnel访问
- 应加入token或反向代理鉴权
- 只监听内网地址或127.0.0.1隧道
```

---

### 26.13 Docker Runtime

适用场景：

```text
- 项目开发环境在容器中
- opencode安装在开发容器中
```

调用方式：

```bash
docker exec -w /workspace/rswitch opencode-dev \
  opencode run "..."
```

配置示例：

```yaml
docker-rswitch:
  type: docker
  container: "opencode-dev"
  working_root: "/workspace"
  opencode_bin: "opencode"
```

风险：

```text
- docker exec本身是高权限操作
- 容器挂载目录可能包含Host敏感文件
- 不建议在首版默认启用
```

---

### 26.14 Runtime Health Check

胖鱼遥控器应提供诊断命令：

```text
/pf doctor
```

检查内容：

```text
- Runtime是否可达
- 项目路径是否存在
- opencode是否安装
- opencode版本
- Git是否可用
- AGENTS.md是否存在
- 预设测试命令是否存在
- 当前用户是否有权限
```

示例输出：

```text
胖鱼Runtime检查：

项目：rSwitch
Runtime：wsl-ubuntu
状态：正常

检查结果：
- WSL Distro：Ubuntu-24.04 可用
- 项目路径：/home/kyle/workspaces/rswitch 存在
- opencode：已安装，版本 1.4.0
- Git：可用
- AGENTS.md：存在
- 测试命令 build：make build 已配置

结论：
可以执行远程opencode任务。
```

---

### 26.15 Runtime安全边界

多Runtime支持会扩大攻击面，因此必须加强以下控制。

| 风险 | 控制 |
|---|---|
| 命令注入 | 所有命令通过参数化构造，避免字符串拼接 |
| 路径穿越 | project.path必须在runtime.working_root之下 |
| SSH凭据泄露 | identity_file不得进入日志 |
| 跨Runtime越权 | 用户只能访问授权项目绑定的Runtime |
| Guest逃逸误操作 | 禁止默认执行Hypervisor控制命令 |
| Server暴露 | opencode server不得裸露公网 |
| 共享目录误删 | 删除操作默认拒绝 |
| Windows/WSL路径混淆 | 首版要求使用Runtime内部路径 |
| 多环境状态不一致 | `/pf doctor`检查项目Git状态和opencode版本 |

---

### 26.16 多Runtime下的项目路径原则

必须明确：

> `projects.yaml`中的`path`永远使用Runtime内部看到的路径。

例子：

WSL项目：

```yaml
runtime: "wsl-ubuntu"
path: "/home/kyle/workspaces/rswitch"
```

SSH VM项目：

```yaml
runtime: "rswitch-vm"
path: "/home/kyle/workspaces/rswitch"
```

Windows Host项目：

```yaml
runtime: "win-host"
path: "D:\\MyWorkSpaces\\skills-team"
```

不要让胖鱼遥控器在首版自动猜路径。

需要路径映射时，可后续增加：

```yaml
path_mappings:
  - host: "D:\\MyWorkSpaces"
    runtime: "/mnt/d/MyWorkSpaces"
```

---

### 26.17 多Runtime下的推荐MVP顺序

建议实现顺序：

```text
V0.1：
- local runtime
- wsl runtime
- ssh runtime

V0.2：
- runtime health check
- runtime-level policy
- runtime execution logs

V0.3：
- opencode server runtime
- session reuse
- streaming output

V0.4：
- docker runtime

V0.5：
- hyperv native connector
- vmware native connector
```

关键判断：

> Hyper-V和VMware首版不需要单独实现native connector，只要Guest里能开SSH，就统一走SSH Runtime。

这样能显著降低复杂度。

---

### 26.18 更新后的总体目录结构

新增Runtime相关目录：

```text
petfish-remote/
├── config/
│   ├── projects.yaml
│   ├── runtimes.yaml
│   ├── policies.yaml
│   ├── adapters.yaml
│   └── users.yaml
├── src/
│   ├── runtime/
│   │   ├── RuntimeRouter.ts
│   │   ├── RuntimeConnector.ts
│   │   ├── LocalRuntime.ts
│   │   ├── WslRuntime.ts
│   │   ├── SshRuntime.ts
│   │   ├── DockerRuntime.ts
│   │   ├── ServerRuntime.ts
│   │   ├── HyperVRuntime.ts
│   │   └── VMwareRuntime.ts
│   ├── opencode/
│   │   ├── OpenCodeRunner.ts
│   │   ├── OpenCodeCliRunner.ts
│   │   ├── OpenCodeSdkRunner.ts
│   │   └── PromptBuilder.ts
│   └── core/
│       ├── ProjectRegistry.ts
│       ├── SessionManager.ts
│       ├── TaskManager.ts
│       ├── PolicyEngine.ts
│       └── ApprovalManager.ts
```

注意：

```text
OpenCodeRunner不直接执行shell。
OpenCodeRunner通过RuntimeConnector执行命令。
```

调用链应为：

```text
TaskManager
  ↓
OpenCodeRunner
  ↓
RuntimeRouter
  ↓
RuntimeConnector
  ↓
实际Runtime中的opencode
```

---

### 26.19 多Runtime后的任务执行流程

```text
1. 用户发送 /pf ask ...
2. CommandRouter解析任务
3. SessionManager确定当前项目
4. ProjectRegistry读取项目配置
5. ProjectRegistry找到project.runtime
6. RuntimeRouter加载对应RuntimeConnector
7. PolicyEngine检查用户、项目、Runtime权限
8. OpenCodeRunner构造opencode命令
9. RuntimeConnector在目标环境执行
10. TaskManager收集结果
11. MessageRenderer生成移动端摘要
12. Chat Adapter回传消息
```

---

### 26.20 多Runtime支持的结论

胖鱼遥控器必须支持Host、WSL、Hyper-V Guest、VMware Guest等多种opencode运行环境。

但实现策略不能一开始就为每种虚拟化平台写复杂适配器，而应采用两层抽象：

```text
Project Registry：项目绑定到哪个Runtime
Runtime Connector：如何在该Runtime中执行opencode
```

首版最值得实现的三个Runtime是：

```text
local
wsl
ssh
```

其中：

```text
Hyper-V Guest → 优先走SSH Runtime
VMware Guest → 优先走SSH Runtime
远程服务器 → 走SSH Runtime
云主机 → 走SSH Runtime
```

后续只有在确实需要时，才增加：

```text
HyperVRuntime
VMwareRuntime
DockerRuntime
ServerRuntime
```

这样既能覆盖真实使用场景，又不会把MVP复杂度拉爆。

