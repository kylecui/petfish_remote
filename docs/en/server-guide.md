# Server Self-Deployment Guide

## Overview
Self-deploying the PetFish Remote server gives you full control over your data. It ensures privacy and allows for custom configurations.

## Prerequisites
* Node.js >= 20
* npm
* systemd
* nginx
* A registered domain with an SSL certificate
* A Telegram Bot Token
* A Feishu App ID and Secret (if using Feishu)
* A Slack App Token and Bot Token (if using Slack)
* A WeCom Bot ID and Secret (if using WeCom)

## Create a Telegram Bot
1. Open Telegram and search for `@BotFather`.
2. Send the `/newbot` command.
3. Follow the prompts to set a name and username.
4. Copy the HTTP API token provided by BotFather. Keep this secure.

### Feishu (Lark) Integration

To enable Feishu as a chat platform alongside or instead of Telegram:

1. Go to [Feishu Open Platform](https://open.feishu.cn/) (or [Lark Developer](https://open.larksuite.com/) for international).
2. Create a new application.
3. Under "Credentials & Basic Info", copy the **App ID** and **App Secret**.
4. Enable the bot capability and configure the event subscription URL to `https://your-domain.com/api/feishu/webhook`.
5. Add the following to your `.env` file:

```env
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_DOMAIN=feishu
```

The `FEISHU_DOMAIN` field accepts two values:
* `feishu`: for China mainland (feishu.cn)
* `lark`: for international (larksuite.com)

Note: You can run Telegram and Feishu simultaneously. If only Feishu env vars are set (no Telegram token), the server runs in Feishu-only mode. If neither is configured, the server exits with an error.

### Architecture: Client vs Server Responsibilities

PetFish Remote separates platform integration (server-side) from AI agent management (client-side):

| Layer | Responsibility | Where |
|-------|---------------|-------|
| **Chat Platform Adapters** | Telegram, Slack, Feishu, WeCom, and Web — message rendering, user identity | Server (Bot Server) |
| **Connector** | WebSocket connection, AI agent lifecycle, project management | Client (your dev machine) |
| **Registration** | Token exchange, connector identity, platform user binding | Server API (`/api/register`, `/api/add-platform`) |

This means:
* Adding a new chat platform (e.g. Feishu) requires server-side env vars; clients don't need to change anything.
* Adding a new AI agent (e.g. Gemini) is client-side only; the server doesn't need to know which agent runs locally.
* One connector serves all platforms. A user on Telegram and a user on Feishu can control the same projects if both are in the allowed_users list.

## Installation
Deploy the server code to your host machine:

```bash
git clone https://github.com/kylecui/petfish_remote /opt/petfish-remote/
cd /opt/petfish-remote/
npm install --production
npm run build
```

Create a `.env` file in the root directory:

```env
# Required: at least one platform must be configured
TELEGRAM_BOT_TOKEN=abc123def456ghi789jkl012mno345pqr678

# Optional: Feishu/Lark integration
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_DOMAIN=feishu
```

### Slack Integration

To enable Slack:

1. Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps).
2. Enable Socket Mode and generate an App-Level Token.
3. Add bot scopes: `chat:write`, `app_mentions:read`, `im:history`, `im:read`, `im:write`.
4. Add to `.env`:

```env
SLACK_SIGNING_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SLACK_BOT_TOKEN=xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx
SLACK_APP_TOKEN=xapp-1-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx
```

### WeCom Integration

To enable WeCom (企业微信):

1. Register an AI bot on the WeCom admin console.
2. Obtain the Bot ID and Secret.
3. Add to `.env`:

```env
WECOM_BOT_ID=xxxxxxxxxx
WECOM_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Web Console

The Web console is enabled by default. It serves a single-page dark-themed chat UI at `/web/` and a WebSocket endpoint at `/ws/web`. Authentication is via API key (`?key=<api-key>`).

Note: You can run any combination of platforms simultaneously. At least one platform must be configured.

## Configuration Files
Server settings reside in the `config/` directory.

* `config/connectors.yaml`: Defines gateway ports, WebSocket paths, and authentication tokens.
* `config/projects.yaml`: The project registry. Connectors populate this automatically upon registration. You can edit it manually.
* `config/users.yaml`: The Telegram user allowlist. Add your Telegram user ID here to restrict access.

## Systemd Service
Create a systemd unit file to manage the server process at `/etc/systemd/system/petfish-server.service`.

```ini
[Unit]
Description=PetFish Remote Server
After=network.target

[Service]
Type=simple
User=petfish
WorkingDirectory=/opt/petfish-remote
EnvironmentFile=/opt/petfish-remote/.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
systemctl daemon-reload
systemctl enable petfish-server
systemctl start petfish-server
```

## Nginx Reverse Proxy
Configure Nginx to route traffic to the Node.js server. Include WebSocket upgrade support.

```nginx
server {
    listen 443 ssl;
    server_name remote.example.com;

    ssl_certificate /etc/letsencrypt/live/remote.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/remote.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws/connector {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }

    location /web/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    location /ws/web {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

## SSL Certificate
Use certbot to obtain and install an SSL certificate.

```bash
certbot --nginx -d remote.example.com
```

## Custom Domain
Configure the client to point to your new server by setting the `PETFISH_SERVER_URL` environment variable before installing the connector.

```bash
export PETFISH_SERVER_URL=https://remote.example.com
```

## Verify Deployment
Test the endpoints to confirm the server is running correctly.

* Health check: `curl https://remote.example.com/api/version`
* Install script check: `curl https://remote.example.com/install`

## Upgrading
To apply updates to your self-hosted server, run these commands:

```bash
cd /opt/petfish-remote
git pull
npm install --production
npm run build
systemctl restart petfish-server
```

## Security Recommendations
* Token rotation: Periodically revoke and regenerate your Telegram bot token.
* Allowed users: Strictly maintain the `config/users.yaml` allowlist.
* Firewall rules: Block public access to port 3000. Only allow traffic through port 443 via Nginx.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| 502 Bad Gateway | Node.js server down | Check `systemctl status petfish-server` |
| WebSocket fails | Nginx missing Upgrade header | Verify the `/ws/connector` location block in Nginx |
| Bot not responding | Invalid bot token | Update `TELEGRAM_BOT_TOKEN` in `.env` and restart |