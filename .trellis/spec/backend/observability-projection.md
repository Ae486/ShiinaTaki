# Run Observability Projection Contract

## 1. Scope / Trigger

Use this contract when adding or changing Run monitoring, lifecycle event producers, trajectory projection, operator
observability methods, monitor modes, metrics/totals, or post-commit Run Event subscriptions. `runs` and the immutable
`run_events` ledger remain the only execution authorities. Every monitor response is a disposable read projection and
must never settle, retry, reopen, or otherwise mutate a Run.

## 2. Signatures

Shared method vocabulary:

```typescript
const OBSERVABILITY_METHODS = {
  state: "observability.state",
  list: "observability.list",
  trajectory: "observability.trajectory",
  inspect: "observability.inspect",
  subscribe: "observability.subscribe",
  unsubscribe: "observability.unsubscribe",
  event: "observability.event",
} as const;

type MonitorMode = "DISABLED" | "FEEDBACK_ONLY" | "FULL_LOCAL";
type RunMonitorCursor = { queuedAt: string; key: string };

type RunObservabilitySession = {
  middleware: LanguageModelMiddleware; // commits Effect intent before provider dispatch
  telemetry: Telemetry;                // supplies normalized usage and measured performance
  assertHealthy(): void;               // rethrows an authoritative settlement failure at the owning stream boundary
};
```

Core composition owns one `ObservabilityQueryService` over the existing Run/Event repositories and one connection-
scoped subscription per operator connection. The configuration key is `TAKI_MONITOR_MODE`; it is Core-owned, live-
applied, and defaults to `DISABLED`.

## 3. Contracts

- All request and response shapes are strict, bounded `@taki/shared` Zod schemas. Methods are operator-only and need
  no Rust mirror while the Shell is not a consumer.
- `DISABLED` removes the Home monitor surface. List returns no optional projection; trajectory, inspector, and
  subscription fail closed. Canonical lifecycle evidence remains durable in every mode.
- List order is `(queued_at DESC, run_id DESC)`. Its cursor names a real Run belonging to the requested Character and
  must match that Run's durable `queued_at` value.
- Projection filters that require Runs, Attempts, Receipts, or Events may scan keyset batches up to a bounded budget.
  If the budget is reached before durable exhaustion, return the last scanned Run as `nextCursor` even when the page
  is empty or shorter than requested. Never report false exhaustion after an early SQL `LIMIT`.
- User-facing rows and Inspector details expose semantic labels, timing, state/outcome, counts, bounded summaries,
  useful input/output and effect context. Under the 2026-09-05 G4 owner clarification, opaque IDs, digests, internal
  revisions/generations and correlation bookkeeping are not rendered even in expanded details or `FULL_LOCAL`.
  Existing wire/internal identity fields remain valid for queries, authorization, selection and replay; this display
  rule neither deletes canonical evidence nor changes API schemas. Follow the frontend field-selection contract.
- Monitoring is producer-first. A token, tool, timing, provider/model, approval, delivery, recovery, or cache field may
  enter Shared contracts/UI only after a fixed Core lifecycle boundary emits a versioned, bounded fact that can rebuild
  the same projection after restart. Missing/unknown facts remain absent or explicitly unknown; the UI never infers
  them from Pino text, hashes, elapsed wall time, final messages, or zero defaults.
- AI SDK telemetry callbacks are an isolation boundary: `notify()` catches callback exceptions. Optional bounded event
  append failures therefore stay contained, but authoritative Effect/usage settlement failures must be captured by the
  per-call observer and rethrown by `assertHealthy()` before the owning stream is accepted as complete. Never rely on a
  thrown telemetry callback to fail the Agent turn.
- Cache metrics require a provider/runtime-owned cache definition and authoritative hit/miss/unknown producer. A model
  provider that exposes no cache signal must not be reported as `miss` and must not receive a provider-specific branch
  merely to populate the Monitor.
- `FULL_LOCAL` still excludes raw prompts, credentials, authorization material, raw tool/Host/MCP payloads, and
  sensor/media bytes. It may expose only separately produced bounded redacted detail.
- Subscribe authorizes and backfills from the durable cursor before attaching to `RunEventLiveBus`. A replacement
  subscription closes the prior membership; explicit unsubscribe and `ctx.onClose` both dispose it. Overflow or mode
  disable emits an invalidation and cannot block Run execution.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Character does not own the Run/cursor | `OBSERVABILITY_FORBIDDEN` or stale cursor refusal; return no data |
| Cursor timestamp/key no longer identifies the same durable Run | `OBSERVABILITY_CURSOR_STALE` |
| Trajectory cursor is beyond the durable event tail | `OBSERVABILITY_CURSOR_STALE` |
| Mode is `DISABLED` | Empty list; reject trajectory/inspect/subscribe; invalidate an existing live stream |
| Page/filter exceeds schema bounds | Zod application error; do not coerce or widen it |
| Projection scan budget is reached | Return current matches plus a continuation cursor from the last scanned Run |
| Observer overflows or throws | Isolate/close that observer and notify invalidation; Run correctness is unchanged |
| Optional model/tool event append throws | Contain it; provider/tool execution and authoritative Effect truth continue |
| Authoritative Effect/usage settlement throws inside an AI SDK telemetry callback | Capture it and fail at the owning stream boundary; do not let SDK callback isolation silently leave a successful turn |
| Connection closes or client unsubscribes | Remove the exact connection-scoped subscription idempotently |
| Projection requests a field with no durable producer | Omit/mark unknown; do not fabricate or derive from Pino/UI state |
| Provider exposes no authoritative cache signal | Cache status is unavailable, never a synthetic miss |
| A response contains technical identity/bookkeeping fields | Preserve the contract internally; user-facing views render useful semantic fields and omit those bookkeeping values, including expanded Inspector views |

## 5. Good / Base / Bad Cases

- Good: a sparse category filter scans several bounded keyset batches, returns two matches and a continuation cursor,
  then the next request resumes without gaps or duplicates.
- Good: reconnect reads a durable trajectory page, subscribes after its returned sequence, and receives each later
  committed event once.
- Good: normalized telemetry supplies usage/performance, settlement commits, and `assertHealthy()` returns before the
  Chat loop accepts the stream as complete.
- Base: `FEEDBACK_ONLY` displays lifecycle/effect/usage summaries while the inspector omits optional local detail.
- Base: a provider reports token usage but no cache information. The trajectory shows the token fact and omits cache
  totals without degrading the Run.
- Bad: filter only the newest 500 Runs in memory and omit `nextCursor` when none match; this silently hides older
  matches. Also bad: dump internal event metadata into primary or expanded UI, keep a subscription after socket close, or calculate a
  "cache miss" from the absence of a cache field.
- Bad: perform authoritative settlement only inside `onLanguageModelCallEnd` and assume throwing will fail the turn;
  AI SDK telemetry notification catches that exception.

## 6. Tests Required

- Shared: closed modes/methods, strict unknown-field rejection, page bounds, time range validation, and raw-payload
  exclusion.
- Core query: Character authorization, deterministic order/replay, stale cursors, sparse-filter scan continuation,
  disabled behavior, semantic field projection, producer-absent/unknown handling, and inspector redaction.
- Producer coverage: every displayed model/tool/usage/context/timing/governance/delivery/recovery field has a focused
  producer test plus restart/replay equality; provider-neutral absence remains absent.
- Model telemetry: success/provider failure/interruption settle exactly once; detailed cache/reasoning/total usage and
  measured timing survive DB replay; optional event-writer failure is isolated; authoritative settlement failure is
  observed by `assertHealthy()` and rejects the owning stream.
- Core methods/live: operator role, backfill-before-live order, one membership per connection, explicit unsubscribe,
  close cleanup, overflow/mode invalidation, and observer isolation.
- Desktop projection: expanded Inspector and every enabled mode retain useful semantic facts without technical
  bookkeeping rows/copy controls; hidden presentation must not break the original query, selection or cursor identity.
- Integration: isolated real Core boot in default-disabled and enabled modes plus an authenticated operator
  `observability.state/list` smoke.
- Cross-layer changes also require Shared/Core/Desktop typechecks and tests, Desktop build, root lint, and
  `git diff --check`.

## 7. Wrong vs Correct

```typescript
// Wrong: the early limit becomes a false end-of-history boundary for sparse filters.
const runs = db.prepare("SELECT * FROM runs ORDER BY queued_at DESC LIMIT 500").all();
return { runs: runs.filter(matchesFilter) };

// Correct: scan bounded keyset batches and preserve continuation when the scan budget, not durable history, ends.
while (matches.length < limit + 1 && scanned < scanLimit) {
  const batch = readAfter(cursor, 500);
  // project/filter, then advance cursor to the last scanned durable Run
}
return { runs: matches.slice(0, limit), nextCursor: continuationIfNeeded };
```

```typescript
// Wrong: fill a dashboard field because the provider response omitted it.
const cacheStatus = response.cacheHit ?? false;

// Correct: emit and project only an authoritative provider/runtime fact; absence stays unknown.
const cacheStatus = response.cacheUsage?.status; // "hit" | "miss" | "unknown" | undefined
```

```typescript
// Wrong: AI SDK notify() catches this callback failure, so the Agent turn can appear successful.
telemetry.onLanguageModelCallEnd = (event) => effects.settle(usageFrom(event));

// Correct: keep optional event append best-effort, but carry settlement failure back to the stream owner.
telemetry.onLanguageModelCallEnd = (event) => observer.settleOrCapture(event);
for await (const part of result.stream) consume(part);
observer.assertHealthy();
```
