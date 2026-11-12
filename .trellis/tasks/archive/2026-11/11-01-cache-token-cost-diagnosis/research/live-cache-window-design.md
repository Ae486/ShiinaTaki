# Live Monitor cache rate within the current primary-summary window

Status: owner-approved and implemented; see [delivery evidence](live-cache-implementation-report.md).
The owner rejected a separate task and specified reset on each successfully saved primary conversation
summary. This replaces the earlier all-history/day alternatives. See the original requirement in ../prd.md.

## User behavior and scope

Show one compact statistics strip above the existing Monitor Run/trajectory workspace, below policy diagnostics:
`本次摘要以来` / weighted percentage / `有效缓存数据 N / M 次请求` / last computed update time.
The scope is all recorded Core model requests, including foreground and background. The current primary Character
selects the reset boundary; the selected Run and its list filters do not narrow this overall statistic. Explain the
scope in plain Chinese (`包含对话与后台请求`). Before the first primary summary, label the initial window accordingly.

The visible value updates when terminal usage has been recorded and its aggregate calculated, not when a chat bubble
appears or a token streams. Multiple model requests in one conversation update individually. A successful primary
summary starts a new window immediately. Its own model call belongs to the preceding window, because usage settles
before the checkpoint is committed. A call that starts earlier but settles after the reset belongs to the new window.
Memory tidy, private child summaries, failed/cancelled/stale compaction and uncommitted generated text do not reset it.

The value is sum(cache-read input) / sum(input) over the identical set of valid reported pairs. Do not average request
percentages, include output/cache-write tokens or use all known input when cache is unknown. Explicit upstream zero
hits are included. Input must be positive, cache nonnegative and no greater than input, with safe integer counts.
Empty/no-eligible-input windows display `暂无有效数据`, not 0%. Missing data remain in observed coverage counts.
Failed/cancelled calls with trustworthy usage count; execution success is not a condition for cost observation.

## Existing seams and prerequisite

- `db/effect-repo.ts` atomically inserts unique Effect-owned `run_usage` and publishes `usage.settled` after commit.
- `db/run-event-live.ts` already has a composition-owned `onCommitted` callback, independently of selected-Run sockets.
- `db/auxiliary-usage-repo.ts` updates a started call once to a terminal observation; changed replay is refused.
- `db/compaction-operation-repo.ts:commitSummary` commits the primary checkpoint and operation under one transaction.
- `observability/auxiliary-usage-normalization.ts` already distinguishes raw absent cache fields from explicit zero.
- Monitor's generation, mode and visibility patterns and the existing WS routes remain the client boundary.

The installed OpenAI-compatible adapter synthesizes cache zero when an upstream cache field is missing. Correct new
primary observations by reusing the existing raw-aware normalizer, including the SDK-v7 telemetry shape and direct
provider fallback. Raw usage remains transient. Preserve unrelated lifecycle outcomes and do not retry for accounting.
See [the verified normalization review](live-cache-metric-review.md).

For durable distinction between ambiguous legacy zero and new reported zero, add a small optional cache-origin marker
to the existing primary usage contract/storage. Legacy positive values may be admitted only for the verified adapter
path; legacy zeros remain unpaired without fabricated history. Auxiliary raw-aware observations retain their existing
contract. Do not rewrite prior counts or introduce a second provider parser in the UI/query layer.

## Window design and alternatives

**Choose an atomic aggregate baseline, not a second usage ledger.** The original observations remain in run_usage and
auxiliary_model_calls. At successful primary summary commit, persist the cumulative settled observation count,
eligible pair count, paired input sum and paired cache-read sum, keyed by Character and exact summary revision.
The current window is the difference between current ledger aggregates and that committed baseline. Store sums, not
the ratio. With no summary, the initial baseline is zero. Queries read summary identity, baseline and totals in one
consistent DB read.

This handles same-millisecond completion/summary commits and calls that start before reset but finish afterwards:
SQLite transaction order determines baseline membership. A primary usage row is insert-once; terminal auxiliary
usage is immutable in normal production. Duplicate receipt/event delivery cannot double count a SQL projection.
The baseline is disposable metric metadata, never another authority for a Run, model request or primary summary.

Alternatives rejected:

- Timestamp-only reset is smaller but cannot distinguish equal-timestamp pre/post commits. Auxiliary updated_at is
  particularly wrong: historical imports and interruption recovery can change it after actual model completion.
- A per-request settlement cursor/new event ledger works but adds unnecessary per-call state for an aggregate-only UI.
- Browser-side running totals lose the window on reconnect and double-count replayed events.

A bounded additive migration can add the provenance marker and one baseline row per summarized Character. This does
not require a generic queue, scheduler, retry system or billing engine. Baseline capture is transactionally attached
to successful summary publication; isolate optional metric errors using the existing transaction/savepoint wrapper.
A metric failure cannot roll back otherwise valid summary work. If the summary revision has no valid exact baseline,
show the metric unavailable rather than silently deriving an inaccurate replacement after more requests have settled.
Negative/invalid deltas after unsupported manual ledger rewrites are unavailable, never clamped into a plausible rate.

### Existing active-window initialization

The feature must not force a new summary or paid request just to start measuring. During isolated migration rehearsal,
seed the current summary's baseline using retained completion evidence: primary recorded_at and auxiliary finished_at
relative to the existing primary checkpoint. Never use auxiliary updated_at or the current process boot time.
Explicitly test/report unknown completion times or timestamp ties instead of presenting guessed membership as exact.
The current read-only sample has only positive, bounded primary cache pairs after summary6; no ambiguous primary zero
was observed there. Treat that as data-specific evidence, not a universal migration assumption.
If a historical boundary cannot be reconstructed, retain a truthful incomplete/unavailable initial window until the
next natural successful summary. Do not change the summary, discard originals or silently restart the window at install.

## Delivery and live updates

Use one small Core projection service with a failure-isolated subscription registry modeled on existing subscriptions.
Subscribe returns an initial complete snapshot; unsubscribe/connection close release membership. A separate aggregate
channel is appropriate because existing observability.subscribe is tied to a selected Run and misses auxiliary/global
changes. Do not invent a fake Run to route this metric.

- Primary `usage.settled`, successful auxiliary settlement and successful primary baseline commit notify this service.
- Recompute from durable sources after commit, then send the computed snapshot through typed Shared WS messages.
  Microtask coalescing may combine one synchronous burst, never use recurring timers or defer an already-ready result.
- No subscribers means no repeated aggregate work. Subscribe/re-entry/reconnect reads the durable current window.
- Mode-disabled, hidden page, replaced connection and late responses follow current Monitor lifecycle rules.
- The UI does not own arithmetic, persistence or resets. It renders loading/empty/ready/partial/stale/unavailable states
  without clearing a last-good value to zero. Generation checks prevent an old snapshot from replacing a reset window.

No trend chart, savings estimate, hard token cap, extra filters or model-setting changes belong to this addition.

## Implementation sequence and acceptance

1. Reuse/test raw cache normalization and add durable provenance. Preserve existing valid usage and explicit zero.
2. Add the baseline migration/rehearsal and aggregate query. Verify exact reset, rollback, duplicates, crossing calls,
   timestamp ties, no-summary, legacy unknowns and restart reconstruction with real SQLite.
3. Connect post-commit producers, Shared subscription messages and lifecycle cleanup. Verify auxiliary updates and
   primary requests while a different Run is selected, optional-observer failures and mode changes.
4. Add the compact Monitor strip with existing styling and render all result/connection states. Exercise real WS/client
   subscriptions and the rendered page with scripted models and isolated copies of real data.
5. Run scoped regression tests and project-required checks; independently review the complete change. Compare the
   visible metric to direct SQL on real retained data. Do not force/repeat paid summaries for acceptance.

This is a bounded cross-layer change, not just a text label. Expected seams are Shared usage/monitor protocols, the
two existing usage producers, summary commit metadata, a small Core query/subscription service and the Monitor strip.
The completed delivery records actual file ownership, checks, migration and live update. Existing tidy changes are
preserved; no commit or archive is implied by the implementation approval.
