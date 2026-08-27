# DSH-style Observability Projection and Monitor Design

## 1. Boundary

This child completes the first human-usable projection over the already implemented Run Event ledger. It does not
replace Run state, add another event authority, or implement Heartbeat.

```text
Run/Attempt/Effect transitions
  -> existing immutable run_events + post-commit live bus
  -> ObservabilityQueryService
       -> Run summary page
       -> per-Run trajectory page
       -> inspector detail
  -> operator WS read/subscribe methods
  -> optional Home Monitor page
```

The existing mutable Run row remains the recovery cursor. The event ledger remains immutable execution evidence. Every
new surface is read-only and disposable.

## 2. Reference Adaptation

### DSH patterns to adopt

- durable facts and live coordination are separate;
- query/filter/tracing and trajectory UI are pure consumers;
- the primary ledger is compact and semantic, while selection opens an inspector;
- group records by execution boundaries; support search, collapse, older-page loading, tail following, timing, usage,
  status, errors, tool input/output where authorized, and stable selection;
- `current`, `shadowed`, and `log-only` preserve evidence without duplicating the ordinary view.

### TakiAgent adaptations

- Character is the top authorization and product grouping boundary; DSH Session is not introduced.
- Run and Attempt replace DSH Turn/Step only where the semantics actually match. Effects group model/tool/Host/MCP/
  Approval/Memory work beneath an Attempt.
- Taki ordinary rows add readable initiator, delivery class, trigger/provenance, queue/recovery, and later Heartbeat
  wake/skip/outcome semantics.
- Taki's mandatory secret/authorization/sensor exclusion applies in every mode. `FULL_LOCAL` does not mean unrestricted
  raw export.
- Relationship Timeline remains separate. The monitor never creates conversation rows or becomes Replay View input.

## 3. Shared Contracts

Add a focused observability schema module rather than widening arbitrary `RunEvent.payload` records. Suggested concepts:

- `MonitorMode = DISABLED | FEEDBACK_ONLY | FULL_LOCAL`;
- `RunMonitorListParams/Result` with bounded cursor page and closed filters;
- `RunMonitorSummary` with Character, initiator, delivery class, state/outcome, timing, attempt/effect/usage counts,
  bounded reason, and readable trigger label;
- `TrajectoryParams/Result` with Run-bound sequence cursor and presentation rows;
- `TrajectoryRow` as a closed discriminated union for Run, Attempt, model/effect, usage, governance, recovery, delivery,
  trigger/system, and future provider facts;
- `TrajectoryInspector` with separately authorized technical metadata and bounded redacted detail;
- `RunMonitorEvent` notification carrying a cursor plus an already projected row or invalidation signal.

Ordinary summaries must not require technical IDs to be displayed. Stable internal keys still exist in the wire model
for selection and correlation, but they are presentation metadata rather than primary labels.

## 4. Query and Projection Service

Create a Core-owned `ObservabilityQueryService` above repositories. It may add indexed read helpers to `RunRepo` and
`RunEventRepo`, but it cannot write Run state.

- Run list uses keyset pagination over a stable newest-first order and bounded AND-composed filters (Character,
  initiator, state/outcome, time, delivery class, task/parent provenance, provider/model where available).
- Per-Run trajectory reads contiguous `seq` order and joins the bounded Run/Attempt/Receipt snapshot. Labels come from
  a closed mapper; durations are derived only when both boundaries exist. Unknown/running duration is absent.
- Intent/settlement records may be paired into one readable effect row while underlying evidence remains inspectable.
  Superseded Attempt results become `shadowed`; internal accounting/system facts may be `log-only`.
- All methods authorize Character/Run lineage before returning event detail. Redaction is defense in depth at the
  projection boundary; errors are bounded and never echo raw payloads or exceptions.

## 5. Live Subscription

Adapt the established timeline/avatar server-push pattern: connection-scoped subscription with `ctx.onClose` disposal;
authorize the selected Run; backfill projected rows after the caller's durable cursor; attach to the existing live bus
only after backfill; publish monotonic cursors; and invalidate/re-read on overflow, observer failure, or replacement.
Cross-Character/multi-Run live aggregation is deferred until it has a global cursor/order contract.

## 6. Mode and Configuration

Use the existing Core config authority and `config.changed` channel. Default is `DISABLED`.

| Mode | Canonical ledger | Optional detail | Home entry |
|---|---|---|---|
| `DISABLED` | retained for correctness | not captured/exposed | absent |
| `FEEDBACK_ONLY` | retained | bounded lifecycle/effect/usage summaries | visible |
| `FULL_LOCAL` | retained | richer bounded redacted local detail where producers support it | visible |

The current event schema does not contain full Developer Trace content. This child must not fabricate raw detail; it
establishes the mode contract and exposes only available safe fields.

## 7. Desktop UI

Add one conditionally visible `monitor` Home page following existing page registry, connection-generation, and
disposable-state contracts. The page contains a compact Run list, filters/search, selected Run trajectory grouped by
Attempt/effect, older-page loading, and an inspector. Primary rows show Trigger, Character, state/outcome, timing,
model/tool/effect labels, usage, retry/error, and delivery/recovery decisions. IDs, hashes, generations, revisions,
and correlation keys never become primary card content.

Use existing React/Zustand/page primitives. No UI library or new framework is needed. Implement bounded older-page
loading first; add virtualization only if measured volume proves it necessary.

## 8. Failure and Recovery

- Query failure preserves the last view in memory and shows a retryable error.
- Reconnect replaces the client generation, repeats idempotent reads/subscriptions, and never replays mutations.
- Live overflow marks the stream stale and re-reads from the durable cursor.
- Projection/schema failure returns a bounded result and leaves execution unaffected.
- Disabled mode unsubscribes, clears optional detail, hides the page, and preserves the ledger.
- Core restart rebuilds from SQLite; live delivery is not required for correctness.

## 9. Migration, Dependencies, and Deferred Work

No new dependency is needed. Add a migration only if a proven query index is required after inspecting the live registry;
never duplicate Run/Event facts. Defer multi-Run aggregation, metrics/cost dashboards, retention administration,
external export/OTel, richer content-bearing Developer Trace producers, Child Run/Heartbeat-specific polish, and MCP/
Skills page cleanup.
