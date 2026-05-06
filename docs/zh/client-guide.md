# 客户端安装使用指南

## 1. 概述

Connector 是运行在本地计算机或开发机上的守护进程。它的作用是主动向 Bot Server 发起 WebSocket 连接，接收来自 Telegram 的远程指令，并将其转发给本地的 OpenCode 进程，同时将执行结果返回给用户。

## 2. 前置要求

在安装 Connector 之前，请确保目标机器已安装以下基础依赖：

- Node.js ≥ 18
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
- `--no-start`：（可选）仅安装，完成后不立即启动服务。

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

系统提供 `petfish-connect.sh` 脚本管理 Connector 进程，默认以后台守护模式运行。

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

绑定成功后，即可在 Telegram 中控制本地项目。

- **绑定项目**：发送 `/pf use <project>` 激活特定项目。
- **对话交互**：直接发送文字内容，等同于 `ask` 指令，直接转发给 OpenCode。
- **快捷菜单**：发送 `/pf` 唤出 InlineKeyboard，提供常用快捷操作。
- **新建会话**：发送 `/pf new` 开启一个干净的交互上下文。
- **项目列表**：发送 `/pf list` 查看当前所有可用的本地项目。

## 8. 配置文件说明

`connector.yaml` 存储了客户端的核心配置，主要字段如下：

```yaml
# 核心认证信息
token: "YOUR_PERSISTENT_CONNECTOR_TOKEN"

# 目标 Bot Server 地址
serverUrl: "wss://remote.petfish.ai/ws/connector"

# 本地项目列表
projects:
  - id: "my-webapp"
    name: "My WebApp"
    path: "/home/user/workspace/my-webapp"
```

*注意：切勿将包含真实 token 的 `connector.yaml` 提交到版本控制系统中。*

## 9. 环境变量

Connector 运行时受以下环境变量影响：

- `PETFISH_REMOTE_DIR`：指定 Connector 的安装与运行根目录（默认 `~/.petfish/remote/`）。
- `OPENCODE_PID`：绑定本地特定的 OpenCode 进程实例。
- `PETFISH_SERVER_URL`：覆盖默认的服务器地址（适用于连接自部署服务器）。

## 10. 版本更新

Connector 具备自动更新机制。每次启动时，程序会向 `/api/version` 接口请求最新版本号。若本地版本落后，Connector 将自动执行 `git pull` 与 `npm run build`，并使用新版本重新拉起服务。

## 11. 故障排查

| 常见报错 / 现象 | 可能原因 | 解决方案 |
| --- | --- | --- |
| `Connection refused` | 无法连接到 Bot Server | 检查网络连通性，或验证 `PETFISH_SERVER_URL` 是否正确。 |
| `Invalid token` | Token 过期或无效 | 在 Telegram 发送 `/start` 获取新 token 并重新执行 setup。 |
| `No active project` | 未在 Telegram 选择目标项目 | 在 Telegram 发送 `/pf use <project>` 进行绑定。 |
| 日志无输出且进程退出 | Node.js 版本过低 | 升级 Node.js 至 18 或以上版本。 |