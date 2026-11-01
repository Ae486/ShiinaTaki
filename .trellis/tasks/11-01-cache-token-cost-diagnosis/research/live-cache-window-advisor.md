# Live cache window: independent design advice

Date: 2026-11-01. Plan-only review in the T4 worktree, base HEAD `9326955`.

## Recommendation

Use a durable aggregate baseline captured atomically with a successful primary
conversation-summary commit. For this aggregate-only card, this is smaller than
adding a new ordered event ledger or a window marker to every model call.
Keep `conversation_summary` revision/operation identity and commit time as the
window identity and display metadata; do not use wall-clock comparison as the
forward membership authority.

The caption is **本次摘要以来**. Define membership by the durable recording of a
model-call settlement, not its start time. A call started before the summary but
settled afterward belongs wholly to the new window. Do not split its tokens.

This advice does not cover the SDK's synthetic-zero cache issue, which has a
separate owner. It assumes the agreed token/known-pair normalization is applied
identically to baseline and current totals.

## What the current code guarantees

- `compaction-operation-repo.ts:223-258` commits the summary revision, operation
  terminal state and immutable committed event in one synchronous SQLite
  transaction. Duplicate, stale and conflicting commits return without a new
  successful summary. This is the correct reset seam.
- `compaction-coordinator.ts:172-224` waits for the compact model call, validates
  summary quality and source consistency, then invokes that commit. The
  Auxiliary meter records the compact invocation before returning its model
  result. Consequently, the summarization call itself is in the old window;
  the successful summary resets the card afterward.
- `effect-repo.ts:131-163,172-204` inserts `run_usage` together with accepted
  Effect settlement. The unique Effect key and terminal check make normal
  settlement append-only and replay-safe.
- `auxiliary-usage-repo.ts:76-114` inserts a row at **start**, then updates that
  row once at settlement. A matching terminal replay is a no-op; differing
  terminal data is refused. There is no production deletion or rewrite of
  terminal usage counters in the inspected source.
- `summary-repo.ts:54-59` also increments summary revision for compatibility or
  setup overwrites. Therefore watching revision changes alone is broader than
  “successful primary compaction.” Private task summaries use
  `subagent_context_summaries`, a separate repository. Tidy changes neither
  primary summary nor its compaction commit.

## Why existing timestamps or row IDs are insufficient

The timestamps are millisecond strings created from `Date`. A usage settlement,
summary commit and another usage settlement can have the same timestamp. A
strict `>` filter loses the later call; `>=` retains the earlier call. A UUID
tie-breaker gives an order but does not recover the actual commit order.

For auxiliary calls, a start-row ID or maximum rowid at the summary also fails:
a row can already exist before the reset while its useful terminal usage arrives
afterward. Raw rowids are additionally not an explicit durable ordering contract.

`auxiliary_model_calls.updated_at` is not the completion time. The existing
historical import preserves `finished_at` but rewrites `updated_at` at import;
boot interruption reconciliation changes `updated_at` without inventing a
`finished_at`. Filtering on updated time would falsely include old catch-up and
compact traffic in the current window.

## Small implementation shape

Persist one baseline per chosen primary-summary scope, tied to its exact
`character_id`, `revision` and `last_operation_id`. Store only the cumulative
statistics needed by the card: paired input sum, paired cache-read sum and the
agreed coverage counts. Store sums/counts, never a rounded ratio. The existing
ledgers remain the detailed source of truth; no prompt or call payload is copied.

At the successful `commitSummary` branch, capture these cumulative values and
the summary identity in the **same existing transaction**. A failed transaction
must preserve both the earlier summary and its earlier baseline. Do not reset on
`summary_generated`, a model finish callback, a duplicate commit, or a frontend
notification. Do not route compatibility `SummaryRepo.upsert`, private summary
writes or tidy through this reset.

For a read, calculate the same cumulative statistics and subtract the stored
baseline. Because previously settled counters do not change, subtraction gives
exact membership for the requested aggregate. A call in flight at reset has no
paired terminal contribution in the baseline; when it settles, its whole
contribution appears in the difference. This also works when timestamps are
identical or the process restarts between reset and the next call.

Read summary identity, baseline and totals from one consistent SQLite snapshot.
Publish an invalidation only after a real first settlement or successful summary
commit; the client rereads the authoritative snapshot. Duplicate callbacks do
not add counters. Reconnect does one current read, without replaying model work
or attempting to reconstruct frontend event history.

Keep the population fixed. For the requested global aggregate, include the same
Run and auxiliary sources on both sides; Monitor browser/filter changes must
not silently change that population. Auxiliary records currently have no
Character column, so this is not evidence for per-Character auxiliary spend.
The primary Character whose summary resets the global card must follow the
product's selected primary scope rather than being inferred from auxiliary
labels. Secondary calls can contribute usage without owning the reset.

The cost is a small aggregate query at reset/read and one durable baseline row.
Use SQL aggregation, not materializing call lists in JavaScript. Do not add
incremental counter maintenance or a general event bus solely to optimize an
unmeasured query cost. If future requirements add per-call window drilldown or
arbitrary provider-filtered historical windows, an explicit settlement sequence
would then have a concrete benefit; it is unnecessary for this card.

## Initial history and future import caveat

There is no exact previously captured baseline for the already committed summary.
Initialize that one historical window from `run_usage.recorded_at` and auxiliary
`finished_at`, using the committed summary timestamp and original completion
times. Verify/report timestamp ties instead of claiming an exact order that was
never recorded. A null `finished_at` is unassigned interruption evidence, not a
completion at `updated_at`; keep its missing-coverage status explicit.

Do not initialize by snapshotting all current totals and calling that “since
the current summary”: doing so would silently discard valid calls between the
last summary and feature activation. The first new successful summary establishes
an exact atomic baseline for subsequent windows. The migration must not issue a
summary or model call merely to establish a boundary.

An explicit future backfill/rewrite of old usage is different from a newly
observed model settlement. If history is imported after an atomic baseline,
an importer must update the affected baseline consistently or explicitly rebuild
it; otherwise an old imported value appears as a new delta. The current five-call
import is already present and is handled by historical bootstrap using original
`finished_at`. Do not introduce a generic backfill engine for a task that does
not authorize another import. Likewise, future usage retention or correction
must preserve/rebase baseline meaning; silently clamping a negative difference
to zero is not valid recovery.

## Focused acceptance before implementation is called complete

1. Identical timestamps: one call settles, primary summary commits, another call
   settles; only the latter contributes to the new window.
2. Cross-boundary call: start before reset, settle after it; count it once in the
   new window. A duplicate settlement changes nothing.
3. Empty/malformed/cancelled/stale/conflicting compaction does not reset. A
   successful primary commit resets atomically, and a duplicate does not reset
   again after a later call. Injected transaction failure preserves both old
   summary and old baseline.
4. Private summary and tidy may add usage but do not reset the window. The compact
   request that produced the new primary summary belongs to the old window.
5. Reopen the database and reconnect the client: the same window identity and
   totals are returned without any provider call or dependence on missed pushes.
6. Historical import timestamps and null interrupted completions do not masquerade
   as new calls. Preserve the separately agreed unknown-cache coverage semantics.

Only this research document was written. No production edits, DB/process actions,
tests, model calls, commits or task-pointer changes were performed by this review.
