# Incident Report: Connector Registration Mapping Bug

> Date: 2026-05-12
> Severity: **P2 — Stale Project Data**
> Affected: All DB-restored projects after connector reconnect
> Root cause: `ProjectRegistry.projectToConnector` mapping never set for DB-restored projects
> Fix: `setConnectorMapping()` method + updated `connector:change` handler
> Status: **Fixed** — commit `95de544`

---

## 1. Incident Description

After a server restart or connector reconnect, projects restored from SQLite by `RegistrationService.restoreFromStorage()` appeared in the project list and could be selected by users, but failed to route messages correctly. On subsequent connector disconnect, these projects were not cleaned up — `removeProjectsByConnector()` could not find them because the `projectToConnector` reverse mapping was never established.

### Symptoms

1. **Stale projects persist after connector disconnect** — user sees projects from a connector that is no longer online
2. **Messages routed to wrong connector** — or fail silently because `findByProject()` returns nothing
3. **ROUTE-0 cleanup ineffective** — the disconnect handler (ROUTE-0b) called `removeProjectsByConnector()`, but with no mapping entries, nothing was removed

### User-reported behavior

After server restart, `/pf list` showed correct projects. After connector temporarily disconnected and reconnected, projects appeared duplicated or stale. Sending messages to these projects resulted in 30-second timeout retries.

---

## 2. Root Cause Analysis

### 2.1 The registration data flow

```
Connector connects
  → ConnectorGateway emits 'connector:change' with project list
    → main.ts handler iterates projects
      → For NEW projects: projectRegistry.addProject(proj) 
        → sets projectsById[id] = proj
        → sets projectToConnector[id] = connectorId  ✅
      → For EXISTING projects (already in projectsById from DB restore):
        → SKIPPED — no mapping set  ❌
```

### 2.2 The DB restore path

```
Server starts
  → RegistrationService.restoreFromStorage()
    → Reads all projects from SQLite
    → Calls projectRegistry.addProject(proj) for each
      → sets projectsById[id] = proj  ✅
      → sets projectToConnector[id] = connectorId  ✅ (using stored connectorId)
```

Wait — the DB restore path *does* set the mapping. So why was it broken?

### 2.3 The actual bug: connector reconnect overwrites

The critical sequence:

1. Server starts → `restoreFromStorage()` sets mapping: `project1 → connector-abc`
2. Connector `connector-abc` connects → `connector:change` fires
3. Handler checks: `projectsById.has(project1.id)` → **true** (from DB restore)
4. Handler takes the `else` branch → **does nothing** (no `setConnectorMapping` call)
5. Meanwhile, the connectorId may have changed (new WebSocket connection = new connectorId)
6. Old mapping `project1 → connector-abc` still points to the *old* connectorId
7. When the *new* connector disconnects, `removeProjectsByConnector(newConnectorId)` finds nothing

The root cause: **the `else` branch for existing projects did not update the `projectToConnector` mapping to reflect the new connectorId from the reconnected WebSocket.**

### 2.4 Why ROUTE-0 didn't catch this

ROUTE-0 was designed and tested with the assumption that `addProject()` handles all mapping. The `else` branch for existing projects was a no-op. ROUTE-0 testing focused on:
- New connector registration (works — `addProject` sets mapping)
- Connector disconnect cleanup (works — IF mapping exists)
- Project list filtering (works — checks live connector via `findByProject()`)

The gap: **reconnection of an existing connector with projects already in the registry from DB restore**.

---

## 3. Fix

### 3.1 New method: `ProjectRegistry.setConnectorMapping()`

```typescript
// src/core/ProjectRegistry.ts
public setConnectorMapping(projectId: string, connectorId: string): void {
  this.projectToConnector.set(projectId, connectorId);
}
```

Exposed as a targeted method rather than overloading `addProject()`, because:
- `addProject()` also overwrites the project data, which may not be desired for existing projects
- Explicit mapping update is clearer in intent
- Existing callers of `addProject()` are unaffected

### 3.2 Updated `connector:change` handler in `main.ts`

```typescript
// main.ts — connector:change handler
if (!projectRegistry.hasProject(proj.id)) {
  // New project — full registration
  projectRegistry.addProject(proj);
  projectRegistry.setConnectorMapping(proj.id, connectorId);
  if (connInfo.userId) {
    projectRegistry.addUserToProject(proj.id, connInfo.userId);
  }
} else {
  // Existing project — update mapping to current connector
  projectRegistry.setConnectorMapping(proj.id, connectorId);
  if (connInfo.userId) {
    projectRegistry.addUserToProject(proj.id, connInfo.userId);
  }
}
```

The `else` branch now calls `setConnectorMapping()` to refresh the reverse mapping with the current connectorId, regardless of whether the project was previously restored from DB or registered by a prior connection.

---

## 4. Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ Zero errors |
| `npm run build` | ✅ Clean compile |
| `npm test` | ✅ 95/95 tests passed (8 files) |
| E2E: Server restart → connector reconnect → `/pf list` | ✅ Projects show correctly, no stale entries |
| E2E: Connector disconnect → `/pf list` | ✅ Projects from disconnected connector removed |
| E2E: Message routing after reconnect | ✅ Messages route to correct connector |

---

## 5. Debugging Process

### 5.1 Initial symptom

After deploying the `/start` welcome message changes (commit `7705edd`), noticed that projects were not being cleaned up on connector disconnect. The ROUTE-0 cleanup code was present and correct — but it wasn't finding any projects to remove.

### 5.2 Investigation steps

1. **Checked `removeProjectsByConnector()`** — logic correct, iterates `projectToConnector` map entries
2. **Added logging** to `connector:change` handler — confirmed the `else` branch was taken for DB-restored projects
3. **Inspected `projectToConnector` map** after connector reconnect — found stale entries pointing to old connectorIds
4. **Traced the data flow** from `restoreFromStorage()` → `addProject()` → `connector:change` handler
5. **Identified the gap**: `else` branch was a no-op, didn't update mapping for the new connectorId

### 5.3 Time spent

~30 minutes from symptom to fix. The debugging was straightforward once the mapping flow was traced.

---

## 6. Prevention

### 6.1 What we should have caught

The `else` branch in the `connector:change` handler was a code smell — a branch that does nothing for a non-trivial state transition (connector reconnect). Any reconnection event should refresh all connector-dependent state.

### 6.2 Lessons

1. **Reverse mappings must be updated on reconnect, not just initial registration.** Any Map that tracks `entity → owner` must be refreshed when the owner identity changes (new WebSocket = new connectorId).
2. **Test reconnection separately from initial connection.** Our ROUTE-0 tests covered new registration and disconnect, but not the reconnect-after-DB-restore path.
3. **No-op `else` branches in state handlers deserve scrutiny.** If a handler has a branch for "entity already exists", it should either update state or explicitly document why no update is needed.

---

## 7. Timeline

| Time | Event |
|---|---|
| 2026-05-12 ~08:00 | Deployed `/start` welcome message changes (commit `7705edd`) |
| 2026-05-12 ~08:15 | Noticed stale projects persisting after connector disconnect |
| 2026-05-12 ~08:20 | Traced issue to `projectToConnector` mapping not updated on reconnect |
| 2026-05-12 ~08:30 | Implemented `setConnectorMapping()` + updated `connector:change` handler |
| 2026-05-12 ~08:45 | All tests passing, deployed to production |
| 2026-05-12 ~08:50 | Committed as `95de544` |
