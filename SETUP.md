# PetFish Remote — 遥控器安装指南

> **目标读者**: 运行在 opencode session 中的 AI Agent。
> 按照本文档操作后，你的 opencode 项目将接入 PetFish Remote（胖鱼遥控器），用户可通过 Telegram 远程控制你的 session。

## 你需要做什么

1. 安装 connector 依赖（一次性）
2. 获取注册 token（通过 Telegram /start）
3. 运行 `petfish-connect.sh setup` 自动注册并生成配置
4. 启动 connector 进程（每次 opencode 启动时）
5. 写入 AGENTS.md 自启动指令（确保持久化）

---

## Step 1: 安装 Connector

petfish_remote 仓库提供 connector 的可执行代码。确保本机已有最新构建：

```bash
# 如果 /home/kylecui/dev/petfish_remote 已存在且已构建，跳过此步
cd /home/kylecui/dev/petfish_remote && git pull && npm install && npm run build
```

如果该目录不存在：

```bash
git clone https://github.com/kylecui/petfish_remote.git /home/kylecui/dev/petfish_remote
cd /home/kylecui/dev/petfish_remote && npm install && npm run build
```

## Step 2: 获取注册 Token

在 Telegram 中向 @petfish_bot 发送 `/start`。Bot 会返回一个一次性 setup token（5分钟有效）。

示例回复：
```
><(((^> PetFish Remote — 胖鱼遥控器

Setup your connector:
  petfish-connect setup \
    --token a1b2c3d4e5f6... \
    --project-id <your-project>

Token valid for 5 minutes.
```

## Step 3: 注册项目（自动）

在你的项目根目录执行 setup 命令。这会自动：
- 向服务器注册项目
- 获取持久 connector token
- 生成 `connector.yaml` 配置文件

```bash
/home/kylecui/dev/petfish_remote/scripts/petfish-connect.sh setup \
  --token <从Telegram获取的token> \
  --project-id <项目短名> \
  --project-path $(pwd)
```

**参数说明：**
- `--token` → 从 Telegram /start 获取的一次性 token（必填）
- `--project-id` → 项目短名（如 `my-app`），小写，用 `-` 连接（必填）
- `--project-path` → 项目绝对路径，默认为当前目录（可选）
- `--project-name` → 项目显示名，默认等于 project-id（可选）
- `--server` → 服务器地址，默认 `https://remote.petfish.ai`（可选）
- `--opencode-bin` → opencode 二进制路径，自动检测（可选）
- `--output` → 配置输出路径，默认 `./connector.yaml`（可选）

期望输出：
```
><(((^> petfish-connect: registering with server...
   server: https://remote.petfish.ai
   project: my-app (my-app)
   path: /home/kylecui/dev/my-app

   ✅ Registration successful!
   Config written to: ./connector.yaml

Start the connector with:
  petfish-connect.sh start ./connector.yaml
```

将 `connector.yaml` 加入 `.gitignore`（含 token，不应提交）：

```bash
echo "connector.yaml" >> .gitignore
```

## Step 4: 启动 Connector

在你的 opencode session 中执行以下命令。脚本会以 daemon 模式启动 connector（使用 nohup + disown），进程会在 bash 工具退出后继续存活：

```bash
OPENCODE_PID=$(pgrep -x "opencode" | head -1) \
  /home/kylecui/dev/petfish_remote/scripts/petfish-connect.sh start ./connector.yaml
```

**⚠️ 重要：必须使用 `petfish-connect.sh start` 命令。不要直接 `node dist/connector/main.js` — 那样会在 opencode bash 工具超时后被杀掉。**

期望输出：

```
><(((^> petfish-connect: starting daemon
   config: /path/to/project/connector.yaml
   log: /tmp/petfish-connector-project.log
   opencode PID: 12345
   status: ✅ registered with server
   PID: 67890

Connector is running in background. It will survive terminal close.
```

验证 connector 确实注册成功：

```bash
ssh root@38.55.160.238 "journalctl -u petfish-remote --no-pager -n 5 | grep -i register"
```

其它管理命令：

```bash
/home/kylecui/dev/petfish_remote/scripts/petfish-connect.sh status ./connector.yaml
/home/kylecui/dev/petfish_remote/scripts/petfish-connect.sh stop ./connector.yaml
/home/kylecui/dev/petfish_remote/scripts/petfish-connect.sh restart ./connector.yaml
/home/kylecui/dev/petfish_remote/scripts/petfish-connect.sh logs ./connector.yaml
```

## Step 5: 写入自启动指令到 AGENTS.md

为了确保每次 opencode 启动都能自动加载遥控器，在项目的 `AGENTS.md` 中添加以下内容：

```bash
cat >> AGENTS.md << 'EOF'

## PetFish Remote (胖鱼遥控器)

本项目已接入 PetFish Remote。每次 session 启动时，需确保 connector 进程运行。

### 自动检查与启动

在每次 session 开始时（收到用户第一条消息前），执行：

```bash
if ! pgrep -f "dist/connector/main.js.*connector.yaml" > /dev/null 2>&1; then
  OPENCODE_PID=$(pgrep -x "opencode" | head -1) \
    /home/kylecui/dev/petfish_remote/scripts/petfish-connect.sh start ./connector.yaml
fi
```

### 管理命令

```bash
/home/kylecui/dev/petfish_remote/scripts/petfish-connect.sh status ./connector.yaml
/home/kylecui/dev/petfish_remote/scripts/petfish-connect.sh logs ./connector.yaml
```

### 用户使用方式

用户在 Telegram @petfish_bot 中：
- `/pf use PROJECT_ID` 绑定项目
- 之后直接发消息即可控制本 session
EOF
```

**记得把 `PROJECT_ID` 替换为你的实际项目 ID。**

## 验证完成

完成所有步骤后，通知用户：

```
><(((^> 胖鱼遥控器 — 已连接 ✅

配置完成。用户可在 Telegram @petfish_bot 中：
  /pf use PROJECT_ID
  然后直接发消息即可控制本 session。
```

---

## 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| `AUTH_FAILED` | token 不对 | 重新执行 `petfish-connect.sh setup` 获取新 token |
| `Registration failed (HTTP 401)` | setup token 过期或已使用 | 在 Telegram 重新 `/start` 获取新 token |
| `SessionBridge init failed` | OPENCODE_PID 不正确 | 用 `pgrep -x "opencode"` 获取正确 PID |
| `/pf list` 看不到项目 | 项目未注册 | 执行 `petfish-connect.sh setup` 注册项目 |
| `/pf use` 报 Access denied | allowed_users 没加 | 重新 setup 或手动在服务器 projects.yaml 添加用户 |
| 发消息无响应 | connector 未连接 | `petfish-connect.sh status` 检查，`petfish-connect.sh logs` 看日志 |
| connector 曾连接但现在不响应 | 服务器重启后 connector 断连 | `petfish-connect.sh restart ./connector.yaml` |
| Connector process died immediately | build 过期或配置错误 | `cd /home/kylecui/dev/petfish_remote && git pull && npm run build`，然后重试 |
| Connector already running | 上次未正常停止 | `petfish-connect.sh stop` 后再 `start` |

## 服务器信息

| 项目 | 值 |
|------|------|
| 服务器 | root@38.55.160.238 |
| 服务名 | petfish-remote (systemd) |
| 配置目录 | /opt/petfish-remote/config/ |
| WebSocket | wss://remote.petfish.ai/ws/connector |
| Bot | @petfish_bot |
| Connector Token (alpha) | e80Mft2NAjly5hQSSo9C1juSfjH9x_mVCcSI2VmFgKE |
| 用户 Telegram ID | 685608515 |
