# 部署指南

## 1. 部署概述

PetFish Remote 是一个长驻进程服务，生产环境需要可持续运行的主机（VPS 或 Linux 服务器）。

- 进程入口：`dist/main.js`（由 `src/main.ts` 编译生成）
- 生产启动命令：`npm start`（实际执行 `node dist/main.js`）
- 运行特性：需要持续在线，负责接收聊天平台事件并调度任务

因此它不适合部署在 GitHub 托管环境（例如仅代码托管、无常驻进程能力的场景）。

---

## 2. 前置要求

生产部署前请确保满足以下条件：

1. `Node.js >= 20`（项目 `engines.node` 要求）
2. `npm`
3. `opencode` CLI（`main.ts` 默认调用 `opencode` 可执行文件）
4. Telegram Bot Token（环境变量：`TELEGRAM_BOT_TOKEN`）
5. Linux 服务器（推荐使用 `systemd` 托管进程）

建议同时准备：

- Git（用于拉取与更新）
- 构建工具链（Docker 构建 `better-sqlite3` 时需要）

---

## 3. 安装步骤

### 3.1 拉取代码并执行安装脚本

```bash
git clone <your-repo-url> petfish_remote
cd petfish_remote
./scripts/install.sh
```

`./scripts/install.sh` 会执行以下真实动作：

- 检查 Node.js 主版本是否 `>= 20`
- 执行 `npm install`
- 执行 `npm run build`
- 创建运行目录：`.runtime/attachments`、`.runtime/logs`

### 3.2 配置环境变量

```bash
cp .env.example .env
```

按需修改 `.env`，最小必填项：

```dotenv
TELEGRAM_BOT_TOKEN=your-telegram-bot-token-here
PETFISH_CONFIG_DIR=./config
PETFISH_RUNTIME_DIR=./.runtime
PETFISH_LOG_LEVEL=info
```

可选平台变量（按需启用）：

- `SLACK_SIGNING_SECRET` — Slack 签名密钥（HTTP 模式）
- `SLACK_BOT_TOKEN` — Slack Bot Token（xoxb-）
- `SLACK_APP_TOKEN` — Slack App-Level Token（xapp-，Socket Mode 必需）
- `FEISHU_APP_ID` — 飞书 App ID
- `FEISHU_APP_SECRET` — 飞书 App Secret
- `WECOM_BOT_ID` — 企业微信 Bot ID
- `WECOM_SECRET` — 企业微信 Secret

---

## 4. systemd 部署（推荐）

### 4.1 创建服务文件

创建 `/etc/systemd/system/petfish-remote.service`：

```ini
[Unit]
Description=PetFish Remote Service
After=network.target

[Service]
Type=simple
User=petfish
WorkingDirectory=/opt/petfish-remote
EnvironmentFile=/opt/petfish-remote/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

说明：

- `WorkingDirectory` 指向项目根目录（包含 `dist/`、`config/`、`.runtime/`）
- `EnvironmentFile` 使用项目 `.env`
- `Restart=always` 确保异常退出后自动拉起
- `User` 建议使用非 root 专用用户

> 如果你的 `npm` 路径不是 `/usr/bin/npm`，请用 `which npm` 的结果替换 `ExecStart`。

### 4.2 启动与自启动

```bash
sudo systemctl daemon-reload
sudo systemctl enable petfish-remote
sudo systemctl start petfish-remote
```

### 4.3 状态与日志

```bash
sudo systemctl status petfish-remote
sudo journalctl -u petfish-remote -f
```

---

## 5. Docker 部署

> 项目依赖 `better-sqlite3`（native addon），镜像构建阶段需要安装编译工具链。

### 5.1 Dockerfile 示例

```dockerfile
FROM node:20-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

CMD ["node", "dist/main.js"]
```

### 5.2 docker-compose.yml 示例

```yaml
services:
  petfish-remote:
    build: .
    container_name: petfish-remote
    restart: always
    env_file:
      - .env
    volumes:
      - ./config:/app/config
      - ./.runtime:/app/.runtime
```

说明：

- `./config:/app/config`：挂载 6 个 YAML 配置文件（`projects/policies/adapters/users/runtimes/runtime`）
- `./.runtime:/app/.runtime`：持久化 SQLite 与日志（`petfish.db`、`logs/`）

---

## 6. PM2 部署

### 6.1 ecosystem.config.js 示例

```js
module.exports = {
  apps: [
    {
      name: 'petfish-remote',
      script: 'dist/main.js',
      cwd: '/opt/petfish-remote',
      env_file: '/opt/petfish-remote/.env',
      autorestart: true,
    },
  ],
};
```

### 6.2 启动与开机自启

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## 7. Webhook 模式（vs Polling）

### 各平台连接方式

| 平台 | 连接方式 | 说明 |
|------|---------|------|
| Telegram | Long Polling 或 Webhook | 默认 Polling，可切换为 Webhook |
| Slack | Socket Mode | 无需公网 Webhook，通过 `SLACK_APP_TOKEN` (xapp-) 建立 WebSocket |
| Feishu | Event Subscription (Webhook) | 需配置事件订阅 URL：`https://your-domain/api/feishu/webhook` |
| WeCom | WebSocket | 通过 `@wecom/aibot-node-sdk` 内置 WebSocket 连接，无需公网暴露 |
| Web | WebSocket (`/ws/web`) | 浏览器通过 `wss://your-domain/ws/web?key=<API_KEY>` 连接 |

当前默认是 Telegram Polling（`config/adapters.yaml`）：

```yaml
adapters:
  telegram:
    webhook:
      enabled: false
      url: ""
    polling:
      enabled: true
```

切换到 Webhook 模式时，按以下方式调整：

```yaml
adapters:
  telegram:
    webhook:
      enabled: true
      url: "https://your-domain.example.com/telegram/webhook"
    polling:
      enabled: false
```

要点：

- `webhook.enabled=true`
- `webhook.url` 必须是公网可访问 HTTPS 地址
- Webhook 模式通常配合 Nginx reverse proxy 暴露入口

---

## 8. Nginx 反向代理

以下是将公网请求转发到 PetFish Remote Webhook 监听端口的 `server` 示例（端口请替换为你实际监听值）：

```nginx
server {
    listen 80;
    server_name your-domain.example.com;

    location /telegram/webhook {
        proxy_pass http://127.0.0.1:<PETFISH_WEBHOOK_PORT>;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Web UI 静态页面
    location /web/ {
        proxy_pass http://127.0.0.1:<PETFISH_PORT>;
        proxy_set_header Host $host;
    }

    # Web UI WebSocket
    location /ws/web {
        proxy_pass http://127.0.0.1:<PETFISH_PORT>;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

说明：

- 该示例只展示 reverse proxy 最小闭环
- `proxy_pass` 目标端口需与你的 Webhook 监听配置一致
- 若已启用 HTTPS，请在 Nginx 层完成证书与 TLS 配置

---

## 9. 安全加固

生产环境建议至少完成以下加固动作：

1. 防火墙（`ufw`）仅放行必要端口
2. 使用非 root 用户运行进程（`systemd User=petfish`）
3. `.env` 权限收敛到仅 owner 可读写：

   ```bash
   chmod 600 .env
   ```

4. `config/` 目录权限收敛：

   ```bash
   chmod 700 config
   ```

5. 对外暴露面尽量走反向代理，不直接暴露内部监听端口

---

## 10. 更新与升级

在项目目录执行：

```bash
git pull
npm install
npm run build
sudo systemctl restart petfish-remote
```

建议升级后立即检查：

- `sudo systemctl status petfish-remote`
- `sudo journalctl -u petfish-remote -n 100`

---

## 11. 日志与监控

### 11.1 systemd 日志

```bash
sudo journalctl -u petfish-remote -f
```

### 11.2 运行时日志目录

根据 `config/runtime.yaml` 与 `.env`：

- 运行目录默认：`PETFISH_RUNTIME_DIR=./.runtime`
- 日志目录：`.runtime/logs`
- SQLite 路径：`.runtime/petfish.db`

### 11.3 日志级别

通过 `.env` 中的 `PETFISH_LOG_LEVEL` 控制日志级别（默认示例值：`info`）：

```dotenv
PETFISH_LOG_LEVEL=info
```

生产建议将日志输出与告警系统结合，至少覆盖：进程退出、启动失败、Telegram 鉴权失败、数据库文件不可写等关键事件。
