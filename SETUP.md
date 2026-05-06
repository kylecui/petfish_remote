# PetFish Remote — 遥控器安装指南

> **目标读者**: 运行在 opencode session 中的 AI Agent。
> 按照本文档操作后，你的 opencode 项目将接入 PetFish Remote（胖鱼遥控器），用户可通过 Telegram 远程控制你的 session。

## 你需要做什么

1. 安装 connector 依赖（一次性）
2. 创建 `connector.yaml` 配置（一次性）
3. 在服务器注册项目（一次性）
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

## Step 2: 创建 connector.yaml

在 **你的项目根目录** 创建 `connector.yaml`：

```bash
cat > connector.yaml << 'EOF'
connectorId: auto
serverUrl: "wss://remote.petfish.ai/ws/connector"
token: "e80Mft2NAjly5hQSSo9C1juSfjH9x_mVCcSI2VmFgKE"
reconnectIntervalMs: 5000
maxReconnectIntervalMs: 60000

projects:
  - id: PROJECT_ID_HERE
    path: PROJECT_PATH_HERE
    opencodeBin: opencode
EOF
```

**替换规则：**
- `PROJECT_ID_HERE` → 项目短名（如 `petfish-tester`、`my-app`），小写，用 `-` 连接，无空格
- `PROJECT_PATH_HERE` → 当前项目的绝对路径（即 `pwd` 的输出）

**示例：**
```yaml
projects:
  - id: petfish-tester
    path: /home/kylecui/dev/petfish-tester
    opencodeBin: opencode
```

将 `connector.yaml` 加入 `.gitignore`（含 token，不应提交）：

```bash
echo "connector.yaml" >> .gitignore
```

## Step 3: 在服务器注册项目

执行以下 SSH 命令，将你的项目追加到服务器配置中：

```bash
ssh root@38.55.160.238 "cat >> /opt/petfish-remote/config/projects.yaml" << EOF

  PROJECT_ID_HERE:
    name: "你的项目显示名"
    runtime: "kyle-desktop"
    path: "PROJECT_PATH_HERE"
    default_mode: "read_only"
    allowed_users:
      - "telegram:685608515"
    readme_files: []
    test_commands: {}
    risk_profile: "default"
    secrets_policy: "deny_read"
EOF
```

**替换** `PROJECT_ID_HERE` 和 `PROJECT_PATH_HERE`，与 Step 2 保持一致。

然后重启服务器使配置生效：

```bash
ssh root@38.55.160.238 "systemctl restart petfish-remote"
```

验证服务正常启动：

```bash
ssh root@38.55.160.238 "systemctl is-active petfish-remote"
```

期望输出：`active`

如果输出 `failed`，查看错误：

```bash
ssh root@38.55.160.238 "journalctl -u petfish-remote --no-pager -n 20"
```

常见错误：YAML 缩进不对、字段缺失。确保所有 required fields 都存在。

## Step 4: 启动 Connector

在你的 opencode session 中，执行以下命令启动 connector 后台进程：

```bash
OPENCODE_PID=$$ node /home/kylecui/dev/petfish_remote/dist/connector/main.js ./connector.yaml &
CONNECTOR_PID=$!
echo "Connector started: PID=$CONNECTOR_PID"
```

> **注意**: `OPENCODE_PID=$$` 在 opencode 的 bash 工具中会获得 opencode 的父 shell PID。如果这不正确，用以下方式获取精确 PID：
> ```bash
> OPENCODE_PID=$(pgrep -x "opencode" | head -1)
> ```

验证 connector 成功注册——等待几秒后检查服务器日志：

```bash
sleep 5 && ssh root@38.55.160.238 "journalctl -u petfish-remote --no-pager -n 5 | grep -i register"
```

期望看到类似：
```
Connector registered: hostname-projectid (HOSTNAME, 1 projects)
```

如果没有看到你的 connector，检查进程是否还活着：

```bash
ps -p $CONNECTOR_PID -o pid,comm 2>/dev/null || echo "Connector process died"
```

## Step 5: 写入自启动指令到 AGENTS.md

为了确保每次 opencode 启动都能加载遥控器，在项目的 `AGENTS.md` 中添加以下内容：

```bash
cat >> AGENTS.md << 'EOF'

## PetFish Remote (胖鱼遥控器)

本项目已接入 PetFish Remote。每次 session 启动时，需确保 connector 进程运行。

### 自动检查与启动

在每次 session 开始时（收到用户第一条消息前），执行：

```bash
# 检查 connector 是否在运行
if ! pgrep -f "dist/connector/main.js.*connector.yaml" > /dev/null 2>&1; then
  echo "Starting petfish-remote connector..."
  OPENCODE_PID=$(pgrep -x "opencode" | head -1) \
    node /home/kylecui/dev/petfish_remote/dist/connector/main.js ./connector.yaml &
  sleep 3
  echo "Connector PID: $!"
fi
```

### 验证连接

```bash
ssh root@38.55.160.238 "journalctl -u petfish-remote --no-pager -n 5 | grep register"
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
| `AUTH_FAILED` | token 不对 | 检查 connector.yaml 中的 token |
| `SessionBridge init failed` | OPENCODE_PID 不正确 | 用 `pgrep -x "opencode"` 获取正确 PID |
| `/pf list` 看不到项目 | 服务器 projects.yaml 没注册 | 执行 Step 3 |
| `/pf use` 报 Access denied | allowed_users 没加 | 在服务器 projects.yaml 加 `telegram:685608515` |
| 发消息无响应 | connector 未连接 | 在服务器查日志确认 connector 注册 |
| connector 曾连接但现在不响应 | 服务器重启后 connector 断连 | 重启 connector 进程 |

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
