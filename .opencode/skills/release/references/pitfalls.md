# Release Pitfalls & Anti-Patterns

Hard-won lessons from petfish_remote releases. When something goes wrong during
a release, check here first.

---

## Pre-flight Pitfalls

### P1: Placeholder Tests Give False Confidence

**What happened**: Test suite passed with 100% green, but tests contained
`expect(true).toBe(true)` — they asserted nothing about actual behavior.
A state machine bug (`sessionBusy` never resetting) shipped because the test
for that path was a placeholder.

**Detection**: Grep for trivial assertions:
```bash
grep -rn "expect(true)" tests/
grep -rn "expect(1)" tests/
grep -rn "toBeTruthy()" tests/  # suspicious without a real subject
```

**Rule**: Every test must assert on actual function output or side effects.
No test should pass if you delete the implementation.

### P2: Version Drift Between install.sh and package.json

**What happened**: `scripts/install.sh` had `MIN_NODE_VERSION=18` while the
codebase actually required Node.js ≥ 20 (ES2022 features, native fetch).
Users on Node 18 got cryptic runtime errors after "successful" installation.

**Detection**: Compare versions:
```bash
grep MIN_NODE_VERSION scripts/install.sh
grep '"node":' package.json
grep 'target' tsconfig.json
```

**Rule**: Before every release, verify that install script prerequisites
match actual runtime requirements. Check Node.js version, npm version, and
any native addon build tool requirements (`python3`, `make`, `gcc` for
`better-sqlite3`).

### P3: Pre-commit Hook Failures on Test Files

**What happened**: Comment cleanup hook rejected commits because test files
had `// TODO` or `// DEBUG` comments. Developers either disabled the hook
(`--no-verify`) or wasted time cleaning comments that were intentional.

**Rule**: Clean up stale comments before starting the release process, not
during the commit step. If a comment is intentional, use a clear marker like
`// TECH-DEBT:` instead of `// TODO`.

### P4: Bun LSP Errors in petfish-plugin.ts

**What happened**: `petfish-plugin.ts` is a Bun plugin that uses Bun-specific
types. TypeScript and some LSP servers report errors because Bun types aren't
in the main `tsconfig.json`. These are **not real errors** — the file compiles
and runs correctly in Bun.

**Rule**: Ignore Bun LSP errors in `petfish-plugin.ts` during release
validation. These are pre-existing and do not affect the Node.js build or
runtime. The file is copied as-is to `dist/plugin/`.

---

## Deployment Pitfalls

### P5: better-sqlite3 Native Addon Fails in Docker

**What happened**: `npm install` failed in Docker because `better-sqlite3`
requires native compilation tools (`python3`, `make`, `gcc/g++`). The base
Node.js Docker image doesn't include these.

**Fix**: Use the `node:20-bookworm` image (not `-slim` or `-alpine`), or
explicitly install build tools:
```dockerfile
RUN apt-get update && apt-get install -y python3 make g++
```

**Rule**: Always test Docker builds from a clean image before releasing a
Docker-based deployment.

### P6: systemd Restart vs Stop+Start

**What happened**: `systemctl restart` occasionally left the old process
hanging for a few seconds, causing port conflicts. New process failed to
bind and entered a restart loop.

**Fix**: Use `systemctl stop && sleep 2 && systemctl start` for critical
releases, or verify the old process is gone:
```bash
sudo systemctl stop petfish-remote
sleep 2
ss -tlnp | grep 3000  # verify port is free
sudo systemctl start petfish-remote
```

**Rule**: After restart, always verify the process is actually running and
the port is bound. Don't trust `systemctl restart` exit code alone.

### P7: Connector Reconnect Loses Project Mapping

**What happened**: When the connector reconnected to the server after a
network interruption or server restart, `projectToConnector` mappings for
DB-restored projects were lost. The server knew about the projects (from
SQLite) but didn't re-associate them with the reconnected connector.

**Detection**: After deploy, check that previously registered projects
respond to messages. If `/pf list` shows projects but messages don't route,
this is the bug.

**Fix**: This was fixed in commit `95de544` by re-mapping projects on
connector reconnect. If you see this pattern again, check
`ConnectorGateway.ts` reconnection handler.

**Rule**: After deploying server changes, verify that existing connectors
can reconnect AND that all their projects are functional — not just that
the WebSocket opens.

---

## State Machine Pitfalls

### P8: sessionBusy Stall — Permanent Queue Block

**What happened**: `sessionBusy` flag was set to `true` when a message was
being processed, but never reset to `false` if the processing threw an
error. All subsequent messages queued forever, appearing as if the bot was
"ignoring" messages.

**Detection**: Bot stops responding but process is running and healthy.
Logs show messages being queued but never dispatched. No error messages
because the error was swallowed.

**Fix**: Fixed in commit `6f0e2ea`. The `sessionBusy` flag is now reset
in a `finally` block.

**Rule**: Any flag that gates message processing MUST be reset in error
paths. After deploying changes to message handling, send rapid sequential
messages and verify they all get responses.

---

## Process Pitfalls

### P9: Deploying Server and Connector Simultaneously

**What happened**: Server was restarted while connector was also being
updated. Connector tried to reconnect to a server that wasn't ready yet,
hit exponential backoff, and took minutes to recover even after the server
was up.

**Rule**: Always deploy and verify one component at a time:
1. Deploy server → verify server health → verify existing connectors reconnect
2. Deploy connector → verify connector connects → verify message routing

### P10: Forgetting to Rebuild Before Deploy

**What happened**: `git pull` was done but `npm run build` was skipped.
The `dist/` directory still had the old compiled code. Deployment appeared
successful but no changes took effect.

**Detection**: Check `dist/` modification times vs `src/`:
```bash
ls -la dist/main.js src/main.ts  # dist should be newer
```

**Rule**: ALWAYS run `npm install && npm run build` after `git pull`.
Never assume `dist/` is up to date.

### P11: Changelog Neglect Creates Archaeology

**What happened**: Multiple releases shipped without updating CHANGELOG.md.
When it came time to write release notes, required git archaeology across
dozens of commits to reconstruct what changed. Conventional commit messages
helped, but some commits had vague messages.

**Rule**: Update CHANGELOG.md as part of every release, not retroactively.
Each entry should reference the commit hash and use the same conventional
prefix as the commit message.

---

## Quick Reference: Pre-Release Sanity Checks

```bash
# 1. No placeholder tests
grep -rn "expect(true)" tests/ && echo "FAIL: placeholder tests found"

# 2. Version alignment
echo "install.sh: $(grep MIN_NODE_VERSION scripts/install.sh)"
echo "package.json engines: $(node -e "console.log(require('./package.json').engines?.node || 'not set')")"

# 3. Build freshness
npm run build && echo "Build OK" || echo "FAIL: build broken"

# 4. No secrets in commit
git diff --cached --name-only | grep -E '\.(env|pem|key)$' && echo "FAIL: secrets staged"
```
