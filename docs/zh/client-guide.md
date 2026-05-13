# 客户端安装使用指南

## 1. 概述

Connector 是运行在本地计算机或开发机上的守护进程。它的作用是主动向 Bot Server 发起 WebSocket 连接，接收来自 Telegram、Slack、飞书、企业微信和 Web 的远程指令，并将其转发给本地的 OpenCode 进程，同时将执行结果返回给用户。

## 2. 前置要求

在安装 Connector 之前，请确保目标机器已安装以下基础依赖：

- Node.js ≥ 20
- git
- curl

## 3. 一键安装（推荐）

我们提供了一键安装脚本，自动处理仓库克隆与依赖安装。

### 获取安装 Token

1. 在 Telegram 中搜索并打开 `@petfish_bot`。
2. 发送 `/start` 指令。
3. Bot 会返回一段包含一次性 Token 的安装命令。

### 执行安装

在本地终端中运行获取到的命令：

```bash
curl -sSL https://remote.petfish.ai/install | bash -s -- <token> [project-id]
```

**参数说明：**

- `<token>`：Telegram Bot 提供的一次性认证凭证。
- `[project-id]`：（可选）为当前项目指定一个唯一标识符。
- `--project-path`：（可选）绑定项目的绝对路径。
- `--project-name`：（可选）项目易读名称。
- `--agent <type>`：（可选）指定 AI Agent 类型：auto、opencode、gemini、codex（默认 auto）。
- `--no-start`：（可选）仅安装，完成后不立即启动服务。
- `--force-register`：完全重新注册。

**安装路径：**

Connector 默认安装至 `~/.petfish/remote/` 目录。如需更改，可在执行脚本前设置 `PETFISH_REMOTE_DIR` 环境变量。

## 4. 手动安装

如果所处网络环境受限，可选择手动编译安装。

```bash
git clone https://github.com/kylecui/petfish_remote ~/.petfish/remote
cd ~/.petfish/remote
npm install
npm run build
./petfish-connect.sh setup <token> [project-id]
./petfish-connect.sh start ./connector.yaml
```

## 5. 日常使用

系统提供 `petfish-connect.sh` 脚本管理 Connector 进程，默认以后台守护模式运行。Windows 用户请使用 `petfish-connect.ps1` 替代 `petfish-connect.sh`。

- **启动服务**：`petfish-connect.sh start ./connector.yaml`
- **停止服务**：`petfish-connect.sh stop`
- **重启服务**：`petfish-connect.sh restart`
- **查看状态**：`petfish-connect.sh status`
- **查看日志**：`petfish-connect.sh logs`

## 6. AI Agent自启动集成

为实现无缝体验，建议将 Connector 集成到 OpenCode 的启动流中。请在项目的 `AGENTS.md` 文件中追加以下标准模板：

```markdown
# PetFish Remote 自动唤醒

每次 OpenCode 启动时，系统应自动检查 Connector 状态并按需拉起。

- **检查方式**：执行 `~/.petfish/remote/petfish-connect.sh status`
- **拉起方式**：如果未运行，执行 `~/.petfish/remote/petfish-connect.sh start ~/.petfish/remote/connector.yaml`
```

## 7. Telegram 使用方式

绑定成功后，即可在 Telegram 中控制本地项目。飞书也支持相同的命令。

- **绑定项目**：发送 `/pf use <project>` 激活特定项目。
- **对话交互**：直接发送文字内容，等同于 `ask` 指令，直接转发给 OpenCode。
- **快捷菜单**：发送 `/pf` 唤出 InlineKeyboard，提供常用快捷操作。
- **新建会话**：发送 `/pf new` 开启一个干净的交互上下文。
- **项目列表**：发送 `/pf list` 查看当前所有可用的本地项目。

## 8. 多 Agent 支持

PetFish Remote 支持多种 AI 编程助手作为后端：

- opencode（稳定）、Gemini CLI（Beta）、Codex CLI（Beta）
- 安装时通过 `--agent` 参数选择，或在 `connector.yaml` 中配置 `agent` 字段
- 当 `agent` 设置为 `auto`（默认值）时，Connector启动时自动检测可用的Agent
- 检测优先级：opencode > gemini > codex
- 如果未找到任何Agent二进制文件，Connector将报错退出
- 安装脚本会在启动前检测所选 agent 二进制文件是否存在，如未找到会发出警告

## 9. 多平台设置（Telegram / Slack / 飞书 / 企业微信 / Web）

- PetFish Remote支持同时从Telegram和飞书控制同一组项目
- 添加第二个平台：在新平台发送/start获取token，然后在已有connector.yaml的项目目录重新运行安装命令
- 安装脚本会自动检测已有的connector.yaml，调用 /api/add-platform 添加平台
- 现有的connector token和WebSocket连接不受影响
- 使用 `--force-register` 可完全重新注册

## 10. 配置文件说明

`connector.yaml` 存储了客户端的核心配置，主要字段如下：

```yaml
connectorId: auto
serverUrl: "wss://remote.petfish.ai/ws/connector"
token: "<connector-auth-token>"
reconnectIntervalMs: 5000
maxReconnectIntervalMs: 60000

projects:
  - id: my-project
    name: "My Project"
    path: /home/user/code/my-project
    agent: opencode
```

- `connectorId`: Connector身份标识（使用 `auto` 由服务器自动分配）
- `serverUrl`: Bot Server的WebSocket地址（注意：使用 `wss://` 协议）
- `token`: 持久化的Connector认证Token，注册时自动生成 — 请勿手动修改
- `reconnectIntervalMs` / `maxReconnectIntervalMs`: WebSocket重连间隔（可选，图中为默认值）
- `projects`: 本地项目列表。每个项目包含 `id`、`path`、`name`（可选）、`agent` 字段

*注意：切勿将包含真实 token 的 `connector.yaml` 提交到版本控制系统中。*

## 11. Token类型与重新绑定

- 一次性安装Token：通过 /start 获取，5分钟过期，32位十六进制字符串
- Connector Token：注册时自动生成，永久有效，存储在connector.yaml的token字段中，格式为base64url字符串
- 警告：请勿手动编辑connector.yaml中的token字段
- 警告：请勿将 /start 获取的一次性Token粘贴到connector.yaml中 — 会导致认证失败并提示具体错误
- 添加平台请使用标准流程；如需重新开始，使用 --force-register

## 12. 环境变量

Connector 运行时受以下环境变量影响：

- `PETFISH_REMOTE_DIR`：指定 Connector 的安装与运行根目录（默认 `~/.petfish/remote/`）。
- `OPENCODE_PID`：绑定本地特定的 OpenCode 进程实例。
- `PETFISH_SERVER_URL`：覆盖默认的服务器地址（适用于连接自部署服务器）。

## 13. 版本更新

Connector 具备自动更新机制。每次启动时，程序会向 `/api/version` 接口请求最新版本号。若本地版本落后，Connector 将自动执行 `git pull` 与 `npm run build`，并使用新版本重新拉起服务。

## 14. 故障排查

| 常见报错 / 现象 | 可能原因 | 解决方案 |
| --- | --- | --- |
| `Connection refused` | 无法连接到 Bot Server | 检查网络连通性，或验证 `PETFISH_SERVER_URL` 是否正确。 |
| `Invalid token` | Token 过期或无效 | 在 Telegram 发送 `/start` 获取新 token 并重新执行 setup。 |
| `No active project` | 未在 Telegram 选择目标项目 | 在 Telegram 发送 `/pf use <project>` 进行绑定。 |
| 日志无输出且进程退出 | Node.js 版本过低 | 升级 Node.js 至 20 或以上版本。 |
