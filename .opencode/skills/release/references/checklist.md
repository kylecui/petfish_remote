# Release Checklist

Step-by-step checklist for releasing petfish_remote. Each step has explicit
pass/fail criteria. Do not proceed past a failed step without fixing the issue.

---

## Pre-flight (all must pass)

### 1. Tests

```bash
npm run test
```

- [ ] Exit code 0
- [ ] No skipped tests
- [ ] No placeholder assertions (`expect(true).toBe(true)`)
- [ ] Test count matches expectations (currently 164+ tests, 10 files)

**If failing**: Fix the test or the code. Never delete a test to pass.

### 2. Type check

```bash
npm run typecheck
```

- [ ] Exit code 0 (0 errors)
- [ ] Ignore pre-existing Bun LSP errors in `petfish-plugin.ts` (these are
      Bun-type-only and do not affect the Node.js build)

**If failing**: Fix the type error. Never use `as any` or `@ts-ignore`.

### 3. Lint

```bash
npm run lint
```

- [ ] Exit code 0
- [ ] No new warnings in changed files

**If failing**: Fix lint errors. Comment-related hook failures usually mean
stale `// TODO` or debug comments — clean them up.

### 4. Build

```bash
npm run build
```

- [ ] Exit code 0
- [ ] `dist/` directory updated
- [ ] Static assets copied (`dist/adapters/web/static/`)
- [ ] Plugin copied (`dist/plugin/petfish-plugin.ts`)

**If failing**: Usually a TypeScript error that `typecheck` should have caught.
If build fails but typecheck passes, check `tsconfig.json` includes/excludes.

---

## Pre-release Audit

### 5. Documentation alignment

Check these files for stale information:

- [ ] `README.md` — test count, feature list, architecture diagram
- [ ] `docs/install.md` — install command, prerequisites, Node.js version
- [ ] `docs/deployment.md` — service files, paths, commands
- [ ] `docs/development.md` — dev setup, available scripts
- [ ] `scripts/install.sh` — `MIN_NODE_VERSION` matches actual requirement (≥20)

**Common drift**: README says "95 tests across 8 files" but actual count has
grown. Install script says Node 18 but code requires 20.

### 6. Dependency audit

```bash
npm audit
```

- [ ] No critical vulnerabilities
- [ ] No high vulnerabilities (or documented exceptions)
- [ ] `better-sqlite3` native addon builds cleanly (needs build tools)

### 7. Changelog

- [ ] `CHANGELOG.md` updated with new entries
- [ ] Entries grouped under correct version heading
- [ ] Each entry has commit hash reference
- [ ] Uses conventional commit prefixes (feat/fix/test/docs/refactor)

### 8. Version

- [ ] `package.json` version bumped appropriately
- [ ] Version string matches the git tag you will create
- [ ] No version string hardcoded elsewhere that needs updating

---

## Commit & Tag

### 9. Commit

```bash
git add -A
git status  # Review what's being committed
git commit -m "release: v<version> — <one-line summary>"
```

- [ ] Commit message follows conventional format
- [ ] No unintended files in the commit (check `.gitignore`)
- [ ] No secrets, `.env` files, or credentials

### 10. Tag

```bash
git tag v<version>
git push origin <branch> --tags
```

- [ ] Tag matches package.json version
- [ ] Tag pushed to remote

---

## Deploy — Server (systemd)

### 11. Pull & Build on Server

```bash
ssh <server>
cd /opt/petfish-remote  # or your install path
git pull origin <branch>
npm install --production
npm run build
```

- [ ] `git pull` clean (no merge conflicts)
- [ ] `npm install` succeeds (watch for `better-sqlite3` native build)
- [ ] `npm run build` succeeds

### 12. Restart Service

```bash
sudo systemctl restart petfish-remote
```

- [ ] Service restarted without error
- [ ] Note the previous commit hash for rollback:
      `git log --oneline -2` (second entry = rollback target)

### 13. Server Verification

```bash
systemctl status petfish-remote          # Active (running)
curl -s https://<host>/api/status        # 200 OK with JSON
journalctl -u petfish-remote -n 50       # No crash loops or errors
```

- [ ] Process running
- [ ] Health endpoint returns 200
- [ ] No error spam in logs
- [ ] No `SQLITE_BUSY` or lock errors
- [ ] WebSocket endpoint accepting connections

---

## Deploy — Connector

### 14. Stop Connector

```bash
petfish-connect stop
# OR: kill $(cat ~/.petfish/connector.pid)
```

- [ ] Connector stopped cleanly
- [ ] PID file removed or stale

### 15. Update & Build

```bash
cd /path/to/petfish_remote
git pull origin <branch>
npm install
npm run build
```

- [ ] Build succeeds

### 16. Start Connector

```bash
petfish-connect start
```

- [ ] Connector starts and connects to server
- [ ] WebSocket handshake successful
- [ ] Heartbeat stable (check logs)

### 17. Connector Verification

```bash
petfish-connect status   # Running, connected
petfish-connect logs     # No error loops
```

- [ ] Supervisor running with correct PID
- [ ] Connected to server (WebSocket open)
- [ ] All configured bridges initialized
- [ ] No exponential backoff triggered (means no crash loops)

---

## Smoke Test

### 18. End-to-End Verification

- [ ] Send a test message from at least one platform (Telegram/Slack/Feishu/Web)
- [ ] Message reaches opencode session
- [ ] Response returns to the platform
- [ ] No message truncation or encoding issues
- [ ] Interactive menus work (`/pf` command)

### 19. Multi-Project (if applicable)

- [ ] Project switching works (`/pf use <project>`)
- [ ] Session creation works (`/pf new`)
- [ ] Previously active projects still functional after restart

---

## Post-Release

### 20. Record

- [ ] Release report generated (see SKILL.md output format)
- [ ] Rollback command documented
- [ ] Monitor logs for 15 minutes post-deploy
- [ ] Notify team/users if public-facing changes

### 21. Cleanup

- [ ] Remove any temporary debug logging
- [ ] Close related issues/PRs
- [ ] Update roadmap if milestones completed
