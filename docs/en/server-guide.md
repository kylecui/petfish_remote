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

## Create a Telegram Bot
1. Open Telegram and search for `@BotFather`.
2. Send the `/newbot` command.
3. Follow the prompts to set a name and username.
4. Copy the HTTP API token provided by BotFather. Keep this secure.

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
TELEGRAM_BOT_TOKEN=abc123def456ghi789jkl012mno345pqr678
```

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
