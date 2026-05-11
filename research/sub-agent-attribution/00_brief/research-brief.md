# Research Brief: Sub-Agent Session Attribution in IM Clients

## Meta

| Field | Value |
|-------|-------|
| ID | `rb-sub-agent-attribution-2026-05` |
| Type | Product (UX/Feature Design) |
| Status | Draft |
| Owner | PetFish Remote Team |
| Created | 2026-05-11 |
| Depends on | Technical feasibility research (completed) |
| Delivers to | Feature design spec + implementation backlog |

## 1. Background

PetFish Remote is an IM bot that proxies opencode AI agent sessions to messaging platforms (Telegram, Slack, Feishu, WeCom, Web). Users interact with a parent agent session, but opencode frequently spawns sub-agents (explore, librarian, oracle, hephaestus, metis, momus) to handle specialized tasks in the background.

Currently, sub-agent activity is invisible to IM users. Users see the parent session working but have no visibility into what sub-agents are doing, when they start/finish, or what they produce. This creates a "black box" experience during complex tasks.

Prior technical research confirmed that all necessary data is available:

- `session.created` SSE events carry a `parentID` field identifying child sessions
- Child session agent type is exposed via `info.agent`
- `GET /:sessionID/children` REST endpoint supports on-demand queries
- All sub-agent events flow through `Bus.subscribeAll()` and are accessible in the plugin `event` hook

The technical path is clear. The open question is **what to surface, when, and how** — balancing visibility against notification overload across platforms with different message rate limits and UX conventions.

## 2. Research Objective

Design the user-facing behavior for sub-agent session attribution in IM clients:

1. **What** sub-agent information to display (lifecycle events, progress, results, errors)
2. **When** to display it (real-time, batched, on-demand, on-completion)
3. **How** to aggregate and filter to avoid notification fatigue
4. **Where** platform-specific adaptations are needed (Telegram 4096 char limit, Feishu 30000 char limit, Slack threading, etc.)

## 3. Research Type

**Product Research** — technical feasibility is already validated. This research focuses on:

- UX patterns for nested agent activity display
- Platform-specific message formatting and rate constraints
- Aggregation and filtering strategies
- User preference and control mechanisms

## 4. Decision Context

The output of this research will directly inform:

- Feature design specification for sub-agent attribution
- Implementation backlog items with priority and sequencing
- OutputBatcher and renderPolicy modifications per platform
- TaskManager event routing additions

## 5. Constraints

| Constraint | Detail |
|-----------|--------|
| No opencode core changes | Must work with existing SSE events and REST API |
| No new SSE protocol | Cannot add custom event types to opencode |
| Platform rate limits | Telegram: ~30 msg/min; Feishu: API rate limits; Slack: 1 msg/sec per channel |
| Message size limits | Telegram: 4096 chars; Feishu: 30000 chars; Slack: 40000 chars (blocks) |
| OutputBatcher coupling | Rendering policy must be passed per-platform (see AGENTS.md gotcha) |
| Backward compatibility | Existing single-session UX must not degrade |
| grammY bot.start() | fire-and-forget — no sync init (see AGENTS.md gotcha) |

## 6. Assumptions

1. Most sub-agent sessions are short-lived (seconds to low minutes)
2. Users primarily care about sub-agent results, not intermediate progress
3. Parallel sub-agents are common (e.g., multiple explore agents)
4. Sub-agent error visibility is more important than success visibility
5. Power users may want verbose mode; default should be concise

## 7. Evidence Requirements

| Source | Status | Purpose |
|--------|--------|---------|
| opencode SSE event structure | Gathered | Confirm available data fields |
| IM platform message/rate limits | To gather | Platform-specific constraints |
| Existing bot notification patterns (Telegram bots, Slack bots) | To gather | UX precedent for nested activity |
| PetFish Remote OutputBatcher code | To review | Integration points and current rendering |
| User feedback on current "black box" experience | Desirable | Validate problem severity |

## 8. Acceptance Criteria

This research is complete when:

1. Each core research question has an evidence-backed answer or a justified design recommendation
2. A display strategy is defined for each supported platform (Telegram, Slack, Feishu, WeCom, Web)
3. Aggregation/filtering rules are specified with concrete thresholds
4. User preference/control mechanisms are defined
5. Output is structured as an actionable design spec with implementation backlog entries
6. Trade-offs and risks are explicitly documented
