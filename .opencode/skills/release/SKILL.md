---
name: release
description: >
  Use this skill when the user wants to release, deploy, ship, or cut a version
  for a Node.js/TypeScript project. Executes a structured release workflow:
  pre-flight validation (tests, typecheck, lint, build), changelog and version
  management, deployment (systemd, Docker, connector daemon), post-deploy
  verification, and rollback procedures. Trigger on "release", "cut a release",
  "ship it", "deploy to production", "release checklist", "pre-release check",
  "version bump", "are we ready to release", "post-deploy verification",
  "rollback", or "release readiness".
metadata:
  version: 0.1.0
  author: petfish
compatibility: >
  Node.js ≥ 20, npm, TypeScript project with vitest/tsc/eslint.
  Deployment targets: systemd, Docker/Podman, or PM2.
  Connector: self-daemonizing supervisor with PID management.
---

# release

## Role

You are a release engineer responsible for getting code from a validated dev
branch to a running production deployment — safely, repeatably, and with
rollback capability. You enforce quality gates, catch known pitfalls, and
leave an auditable trail.

## When to use

- User asks to release, deploy, ship, or cut a version
- User asks "are we ready to release?" or "pre-release check"
- User asks for a release checklist or version bump
- User wants post-deploy verification after a deployment
- User needs rollback guidance after a failed deployment

## Intake

Before starting, confirm:

1. **Scope**: Server-only, connector-only, or both?
2. **Target environment**: Production, staging, or local?
3. **Version bump type**: patch / minor / major (or none for hotfix)?
4. **Known risks**: Any recent changes that need extra verification?

If the user doesn't specify, default to: both server + connector, production,
patch bump.

## Workflow

### Phase 1 — Pre-flight Validation

Run all quality gates. **Every gate must pass before proceeding.**

```bash
npm run test        # All tests must pass — no skipped, no placeholder assertions
npm run typecheck   # tsc --noEmit — must be clean (0 errors)
npm run lint        # eslint src/ — must be clean
npm run build       # tsc + asset copy — must succeed with exit code 0
```

**Exit criteria**: All four commands exit 0. If any fails, stop and fix before
continuing. See `references/pitfalls.md` for common failure patterns.

### Phase 2 — Pre-release Audit

1. **Doc alignment**: Verify docs match current code behavior.
   Check `README.md`, `docs/install.md`, `docs/deployment.md`.
2. **Dependency check**: `npm audit` — no critical/high vulnerabilities.
3. **Changelog**: Update `CHANGELOG.md` with new entries under the correct
   version section. Use conventional commit prefixes (feat/fix/test/docs).
4. **Version bump**: Update `version` in `package.json`.
   Verify `scripts/install.sh` MIN_NODE_VERSION matches actual requirement.
5. **License check**: Confirm split licensing boundaries
   (Apache-2.0 for connector/protocol, proprietary for server).

### Phase 3 — Commit & Tag

```bash
git add -A
git commit -m "release: v<version> — <summary>"
git tag v<version>
git push origin <branch> --tags
```

Use conventional commit format. Tag must match package.json version.

### Phase 4 — Deploy

Read `references/checklist.md` for detailed per-target steps.

**Server (systemd)**:
```bash
ssh <server>
cd /path/to/petfish_remote
git pull origin <branch>
npm install --production
npm run build
sudo systemctl restart petfish-remote
```

**Connector (daemon)**:
```bash
petfish-connect stop
git pull origin <branch>
npm install && npm run build
petfish-connect start
```

**Docker**: Rebuild image, stop old container, start new one.

### Phase 5 — Post-deploy Verification

**Must verify all of these**:

1. Process running: `systemctl status petfish-remote` or `petfish-connect status`
2. Health endpoint: `curl https://<host>/api/status`
3. Logs clean: `journalctl -u petfish-remote -n 50 --no-pager` — no crash loops
4. Functional smoke test: Send a test message through at least one platform
5. WebSocket connectivity: Connector connects and heartbeat is stable
6. Database accessible: No SQLite lock errors in logs

**Exit criteria**: All 6 checks pass. If any fails, see `references/rollback.md`.

## Tool Usage

- **Read** config files (package.json, tsconfig.json) before running commands
- **Bash** for running test/build/deploy commands
- **Grep** to verify doc alignment and catch stale references
- **Read** logs and status output for post-deploy verification
- Load `references/checklist.md` for the full step-by-step checklist
- Load `references/pitfalls.md` when a gate fails or something unexpected happens
- Load `references/rollback.md` when post-deploy verification fails

## Output Format

Report each phase with pass/fail:

```
## Release Report: v<version>

### Pre-flight
- Tests: ✅ <count> passed
- Typecheck: ✅ clean
- Lint: ✅ clean
- Build: ✅ success

### Pre-release Audit
- Doc alignment: ✅ / ⚠️ <issues>
- Dependencies: ✅ / ⚠️ <advisory count>
- Changelog: ✅ updated
- Version: ✅ <old> → <new>

### Deploy
- Target: <systemd/docker/connector>
- Status: ✅ deployed

### Verification
- Process: ✅ running
- Health: ✅ 200 OK
- Logs: ✅ clean
- Smoke test: ✅ message round-trip OK
- WebSocket: ✅ connected
- Database: ✅ accessible

### Rollback point
- Commit: <previous-commit-hash>
- Command: git checkout <hash> && npm run build && systemctl restart petfish-remote
```

## Must Do

- Run ALL four pre-flight gates before any deploy action
- Verify post-deploy with actual HTTP/process checks, not just "it started"
- Update CHANGELOG.md with every release
- Tag the release commit in git
- Record the rollback point (previous commit hash) before deploying
- Check `references/pitfalls.md` when anything unexpected happens

## Must Not Do

- Skip tests or typecheck because "it's a small change"
- Deploy without a successful build
- Use `--force` on git push without explicit user approval
- Suppress TypeScript errors with `as any` or `@ts-ignore`
- Delete or skip failing tests to make the suite pass
- Deploy server and connector simultaneously — do one, verify, then the other
- Assume deployment succeeded without post-deploy verification
