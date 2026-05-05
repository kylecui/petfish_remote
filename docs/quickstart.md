# 快速开始

本指南面向第一次使用 PetFish Remote 的用户，目标是在约 10 分钟内完成：

- 本地安装依赖
- 配置 Telegram Bot Token
- 注册第一个受控项目
- 绑定 Telegram 用户权限
- 启动服务并完成首轮验证

> 说明：本文只覆盖“从零到可用”的最小流程，不展开部署、systemd、Docker 等上线内容。

## 1. 前置要求

开始前请确认以下环境已经就绪：

1. Node.js 版本 **>= 20**（建议使用 LTS）
2. npm 可用（随 Node.js 安装）
3. opencode CLI 已安装，并能在终端直接调用
4. 已通过 Telegram 的 `@BotFather` 创建 Bot，并拿到 Bot Token

可选检查命令：

```bash
node -v
npm -v
opencode --version
```

如果 `node -v` 的主版本小于 20，请先升级 Node.js，再继续。

---

## 2. 克隆与安装

### 2.1 克隆仓库

```bash
git clone <你的仓库地址> petfish_remote
cd petfish_remote
```

### 2.2 一键安装（推荐）

项目内置安装脚本会自动完成依赖安装、构建与运行目录初始化：

```bash
./scripts/install.sh
```

该脚本会执行：

- Node.js 版本检查（>=20）
- `npm install`
- `npm run build`
- 创建 `.runtime/attachments` 与 `.runtime/logs`

### 2.3 手动安装（可选）

如果你不想使用脚本，也可以手动执行：

```bash
npm install
npm run build
```

---

## 3. 环境配置

### 3.1 复制环境变量模板

```bash
cp .env.example .env
```

### 3.2 编辑 `.env`

最少需要配置 Telegram Bot Token；其余变量可先使用默认值。

```dotenv
TELEGRAM_BOT_TOKEN=你的真实TelegramBotToken
PETFISH_CONFIG_DIR=./config
PETFISH_RUNTIME_DIR=./.runtime
PETFISH_LOG_LEVEL=info
```

变量说明：

- `TELEGRAM_BOT_TOKEN`：必填，来自 `@BotFather`
- `PETFISH_CONFIG_DIR`：配置目录，默认 `./config`
- `PETFISH_RUNTIME_DIR`：运行时目录，默认 `./.runtime`

---

## 4. 注册第一个项目

编辑 `config/projects.yaml`，注册一个可被遥控的项目。

下面示例包含模板中的全部字段（可直接参考后替换为你的真实路径）：

```yaml
projects:
  demo:
    name: "Demo Project"
    runtime: "local"
    path: "/home/yourname/workspace/demo-project"
    default_mode: "edit_guarded"
    default_agent: "code-reviewer"
    allowed_users:
      - "telegram:123456789"
    readme_files:
      - "AGENTS.md"
      - "README.md"
    test_commands:
      unit: "npm test"
      build: "npm run build"
      lint: "npm run lint"
    risk_profile: "default"
    secrets_policy: "deny_read"
```

字段要点：

- `projects.demo`：这里的 `demo` 是项目标识，后续 `/pf use <project>` 会用到
- `path`：必须是目标项目在本机的真实绝对路径
- `allowed_users`：允许操作该项目的 Telegram 用户列表

---

## 5. 配置用户

编辑 `config/users.yaml`，将 Telegram 用户 ID 绑定到刚才的项目。

```yaml
users:
  - id: "telegram:123456789"
    name: "Alice"
    role: "owner"
    allowed_projects:
      - "demo"
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

你需要替换的核心值：

- `id`：改成你的 Telegram 用户 ID，格式固定为 `telegram:数字ID`
- `allowed_projects`：包含你在 `config/projects.yaml` 中定义的项目标识（如 `demo`）

---

## 6. 启动

### 6.1 开发模式

```bash
npm run dev
```

开发模式使用 `tsx watch src/main.ts`，适合调试与配置验证。

### 6.2 生产模式

先确保已经构建：

```bash
npm run build
```

再启动：

```bash
npm start
```

生产模式执行 `node dist/main.js`。

---

## 7. 验证

服务启动后，打开 Telegram，找到你的 Bot，对话中按顺序发送：

1. `/pf help`
2. `/pf list`

预期结果：

- 发送 `/pf help` 后，Bot 返回帮助信息
- 发送 `/pf list` 后，Bot 返回可用项目列表（应包含你配置的 `demo`）

接着可以做一次最小功能走通：

```text
/pf use demo
/pf ask 请读取README并总结当前项目用途
```

如果 `use` 成功，说明“用户权限 + 项目注册 + 基础命令链路”已经可用。

常见首轮问题：

- `/pf list` 为空：检查 `config/projects.yaml` 格式与缩进
- 提示无权限：检查 `config/users.yaml` 的 `id` 与 `allowed_projects`
- Bot 无响应：检查 `.env` 中 `TELEGRAM_BOT_TOKEN` 是否正确

---

## 8. 下一步

完成 Quick Start 后，建议按以下顺序继续：

1. `docs/configuration.md`（完整配置项与策略说明）
2. `docs/usage.md`（命令与日常使用流程）
3. `docs/deployment.md`（生产部署与运行维护）

你也可以继续在 Telegram 中尝试：

- `/pf use <project>` 切换项目
- `/pf ask <instruction>` 提交指令

到这里，你已经完成从零到可运行的最小闭环。
