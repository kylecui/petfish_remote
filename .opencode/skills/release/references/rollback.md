# Rollback Procedures

When post-deploy verification fails, use these procedures to restore the
previous working state. Speed matters — roll back first, investigate later.

---

## Decision: Fix Forward vs Roll Back

| Situation | Action |
|-----------|--------|
| Test failure caught in pre-flight | Fix the code. You haven't deployed yet. |
| Server starts but health check fails | Roll back (see Server Rollback below). |
| Connector won't connect after update | Roll back connector only. |
| Intermittent errors in logs | Monitor for 5 min. If increasing, roll back. |
| Data corruption suspected | Roll back immediately. Preserve DB backup. |
| Feature bug (non-critical) | Decide: hotfix forward or roll back. |

**Default bias**: Roll back if you can't diagnose within 5 minutes.

---

## Server Rollback (systemd)

### Quick Rollback

```bash
# 1. Stop the broken deployment
sudo systemctl stop petfish-remote

# 2. Revert to previous commit
cd /opt/petfish-remote
git log --oneline -3          # Identify the good commit
git checkout <good-commit>    # Detached HEAD is fine for rollback

# 3. Rebuild from the good commit
npm install --production
npm run build

# 4. Restart
sudo systemctl start petfish-remote

# 5. Verify
systemctl status petfish-remote
curl -s https://<host>/api/status
journalctl -u petfish-remote -n 20 --no-pager
```

### If git checkout fails (dirty working tree)

```bash
git stash          # Save any local changes
git checkout <good-commit>
npm install --production && npm run build
sudo systemctl restart petfish-remote
```

### Database Considerations

SQLite database (`~/.petfish/petfish.db` or configured path) persists across
deploys. If the failed release included schema changes:

1. Check if a backup exists: `ls ~/.petfish/petfish.db.bak*`
2. If the old code can't read the new schema, restore the backup:
   ```bash
   cp ~/.petfish/petfish.db.bak ~/.petfish/petfish.db
   ```
3. If no backup exists, check if the schema change is backward-compatible.
   If so, the old code may work with the new schema.

**Rule**: Before any release that changes database schema, back up the DB:
```bash
cp ~/.petfish/petfish.db ~/.petfish/petfish.db.bak-$(date +%Y%m%d-%H%M%S)
```

---

## Connector Rollback

### Quick Rollback

```bash
# 1. Stop the connector
petfish-connect stop
# OR: kill $(cat ~/.petfish/connector.pid)

# 2. Revert
cd /path/to/petfish_remote
git checkout <good-commit>

# 3. Rebuild
npm install && npm run build

# 4. Restart
petfish-connect start

# 5. Verify
petfish-connect status
petfish-connect logs  # Check for WebSocket connection and heartbeat
```

### Supervisor Recovery

The connector uses a self-daemonizing supervisor with exponential backoff.
If the connector is crash-looping:

```bash
# Check if supervisor is stuck in backoff
petfish-connect status  # Shows PID and restart count

# Force-kill everything
petfish-connect stop
sleep 3
# Kill any remaining processes
ps aux | grep "connector" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null
rm -f ~/.petfish/connector.pid

# Clean restart
petfish-connect start
```

### Connector Reconnection Verification

After rolling back the connector, verify these specifically:

1. WebSocket connects to server
2. All projects re-register (check `/pf list` from a chat platform)
3. Message routing works for ALL registered projects, not just the first one
4. Session bridges initialize for each project

This catches the `projectToConnector` mapping bug (see pitfalls P7).

---

## Docker Rollback

### Quick Rollback

```bash
# 1. Stop the broken container
docker stop petfish-remote

# 2. Start the previous image
docker start petfish-remote-backup
# OR: run from the previous tag
docker run -d --name petfish-remote \
  -v petfish-data:/data \
  -p 3000:3000 \
  petfish-remote:<previous-tag>

# 3. Verify
docker logs petfish-remote --tail 20
curl -s http://localhost:3000/api/status
```

### If no previous image exists

```bash
# Rebuild from a known good commit
git checkout <good-commit>
docker build -t petfish-remote:rollback .
docker stop petfish-remote && docker rm petfish-remote
docker run -d --name petfish-remote \
  -v petfish-data:/data \
  -p 3000:3000 \
  petfish-remote:rollback
```

---

## Post-Rollback Checklist

After any rollback:

- [ ] Service is running and healthy
- [ ] Health endpoint returns 200
- [ ] Connectors are connected
- [ ] Messages route correctly (end-to-end test)
- [ ] Database is accessible and not corrupted
- [ ] Document what failed and why in an incident report
- [ ] Create a follow-up task to fix the issue properly
- [ ] Do NOT re-attempt the same deploy without fixing the root cause

---

## Rollback Reference Card

```
SERVER:    systemctl stop → git checkout <hash> → npm i && build → systemctl start → verify
CONNECTOR: petfish-connect stop → git checkout <hash> → npm i && build → petfish-connect start → verify
DOCKER:    docker stop → docker run <previous-tag> → verify
DB:        cp ~/.petfish/petfish.db.bak ~/.petfish/petfish.db (if schema changed)
```
