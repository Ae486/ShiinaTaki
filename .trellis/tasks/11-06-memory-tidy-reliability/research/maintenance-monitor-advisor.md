# Maintenance Monitor independent design review

Date: 2026-11-06. Read-only source review against the owner's request: include memory tidy and conversation
compaction in Run Monitor, distinguish them from normal execution, and exclude these two chains from normal cache
rate, input occupancy and related statistics. Existing unrelated dirty work was preserved. No runtime, model or live
database operation was performed by this review.

## Recommendation

The proposed separate read projection is appropriate. Reuse `memory_operations` for tidy,
`conversation_compaction_operations/events` for compaction, and linked `auxiliary_model_calls` for observed model
work. Do not manufacture Runs or insert maintenance events into an ordinary Run merely to reuse the current DSH UI.
That would mix execution authorities and ordinary Run aggregates.

The smallest useful first surface is a distinct background-operation browser plus selected-operation status,
progress/lifecycle facts and recorded model-call rows. Raw prompts, memory bodies and summary text do not belong in
this Monitor change. Existing tidy progress is a current snapshot, not a historical tool trace; only promise richer
tool rows if a bounded durable producer is added for them.

## Confirmed boundaries and required corrections

### 1. Filtered totals cannot use the old all-call baseline

`core/db/cache-usage-repo.ts:104` unions all `run_usage` with every terminal auxiliary call. Its captured baselines
store the same all-call population. Filtering only the current total can produce a negative or plausible-but-wrong
delta after subtracting the old baseline.

Use a higher additive migration and explicit population identity (or separate new-population baseline metadata).
Do not edit recorded migration 066 or silently reuse its counts. Historical reconstruction can follow
`core/db/migrations/066-cache-usage-window.ts`: original `recorded_at`/`finished_at`, strict-before membership,
verified summary/compaction identity, and unavailable when included historical rows have unknown/tied timestamps.
However, the new migration must use the **current** primary pairing rule: `cache_read_observed=1`, or historical
NULL with a positive usable cache count. Copying migration 066's old positive-cache-only rule would lose modern
explicit-zero observations.

Apply historical ambiguity checks to the **included** population. A tied excluded tidy/compact call should not by
itself make the ordinary baseline unavailable. Unknown included settlement time remains a real ambiguity. Do not
reset the baseline to upgrade time: that would silently discard the existing post-summary window.

Successful primary summary replacement should still reset the normal cache window in its transaction. Excluding
the compact model call's usage does not remove the semantic meaning of the summary boundary. Failed, cancelled,
duplicate and private summaries keep their existing no-reset behavior.

### 2. Preserve the requested population boundary

Historical normal-cache exclusion can be exactly `source='utility' AND label IN ('tidy','compact')`. These are the
actual labels in `tidy-pass.ts` and `agents/compaction-coordinator.ts:173`. Do not silently remove other existing
auxiliary producers (episodic, ingestion, screenshot description or standalone flush).

Legacy compaction may invoke a `flush` Utility task before its `compact` call
(`compaction-coordinator.ts:157`, `memory/flush-writer.ts:72`). If the implementation instead classifies an entire
outer operation through ambient context, it can also exclude this flush. That is a real boundary choice: document
it explicitly rather than accidentally broadening the label-based contract.

Update `CacheUsageWindowSnapshot.scope` and UI wording with the new population. The current strict Shared literal
is `all-observed-model-requests`; `cache-usage-strip.tsx` explicitly says it includes conversation and background
calls. Leaving either wording unchanged would describe the wrong statistic.

### 3. New operation linkage must be producer-proved

`observability/model-usage-context.ts:19` creates a new UUID task identity per Utility task. `UtilitySlot.run` uses it
for each tidy batch; it is not a durable tidy-operation identity. Compaction identities are `compact:<sha256>`
(`compaction-coordinator.ts:354`), while `AuxiliaryModelCall.taskId` is UUID-only. Do not repurpose `task_id` or infer
historical operation/Character ownership from timestamp proximity, model names or active selection.

A small explicit path is sufficient: optional immutable operation reference in `UtilitySlot.run` -> auxiliary
usage owner -> meter start -> nullable operation-kind/operation-id/Character columns. The existing durable tidy
owner supplies its operation ID; the compaction lease supplies its own ID and Character. Freeze the reference when
queuing; preserve it across later callbacks. The optional operation reference is telemetry correlation, not a new
authority or recovery cursor. Missing historical links remain unknown.

Most importantly, **do not display tidy `outcome.usage` as per-operation cost**. It comes from `deps.slot.usage()`
and is cumulative process-wide Utility usage, including earlier/interleaved background tasks. Aggregate only
proved auxiliary links, with recorded-call coverage and unknown values explicit.

### 4. Input occupancy already has the right source boundary

`core/db/request-attribution-repo.ts:68` begins from `primary_conversation_sources` and checks the actual Run's
`initiator === 'primary'`. Keep that independent latest-primary query and its exact Effect join. Background
selection must not replace the top primary-input panel or alter normal Run counts/cache filters.

The fact that successful compaction makes the *next primary request* smaller should remain observable; this is the
primary request's real input, not accidental inclusion of the compactor call.

### 5. Lifecycle pushes need more than successful completion

`auxiliary-usage-repo.ts:61` currently notifies settlement/recovery but not start. Compaction exposes only
`onSummaryCommitted` in `createCompactionOperationRepo` (`:106`), so failures, cancellation and in-flight generation
are not covered by that hook. Memory operations already publish their committed state/progress transitions.

Wire optional, failure-isolated after-commit invalidation for actual start and terminal/progress changes in all
three producers. A thrown socket or Monitor reader must not alter execution, retries or summary commitment. Use
the existing generation/revision and visibility patterns: authorize subscribe, return a coherent initial snapshot,
attach the notification handler before the request, re-read on reconnect, withdraw on DISABLED, and stop detailed
reads/emits while hidden. No timer polling or write-on-read recovery.

### 6. Choose immutable ordering and honest measurements

Compaction `started_at` is rewritten when the same operation is retried (`compaction-operation-repo.ts:165`).
For stable cross-kind pagination use its immutable `operation_seq=1` event time as the operation's first-seen
anchor, or otherwise define attempt-based rows explicitly. Do not mix an operation-wide call sum with a displayed
latest-attempt duration without a label. Tidy admission-to-terminal elapsed time includes queue waiting.

Compaction currently persists `beforeTokens` and generated `outputChars`, not a measured after-input token count or
source/summary token pair. Do not divide different units to fabricate compression rate, token savings or occupancy.
Show the actual available facts and labels; keep unknown measurements absent. Model-call durations can use their
own recorded start/finish timestamps.

## Focused acceptance matrix

- Ordinary primary calls plus tidy/compact calls leave normal cache numerator, denominator and observed count
  unchanged by only the two excluded labels; unrelated auxiliary calls retain existing treatment.
- Fresh summary capture, migration of a historical baseline, explicit-zero cache, tied included/excluded calls,
  missing timestamps, SQLite reopen, rollback and next valid summary recapture.
- Background operations and model calls never enter `runs`, `run_usage`, normal Run aggregates or latest-primary
  request selection. Global accounting may still retain them as real spend.
- A tidy operation spanning multiple Utility batches associates every call with the same operation and keeps
  other queued work separate. Compaction retry keeps its recorded attempts and correct stable browsing anchor.
- Old unlinked operation/call rows remain visible with honest missing coverage; no fake zero cost or guessed link.
- Start -> in-progress -> success/partial/failure/cancel/restart recovery updates after commit, including an
  auxiliary start followed by transport failure. Rollback and duplicate settlement do not invent fresh facts.
- Monitor DISABLED, hidden page, physical reconnect, late old-generation responses, subscriber failure and
  mode change during a read cannot leak stale detail or affect execution.
- Render the normal and background surfaces together and prove that selecting a background row does not change
  normal cache/input panels. Verify pagination beyond a single page of operations and model calls.

## Review limits

This is source/design review, not implementation verification. No tests or paid model calls were run by this
advisor. The parent owns final API/migration choices, independent finding verification, implementation, tests and
manual-acceptance status. No source files or live data were changed.
