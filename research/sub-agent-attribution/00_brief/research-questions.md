# Research Questions: Sub-Agent Session Attribution

## Core Question

**How should sub-agent activity be displayed in IM clients to provide visibility without notification overload?**

---

## Sub-Questions

### SQ1: Display Granularity

**What level of detail should be shown for sub-agent activity?**

- SQ1.1: Which sub-agent lifecycle events warrant display? (created, started, progress, completed, failed, cancelled)
- SQ1.2: Should sub-agent output (results/artifacts) be shown inline, summarized, or hidden by default?
- SQ1.3: How should concurrent sub-agents be represented — individually or as a group?
- SQ1.4: What is the minimum useful information per sub-agent event? (agent type, status, duration, result summary)

### SQ2: Timing and Delivery Mode

**When should sub-agent information be delivered to the user?**

- SQ2.1: Should sub-agent events be shown in real-time, batched at completion, or on-demand?
- SQ2.2: What batch window makes sense? (per-parent-message, time-window, on-parent-completion)
- SQ2.3: Should errors/failures bypass batching and show immediately?
- SQ2.4: How should long-running sub-agents (>30s) be handled differently from short ones (<5s)?

### SQ3: Platform-Specific Adaptation

**How should display differ across IM platforms?**

- SQ3.1: Telegram — how to fit sub-agent info within 4096-char message limit and ~30 msg/min rate?
- SQ3.2: Slack — should sub-agent activity use threaded replies? How to use Block Kit effectively?
- SQ3.3: Feishu — how to leverage card messages and 30000-char limit for richer display?
- SQ3.4: WeCom — what are the message type constraints and how to adapt?
- SQ3.5: Web — should web UI show a different (richer) view than constrained IM platforms?

### SQ4: Aggregation and Filtering

**How should multiple sub-agent events be aggregated to reduce noise?**

- SQ4.1: What aggregation strategy fits best — collapse by agent type, by time window, or by parent task?
- SQ4.2: Should there be a "sub-agent summary line" pattern (e.g., "3 sub-agents completed: explore(2), librarian(1)")?
- SQ4.3: At what sub-agent count threshold should display switch from individual to aggregated?
- SQ4.4: How should nested sub-agents (sub-agent spawning sub-agent) be handled?

### SQ5: User Preferences and Control

**What control should users have over sub-agent visibility?**

- SQ5.1: Should there be a verbosity setting (silent / summary / verbose)?
- SQ5.2: Should users be able to filter by agent type (e.g., "show oracle, hide explore")?
- SQ5.3: Where should preferences be stored — per-user, per-chat, per-session?
- SQ5.4: Should there be an on-demand "show sub-agents" command for the current session?

### SQ6: Persistence and History

**How should sub-agent attribution persist beyond real-time display?**

- SQ6.1: Should sub-agent activity be included in session summaries/exports?
- SQ6.2: Should the task status view (if any) show sub-agent breakdown?
- SQ6.3: How should sub-agent attribution interact with existing TaskManager state tracking?
- SQ6.4: Should sub-agent history be queryable after session completion?

---

## Question-to-Evidence Mapping

| Question | Required Evidence |
|----------|------------------|
| SQ1 | SSE event fields, user interviews/feedback |
| SQ2 | Platform rate limits, UX best practices for async status |
| SQ3 | Platform API docs (message types, limits, threading) |
| SQ4 | Typical sub-agent counts per session, existing aggregation patterns |
| SQ5 | Comparable bot preference systems, current PetFish config model |
| SQ6 | Current TaskManager/storage schema, session export format |
