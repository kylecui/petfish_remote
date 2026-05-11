# Scope Boundaries: Sub-Agent Session Attribution

## In Scope

### Must Address

1. **Display design** for sub-agent lifecycle events (created, completed, failed) in all supported IM platforms
2. **Aggregation rules** for batching/collapsing sub-agent events to avoid notification overload
3. **Per-platform rendering** — concrete message format for Telegram, Slack, Feishu, WeCom, Web
4. **Timing strategy** — when to show sub-agent info (real-time vs batched vs on-demand)
5. **Error surfacing** — how to surface sub-agent failures distinctly from parent failures
6. **Integration points** — where in PetFish Remote codebase (plugin event hook, OutputBatcher, renderPolicy) changes are needed
7. **User control** — verbosity settings and on-demand query mechanisms

### Should Address (if evidence available)

8. **Nested sub-agents** — display strategy when sub-agents spawn their own sub-agents
9. **Concurrent sub-agent** visual patterns — how to represent 3+ parallel sub-agents
10. **Session summary integration** — including sub-agent attribution in post-session summaries
11. **Performance impact** — message volume increase estimates per platform

## Out of Scope

### Explicitly Excluded

1. **opencode core modifications** — no changes to opencode source code, SSE protocol, or REST API
2. **New SSE event types** — must work with existing event schema
3. **Non-IM interfaces** — CLI output, desktop notifications, email digests
4. **Sub-agent task routing/orchestration** — how opencode decides which sub-agent to spawn
5. **Sub-agent output quality** — evaluating whether sub-agent results are good
6. **Authentication/authorization** — who can see sub-agent info (assume same as parent session)
7. **Analytics/metrics** — sub-agent usage dashboards or telemetry
8. **Multi-tenant isolation** — sub-agent visibility across different users/orgs (follow existing model)
9. **Billing/cost attribution** — token usage per sub-agent

### Deferred (may become follow-up research)

10. **Interactive sub-agent control** — user ability to cancel/retry individual sub-agents from IM
11. **Sub-agent output drill-down** — expanding sub-agent results inline in IM
12. **Cross-session sub-agent patterns** — "this agent type is commonly used" insights

## Boundary Rationale

The core boundary is: **this research covers the IM presentation layer only**. The data pipeline (SSE events → plugin hook → event processing) is already validated. We focus on the last mile: event → user-facing message, across platforms, without overloading users.

opencode internals are excluded because modifying them requires upstream coordination and is unnecessary — all needed data is already exposed. Non-IM interfaces are excluded to keep scope focused on the existing PetFish Remote platform matrix.
