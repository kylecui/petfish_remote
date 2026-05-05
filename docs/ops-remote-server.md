# 运维文档 — remote.petfish.ai

## 服务概览

| 项目 | 值 |
|------|-----|
| 服务名称 | PetFish Remote (胖鱼遥控器) |
| 服务器 | 38.55.160.238 (Ubuntu 24.04, 31GB RAM) |
| 域名 | remote.petfish.ai |
| 部署方式 | systemd + nginx + Let's Encrypt |
| 运行模式 | Telegram polling (长连接) |
| Bot | @petfish_bot (胖鱼) |

## 目录结构

```
/opt/petfish-remote/
├── .env                    # 环境变量（含TELEGRAM_BOT_TOKEN）
├── config/                 # YAML配置（projects, policies, users, runtimes, adapters, runtime）
├── dist/                   # 编译输出（TypeScript → JavaScript）
├── src/                    # 源码
├── .runtime/               # 运行时数据
│   ├── petfish.db          # SQLite数据库
│   ├── attachments/
│   └── logs/
├── node_modules/
└── package.json
```

## 关键文件位置

| 文件 | 路径 |
|------|------|
| systemd unit | `/etc/systemd/system/petfish-remote.service` |
| nginx config | `/etc/nginx/sites-enabled/remote.petfish.ai` |
| SSL证书 | `/etc/letsencrypt/live/remote.petfish.ai/` |
| 环境变量 | `/opt/petfish-remote/.env` |
| 配置目录 | `/opt/petfish-remote/config/` |
| 数据库 | `/opt/petfish-remote/.runtime/petfish.db` |
| 日志 | journalctl + `/opt/petfish-remote/.runtime/logs/` |

## 日常运维命令

```bash
# 状态检查
systemctl status petfish-remote
journalctl -u petfish-remote -n 50 --no-pager

# 实时日志
journalctl -u petfish-remote -f

# 重启
systemctl restart petfish-remote

# 停止
systemctl stop petfish-remote

# 查看进程
ps aux | grep "node dist/main.js"
```

## 更新部署

从开发机执行：

```bash
# 1. 本地构建确认
cd /home/kylecui/dev/petfish_remote
npm run build && npm test

# 2. 同步代码到服务器
rsync -avz --exclude='node_modules' --exclude='.runtime' --exclude='.git' \
  ./ root@38.55.160.238:/opt/petfish-remote/

# 3. 服务器上重新构建并重启
ssh root@38.55.160.238 "cd /opt/petfish-remote && npm ci && npm run build && systemctl restart petfish-remote"

# 4. 验证
ssh root@38.55.160.238 "systemctl status petfish-remote --no-pager"
```

## SSL证书

- 证书路径: `/etc/letsencrypt/live/remote.petfish.ai/`
- 有效期至: 2026-08-02
- 自动续期: certbot timer 已配置
- 手动续期: `certbot renew --nginx`

## 共存服务

服务器上运行着大量Docker容器（威胁检测平台、Kafka、PostgreSQL、Redis等）。注意事项：

- **不要**修改Docker网络或端口映射
- **不要**重启Docker daemon
- **不要**修改其他nginx站点配置
- PetFish Remote通过systemd独立运行，与Docker服务互不干扰

已有nginx站点：
- `petfish.ai` (静态站点)
- `codereview.jz.rswitch.dev`
- `threats.jz.rswitch.dev`
- `tire.jz.rswitch.dev`

## 回滚方案

```bash
# 完全卸载
systemctl stop petfish-remote
systemctl disable petfish-remote
rm /etc/systemd/system/petfish-remote.service
rm /etc/nginx/sites-enabled/remote.petfish.ai
systemctl daemon-reload
systemctl reload nginx
rm -rf /opt/petfish-remote

# 仅回滚代码（保留服务配置）
ssh root@38.55.160.238 "cd /opt/petfish-remote && git checkout <previous-commit>"
# 或重新rsync旧版本代码
```

## 监控观察点

| 观察项 | 命令 | 预期 |
|--------|------|------|
| 服务状态 | `systemctl is-active petfish-remote` | `active` |
| 内存占用 | `systemctl status petfish-remote` | ~25MB |
| HTTPS可达 | `curl -sI https://remote.petfish.ai` | 200 |
| Bot连接 | `curl -s https://api.telegram.org/bot$TOKEN/getMe` | `ok:true` |
| 磁盘 | `du -sh /opt/petfish-remote/.runtime/` | 持续观察增长 |
| 证书有效期 | `certbot certificates` | 距过期>30天 |

## 故障排查

### Bot不响应

1. `systemctl status petfish-remote` — 检查进程是否存活
2. `journalctl -u petfish-remote -n 50` — 查看错误日志
3. 确认网络出口可达 `api.telegram.org`
4. 检查是否有其他实例同时polling（409 Conflict）

### 服务崩溃重启循环

1. `journalctl -u petfish-remote --since "5 min ago"` — 看崩溃原因
2. 常见：配置文件格式错误、.env缺失、Node版本不对
3. 手动测试：`cd /opt/petfish-remote && node dist/main.js`

### HTTPS不可达

1. `systemctl status nginx` — nginx是否运行
2. `nginx -t` — 配置是否有语法错误
3. `certbot certificates` — 证书是否过期
4. `ss -tlnp | grep :443` — 端口是否被监听

## 部署时间线

| 时间 | 事件 |
|------|------|
| 2026-05-05 | 首次部署：Node.js 20.18.3, systemd, nginx, Let's Encrypt |
