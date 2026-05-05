# 配置参考

本文档是 PetFish Remote 的配置字段参考，仅覆盖配置项定义与含义，不包含使用流程说明。

## 1. 环境变量（`.env`）

来源：`.env.example`

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | string | 必填（启用 Telegram 时） | 无 | Telegram Bot Token，由 `@BotFather` 创建并获取。 |
| `SLACK_SIGNING_SECRET` | string | 可选 | 空 | Slack 请求签名密钥，对应 Slack Adapter 的 `signing_secret_env`。 |
| `SLACK_BOT_TOKEN` | string | 可选 | 空 | Slack Bot Token，对应 Slack Adapter 的 `bot_token_env`。 |
| `FEISHU_APP_ID` | string | 可选 | 空 | Feishu 应用 App ID，对应 Feishu Adapter 的 `app_id_env`。 |
| `FEISHU_APP_SECRET` | string | 可选 | 空 | Feishu 应用 App Secret，对应 Feishu Adapter 的 `app_secret_env`。 |
| `PETFISH_CONFIG_DIR` | string | 可选 | `./config` | 配置目录路径。 |
| `PETFISH_RUNTIME_DIR` | string | 可选 | `./.runtime` | 运行时目录路径。 |
| `PETFISH_LOG_LEVEL` | string | 可选 | `info` | 日志级别，可用值：`info` / `debug` / `warn` / `error`。 |

---

## 2. `config/projects.yaml`（项目注册）

顶层结构：`projects`（map，key 为项目标识）。

### 字段说明（单个项目）

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `name` | string | 必填 | 无 | 项目展示名。 |
| `runtime` | string | 必填 | 无 | 绑定运行时名称，需在 `runtimes.yaml` 中存在。 |
| `path` | string | 必填 | 无 | 项目在目标运行时中的工作目录路径。 |
| `default_mode` | enum | 必填 | 无 | 默认执行模式：`read_only` / `suggest` / `edit_guarded` / `execute_guarded` / `admin`。 |
| `default_agent` | string | 可选 | 无 | 默认 Agent 名称。 |
| `allowed_users` | string[] | 可选 | `[]` | 允许访问该项目的用户列表，格式如 `telegram:12345`。 |
| `readme_files` | string[] | 可选 | `[]` | 任务初始化时优先读取的文档文件列表。 |
| `test_commands` | map<string,string> | 可选 | `{}` | 预置测试命令映射，key 为命令名，value 为执行命令。 |
| `risk_profile` | string | 可选 | 无 | 风险策略标签（与策略体系结合使用）。 |
| `secrets_policy` | string | 可选 | 无 | Secrets 访问策略标签。 |

### 完整示例（无注释）

```yaml
projects:
  rswitch:
    name: "rSwitch"
    runtime: "local"
    path: "/home/kyle/workspace/rswitch"
    default_mode: "edit_guarded"
    default_agent: "code-reviewer"
    allowed_users:
      - "telegram:78910"
    readme_files:
      - "AGENTS.md"
      - "README.md"
    test_commands:
      unit: "make test"
      build: "make build"
      lint: "make lint"
    risk_profile: "default"
    secrets_policy: "deny_read"
```

---

## 3. `config/policies.yaml`（安全策略）

顶层结构：`policies`（map，key 为策略名）。

### 策略结构

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `inherit` | string | 可选 | 无 | 继承的父策略名称。 |
| `deny` | string[] | 可选 | `[]` | 显式拒绝规则。 |
| `require_approval` | string[] | 可选 | `[]` | 需要人工审批的规则。 |
| `allow` | string[] | 可选 | `[]` | 显式允许规则。 |

规则格式：`"action:glob"`。

- `action` 可选：`read` / `write` / `exec` / `git` / `docker`
- `glob` 为匹配模式（支持 `*`、`**` 等）

### 默认策略（文件中现有内容）

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
```

### `kernel-ebpf` 继承 `default` 示例

```yaml
policies:
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

## 4. `config/users.yaml`（用户与角色）

顶层结构：`users`（list）+ `roles`（map）。

### `users` 字段说明

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `id` | string | 必填 | 无 | 用户标识，推荐格式：`telegram:NNNNN`。 |
| `name` | string | 必填 | 无 | 用户显示名。 |
| `role` | enum | 必填 | 无 | 角色：`owner` / `developer` / `viewer`。 |
| `allowed_projects` | string[] | 可选 | `[]` | 用户可访问的项目标识列表。 |
| `allowed_modes` | enum[] | 可选 | `[]` | 用户可用执行模式：`read_only` / `suggest` / `edit_guarded` / `execute_guarded` / `admin`。 |

### `roles` 字段说明

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `can_approve` | boolean | 必填 | 无 | 是否可审批高风险操作。 |
| `can_manage_projects` | boolean | 必填 | 无 | 是否可管理项目配置。 |
| `can_run_tests` | boolean | 必填 | 无 | 是否可执行预置测试命令。 |

### 完整示例（无注释）

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
      - "admin"

  - id: "telegram:34567"
    name: "Alice"
    role: "developer"
    allowed_projects:
      - "rswitch"
    allowed_modes:
      - "read_only"
      - "suggest"
      - "edit_guarded"
      - "execute_guarded"

  - id: "telegram:90123"
    name: "Bob"
    role: "viewer"
    allowed_projects:
      - "rswitch"
    allowed_modes:
      - "read_only"

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

---

## 5. `config/adapters.yaml`（聊天平台配置）

顶层结构：`adapters`（map）。

### `telegram`

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `enabled` | boolean | 必填 | `true` | 是否启用 Telegram Adapter。 |
| `token_env` | string | 必填 | `TELEGRAM_BOT_TOKEN` | Telegram Token 的环境变量名。 |
| `webhook.enabled` | boolean | 必填 | `false` | 是否启用 webhook 模式。 |
| `webhook.url` | string | 可选 | `""` | webhook URL。 |
| `polling.enabled` | boolean | 必填 | `true` | 是否启用 polling 模式。 |

### `slack`

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `enabled` | boolean | 必填 | `false` | 是否启用 Slack Adapter。 |
| `signing_secret_env` | string | 必填（启用时） | `SLACK_SIGNING_SECRET` | Slack 签名密钥对应的环境变量名。 |
| `bot_token_env` | string | 必填（启用时） | `SLACK_BOT_TOKEN` | Slack Bot Token 对应的环境变量名。 |

### `feishu`

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `enabled` | boolean | 必填 | `false` | 是否启用 Feishu Adapter。 |
| `app_id_env` | string | 必填（启用时） | `FEISHU_APP_ID` | Feishu App ID 对应的环境变量名。 |
| `app_secret_env` | string | 必填（启用时） | `FEISHU_APP_SECRET` | Feishu App Secret 对应的环境变量名。 |

### `wecom` / `discord`

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `enabled` | boolean | 必填 | `false` | 占位 Adapter 开关（当前仅包含启用字段）。 |

---

## 6. `config/runtimes.yaml`（运行时环境）

顶层结构：`runtimes`（map，key 为运行时名称）。

### 通用字段

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `type` | enum | 必填 | 无 | 运行时类型：`local` / `wsl` / `ssh` / `server`。 |
| `name` | string | 必填 | 无 | 运行时展示名。 |
| `shell` | string | 条件必填（`local`/`wsl`） | 无 | 执行 shell，例如 `bash`。 |
| `working_root` | string | 必填 | 无 | 运行时工作根目录。 |
| `opencode_bin` | string | 条件必填（`local`/`wsl`/`ssh`） | 无 | opencode 可执行文件名或路径。 |
| `path_style` | string | 必填 | 无 | 路径风格（示例中为 `linux`）。 |

### WSL 专有字段

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `distro` | string | 必填（`type: wsl`） | 无 | WSL 发行版名称，例如 `Ubuntu-24.04`。 |

### SSH 专有字段

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `host` | string | 必填（`type: ssh`） | 无 | SSH 目标主机地址。 |
| `port` | number | 可选 | `22`（示例） | SSH 端口。 |
| `user` | string | 必填（`type: ssh`） | 无 | SSH 用户名。 |
| `identity_file` | string | 可选 | 无 | SSH 私钥文件路径。 |

### Server 专有字段

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `base_url` | string | 必填（`type: server`） | 无 | opencode server 地址。 |

### 类型示例（包含 local / wsl / ssh / server）

```yaml
runtimes:
  local:
    type: local
    name: "Local Host"
    shell: "bash"
    working_root: "/home"
    opencode_bin: "opencode"
    path_style: "linux"

  wsl-ubuntu:
    type: wsl
    name: "WSL Ubuntu"
    distro: "Ubuntu-24.04"
    shell: "bash"
    working_root: "/home/kyle/workspaces"
    opencode_bin: "opencode"
    path_style: "linux"

  remote-server:
    type: ssh
    name: "Remote Linux Server"
    host: "192.168.56.101"
    port: 22
    user: "kyle"
    identity_file: "~/.ssh/id_ed25519"
    working_root: "/home/kyle/workspaces"
    opencode_bin: "opencode"
    path_style: "linux"

  opencode-server:
    type: server
    name: "opencode server"
    base_url: "http://127.0.0.1:4096"
    working_root: "/home/kyle/workspaces"
    path_style: "linux"
```

---

## 7. `config/runtime.yaml`（运行时设置）

顶层结构：`runtime`（object）。

| 名称 | 类型 | 必填/可选 | 默认值 | 说明 |
|---|---|---|---|---|
| `storage` | string | 必填 | `sqlite` | 存储后端类型。 |
| `sqlite_path` | string | 条件必填（`storage=sqlite`） | `.runtime/petfish.db` | SQLite 数据库文件路径。 |
| `attachments_dir` | string | 必填 | `.runtime/attachments` | 附件目录路径。 |
| `logs_dir` | string | 必填 | `.runtime/logs` | 日志目录路径。 |
| `max_task_runtime_seconds` | number | 必填 | `1800` | 单任务最大运行时长（秒）。 |
| `max_message_length` | number | 必填 | `3500` | 单条消息最大长度。 |
| `default_mode` | enum | 必填 | `read_only` | 全局默认执行模式：`read_only` / `suggest` / `edit_guarded` / `execute_guarded` / `admin`。 |
