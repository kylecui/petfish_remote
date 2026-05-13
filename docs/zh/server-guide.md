# 服务器自部署指南

## 1. 概述

本指南适用于需要对数据拥有完全控制权的团队。通过自部署 Bot Server，您可以实现环境私有化、数据自主管理以及网络访问的完全可控。

## 2. 前置要求

在开始部署前，请确保服务器满足以下条件：

- Node.js ≥ 20
- npm
- systemd
- Nginx
- 独立域名及有效 SSL 证书
- 有效的 Telegram Bot Token
- 飞书 App ID 和 App Secret（如使用飞书平台）
- Slack App Token 和 Bot Token（如使用Slack）
- 企业微信 Bot ID 和 Secret（如使用企业微信）

## 3. 获取 Telegram Bot Token

1. 在 Telegram 中搜索 `@BotFather`。
2. 发送 `/newbot`，按提示设置 Bot 名称和 username。
3. 成功后，`@BotFather` 会返回一串类似 `123456789:ABCDefghIJKLmnopQRSTuvwxYZ` 的 API Token。请妥善保管。

## 4. 飞书（Lark）集成

如需启用飞书作为聊天平台（可与Telegram同时使用）：

1. 访问 [飞书开放平台](https://open.feishu.cn/)（国际版用户访问 [Lark Developer](https://open.larksuite.com/)）。
2. 创建一个新应用。
3. 在"凭证与基本信息"中，复制 **App ID** 和 **App Secret**。
4. 启用机器人能力，配置事件订阅URL为 `https://your-domain.com/api/feishu/webhook`。
5. 在 `.env` 文件中追加以下配置：

```env
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_DOMAIN=feishu
```

`FEISHU_DOMAIN` 接受两个值：
- `feishu` — 中国大陆版（feishu.cn）
- `lark` — 国际版（larksuite.com）

说明：Telegram和飞书可同时运行。如仅配置飞书环境变量（无Telegram Token），服务器以飞书单平台模式启动。如两个平台均未配置，服务器启动时报错退出。

## 5. 多平台架构：客户端与服务端职责划分

PetFish Remote将平台集成（服务端）与AI Agent管理（客户端）分离：

| 层级 | 职责 | 位置 |
|------|------|------|
| **聊天平台适配器** | Telegram、Slack、飞书、企业微信和Web — 消息渲染、用户身份 | 服务端（Bot Server） |
| **Connector** | WebSocket连接、AI Agent生命周期、项目管理 | 客户端（开发机） |
| **注册服务** | Token交换、Connector身份管理、平台用户绑定 | 服务端API（`/api/register`、`/api/add-platform`） |

这意味着：
- 新增聊天平台（如飞书）需要在服务端配置环境变量 — 客户端无需做任何改动。
- 新增AI Agent（如Gemini）是纯客户端操作 — 服务端无需感知本地运行的Agent类型。
- 一个Connector服务所有平台。Telegram用户和飞书用户可以控制同一组项目，前提是都在allowed_users列表中。

## 6. 安装部署

登录目标服务器，执行以下操作：

```bash
# 1. 克隆代码
sudo git clone https://github.com/kylecui/petfish_remote /opt/petfish-remote
cd /opt/petfish-remote

# 2. 安装依赖并构建
npm install --production
npm run build

# 3. 配置环境变量
cat << EOF > .env
# 必需：至少配置一个平台
TELEGRAM_BOT_TOKEN=替换为你的真实Token

# 可选：飞书/Lark集成
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_DOMAIN=feishu
EOF
```

### Slack集成

如需启用Slack：

1. 在 [api.slack.com/apps](https://api.slack.com/apps) 创建Slack应用。
2. 启用Socket Mode并生成App-Level Token。
3. 添加Bot权限：`chat:write`、`app_mentions:read`、`im:history`、`im:read`、`im:write`。
4. 在 `.env` 中追加：

```env
SLACK_SIGNING_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SLACK_BOT_TOKEN=xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx
SLACK_APP_TOKEN=xapp-1-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx
```

### 企业微信集成

如需启用企业微信：

1. 在企业微信管理后台注册AI Bot。
2. 获取Bot ID和Secret。
3. 在 `.env` 中追加：

```env
WECOM_BOT_ID=xxxxxxxxxx
WECOM_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Web控制台

Web控制台默认启用。提供深色主题的单页聊天界面（路径 `/web/`）和WebSocket端点（`/ws/web`）。通过API Key认证（`?key=<api-key>`）。

说明：可同时运行任意平台组合。至少需要配置一个平台。

## 7. 配置文件

服务端配置文件位于 `config/` 目录，主要包含以下内容：

- **connectors.yaml**：配置 WebSocket 监听端口、网关路径及基础认证策略。
- **projects.yaml**：维护可用项目列表。客户端通过 `/api/register` 动态注册时会自动更新此文件，也可通过文本编辑器手动维护。
- **users.yaml**：Telegram 用户白名单，定义哪些 Telegram ID 有权连接与控制。

## 8. Systemd 服务

为保障服务持续运行，需配置 systemd 守护进程。创建文件 `/etc/systemd/system/petfish-server.service`：

```ini
[Unit]
Description=PetFish Remote Bot Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/petfish-remote
EnvironmentFile=/opt/petfish-remote/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启动并设置开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable petfish-server
sudo systemctl start petfish-server
```

## 9. Nginx 反向代理

配置 Nginx 处理 HTTPS 卸载与 WebSocket 转发。在 `/etc/nginx/sites-available/petfish` 写入以下配置：

```nginx
server {
    listen 443 ssl;
    server_name remote.yourdomain.com;

    # SSL 配置略（请使用 certbot 自动生成）

    # API 与基础路由
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 一键安装脚本路由
    location /install {
        proxy_pass http://127.0.0.1:3000/install;
        proxy_set_header Host $host;
    }

    # WebSocket 路由
    location /ws/connector {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }

    # Web控制台
    location /web/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    # Web WebSocket
    location /ws/web {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

重新加载 Nginx：

```bash
sudo ln -s /etc/nginx/sites-available/petfish /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 10. SSL 证书

推荐使用 certbot 免费签发 Let's Encrypt 证书：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d remote.yourdomain.com
```

## 11. 自定义域名

服务部署后，需通知所有客户端更改默认通信地址。客户端在安装或启动时，必须声明以下环境变量：

```bash
export PETFISH_SERVER_URL="wss://remote.yourdomain.com/ws/connector"
```

## 12. 验证部署

使用 `curl` 验证服务可用性：

- **版本检查**：`curl https://remote.yourdomain.com/api/version`
- **健康检查**：`curl https://remote.yourdomain.com/health`（如配置了监控路由）
- **安装脚本读取**：`curl https://remote.yourdomain.com/install`

## 13. 升级

服务端升级流程如下：

```bash
cd /opt/petfish-remote
git pull
npm install --production
npm run build
sudo systemctl restart petfish-server
```

## 14. 安全建议

1. **Token 安全**：绝对不要将包含 `TELEGRAM_BOT_TOKEN` 的 `.env` 文件提交至代码仓库。
2. **白名单控制**：严格维护 `config/users.yaml`，拒绝未授权的 Telegram 账号访问。
3. **防火墙策略**：限制对外暴露的端口，仅开放 80 与 443，后端服务（如 3000）绑定至 `127.0.0.1`。
4. **Token 轮换**：如怀疑客户端 Token 泄漏，及时在服务端注销相关记录并要求客户端重新注册。

## 15. 故障排查

| 常见报错 / 现象 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 客户端 WebSocket 握手失败 (400 Bad Request) | Nginx 未正确转发 Upgrade 请求头 | 检查 Nginx 配置文件中 `/ws/connector` 段落是否包含 `proxy_set_header Upgrade $http_upgrade;`。 |
| Telegram Bot 无响应 | Bot Token 错误或网络无法访问 Telegram API | 检查 `.env` 文件中的 Token；如国内服务器，检查是否需要配置全局代理访问 Telegram。 |
| 动态注册写入文件失败 | 目录权限不足 | 确保运行 systemd 服务的用户（如 root 或专门的运行用户）对 `/opt/petfish-remote/config/` 具有写权限。 |