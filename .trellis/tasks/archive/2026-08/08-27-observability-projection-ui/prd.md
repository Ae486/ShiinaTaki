# DSH-style observability projections and developer monitor UI

## Goal

Implement the first usable DSH-style observability vertical slice over the existing Core Run Event ledger. The slice
must let an authorized local developer inspect readable Run summaries and per-Run trajectories, follow committed events
live, and diagnose trigger/attempt/effect/recovery/delivery behavior without changing execution. The monitor is a
development/operator surface, disabled and absent from normal Home navigation by default.

## Requirements

- Keep the existing Core-owned `Run.currentState` and append-only `RunEvent` ledger as the only authorities. Query and
  trajectory data are projections; they cannot settle, reopen, retry, or mutate a Run.
- Add bounded Shared contracts for monitor mode, Run list filters/pages, Run summary, trajectory rows, event detail,
  cursor/backfill, and live subscription notifications. The contracts must be strict Zod schemas and operator-only at
  the WS boundary.
- Provide a Core query service over durable Runs, Attempts, Receipts, and Run Events with deterministic ordering and
  pagination. Support filters for Character, time, initiator/trigger provenance, state/outcome, category/kind,
  provider/model where available, task/parent lineage, and text only where a separately authorized redacted summary
  exists. Enforce Character/Run authorization before returning data.
- Project DSH-like readable trajectory rows from Run Events. Rows should expose meaningful labels, phase/category,
  state/outcome, timestamps/duration when known, attempt/effect grouping, counts, bounded summaries, and bounded error
  reasons. Preserve `current`, `shadowed`, and `log-only` classification without deleting evidence or duplicating
  ordinary rows.
- Keep technical join fields (`runId`, `attemptId`, `eventId`, schema/source identifiers, hashes/digests,
  generations/revisions, and correlation ids) out of ordinary list rows. They may appear only in an explicitly opened
  developer inspector with clear labels and copy-diagnostic behavior. The inspector must remain redaction-safe.
- Add a post-commit live Run-event subscription using the existing Core live bus and the established connection-scoped
  subscribe/unsubscribe pattern. A reconnecting client must backfill from its cursor before accepting live events;
  observer lag/overflow must not affect Run correctness.
- Add a monitor mode seam using the existing Core config authority. `DISABLED` hides the monitor surface and captures no
  optional Developer Trace detail; `FEEDBACK_ONLY` exposes bounded lifecycle summaries; `FULL_LOCAL` may expose bounded
  redacted detail for local development. The canonical lifecycle ledger remains available in every mode. Secrets,
  credentials, authorization material, raw prompts, raw tool/Host/MCP payloads, and sensor/media bytes remain excluded
  in every mode.
- Add one Home page/entry that is conditionally registered or rendered only when monitoring is enabled. Follow DSH's
  trajectory organization: a compact Run list, readable timeline grouped by Run/Attempt, filters/search, selection, a
  detail inspector, loading/empty/error/reconnecting states, and bounded older-page loading. Do not copy DSH code or
  expose a raw JSON/database table as the primary UI.
- Adapt the presentation to TakiAgent semantics: Character, initiator (primary/scheduled/heartbeat/subagent/etc.),
  Class A/B/internal delivery, trigger reason, busy/defer/quiet/budget decisions, effect governance, delivery state,
  and parent/child lineage are readable labels when those facts exist. Heartbeat-specific rows are supported by the
  generic taxonomy but no Heartbeat policy is implemented here.
- Reuse the existing React, Zustand, Home page registry, WS client, shared page chrome, and Core method registry. Do not
  introduce a monitor framework, ORM, second event store, second timeline authority, or a new runtime loop.

## Acceptance Criteria

- [ ] Core monitor queries return bounded, schema-validated Run summaries and trajectory rows in deterministic order;
      malformed filters, unauthorized Character/Run lineage, oversized pages, and stale cursors fail closed.
- [ ] Run list and Run detail expose the readable fields above while ordinary views omit opaque IDs, hashes/digests,
      generations/revisions, and raw payloads; inspector-only technical details remain redacted and bounded.
- [ ] A Run trajectory can be rebuilt after restart from durable facts and matches the same ordered rows seen before
      restart; projection failure cannot alter Run state or settlement.
- [ ] Live subscription delivers only committed events, performs cursor backfill before live delivery, disposes on
      connection close, and isolates slow/failed/overflowed observers.
- [ ] `DISABLED`, `FEEDBACK_ONLY`, and `FULL_LOCAL` behavior is explicit and tested; disabling optional detail never
      removes canonical Run correctness evidence and monitoring failures never block Agent execution.
- [ ] Desktop Home has no monitor page/entry in the default disabled state. When enabled, the page renders compact
      readable Run/trajectory views with real loading, empty, error, reconnecting, filter, selection, and older-page
      states, without placing technical identifiers in primary rows.
- [ ] Existing primary chat, Scheduled Task, Effect, Recovery, MCP, Skills, Timeline, and Core boot paths remain green;
      no second runtime, event authority, Approval path, or Timeline authority is introduced.
- [ ] Shared/Core/Desktop typechecks, focused tests, proportional full package tests, lint/build checks, isolated Core
      boot, and `git diff --check` pass. Manual monitor acceptance remains an explicit owner check after the automated
      gates.

## Definition of Done

- `prd.md`, `design.md`, `implement.md`, and curated context manifests validate before activation.
- Core query/projection, WS subscription, UI states, privacy/mode behavior, and regression evidence are recorded in the
  child task and relevant package indexes/specs.
- Any implementation-discovered contract change updates this child, the parent roadmap, and the T4 handoff before code
  diverges. This slice is not a final observability architecture; later metrics, export, retention, and richer
  Character aggregation remain visible follow-up work.

## Out of Scope

- Heartbeat engine, Signal Providers, Wake Policy, Interaction Patterns, or any other T4 provider policy.
- Third-party telemetry/export, remote observability backends, arbitrary plugin-defined Run truth, or a metrics dashboard.
- Replacing Pino; Pino remains process diagnostics and is not upgraded into the Run ledger here.
- Raw prompt/completion/tool/Host/MCP/sensor retention or a user-facing transcript/debug dump.
- Cleanup of existing MCP/Skills page presentation debt; record it as separate UI follow-up work.
- Child Run execution, generic task coordination, procedural knowledge, Experience Review, or delivery-policy changes.

## Technical Approach

Use DSH's separation of durable facts, query/trajectory projections, and live coordination, adapted to TakiAgent's
PI-shaped Run authority and Character boundary. The Core owns one projection service and one operator WS surface. The
Desktop page is a disposable consumer using existing Home connection/state patterns. Ordinary UI shows DSH-style
semantic records (Run/Attempt/effect/model/tool/governance/delivery summaries, timing, usage/counts where available);
technical fields are inspector-only. No new dependency or framework is required.

## Research References

- `../08-22-t4-agent-architecture-observability/research/dsh-observability.md` — DSH durable/live split,
  query/filter/tracing contracts, trajectory UI field selection, and redaction caveats.
- `../08-22-t4-agent-architecture-observability/research/phase-d-observability-plane.md` — TakiAgent event taxonomy,
  projection, mode, retention, and authorization contracts.
- `../08-22-t4-agent-architecture-observability/research/phase-e-integration-map.md` — Core/WS/Timeline/Memory/
  Host/Approval integration ownership.
- `../08-22-t4-agent-architecture-observability/research/phase-g-slices-gates.md` — implementation slice and gate rules.
- Archived Slice 2 Durable Event Ledger — existing ledger/live/replay implementation boundary.
- Archived Scheduled Task provider formal-check evidence — current first T4 consumer and residuals.
- `references/deepseek-harness-master/packages/client/ui-trajectory/README.md` — DSH readable trajectory layout and
  inspector behavior.
- `references/deepseek-harness-master/packages/session-query/session-query/README.md` — DSH filters, cursors,
  classification, tracing, and authorization-adjacent contracts.

## Decision (ADR-lite)

**Context:** The Run Event ledger and live bus exist, but there is no production query service, WS monitor surface, or
Desktop trajectory UI. Heartbeat will later require readable skip/wake/decision evidence, while ordinary users should
not see raw developer telemetry.

**Decision:** Build one bounded DSH-style query/trajectory projection and optional local developer monitor over the
existing ledger, using existing React/Zustand/WS/Core registries. Keep the monitor disabled and absent by default;
enablement changes presentation/detail policy only, never Run correctness. Follow DSH's semantic-first UI and inspector
pattern, but adapt labels to Character, initiator, delivery class, trigger, effects, and later Heartbeat events.

**Consequences:** This gives Heartbeat and later Child Run work a usable trace without adding another runtime. It leaves
metrics, export, retention administration, richer multi-Run aggregation, and MCP/Skills UI cleanup for later slices.
