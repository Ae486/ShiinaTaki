# Live cumulative cache metric: narrow technical review

Date: 2026-11-01. Read-only review at T4 HEAD `9326955`; no production, database, process-state or model changes.
Scope: additive Monitor metric for primary plus auxiliary model requests, refreshed after usage settlement, with its
window reset only by a successfully committed primary conversation summary. Failed summary attempts do not reset it;
an empty new window has an unknown ratio, not 0%.

## Decision

The metric can reuse the two existing usage ledgers and the existing pure auxiliary normalizer. A new provider metrics
framework is unnecessary. **Primary normalization needs a small forward correction before the new metric can describe
missing cache fields truthfully.** SQL non-null pairing alone does not repair adapter-generated zeroes already stored.

## Verified blockers and constraints

1. **Primary cache absence currently becomes an apparent reported zero.** Installed
   `@ai-sdk/openai-compatible@3.0.75` uses `prompt_tokens_details?.cached_tokens ?? 0`, then computes
   `noCache = promptTokens - cacheRead`; input/output totals also default to zero when their fields are absent.
   See `packages/core/node_modules/@ai-sdk/openai-compatible/src/chat/convert-openai-compatible-chat-usage.ts:25`.
   `packages/core/src/agents/model-observability.ts:154` copies the SDK values and labels any supplied count as
   `reported`; `packages/core/src/db/effect-repo.ts:195` persists zero and turns only absent values into SQL NULL.
   The no-observer path repeats this behavior in `model-effect-middleware.ts:200`, used by the private task summarizer.
   Therefore `quality='reported'` and a non-null input/cache pair do not establish explicit upstream field presence.

2. **The information needed to fix new rows is already available.** Installed `ai@7.0.148`
   `src/types/usage.ts:67,81,100` exposes `LanguageModelUsage.raw` and preserves provider raw usage when normalizing
   each model response. It reaches `onLanguageModelCallEnd`, which is wired to the primary observer at
   `run-observability-telemetry.ts:66`. The direct provider boundary also has the raw usage object.
   Existing `observability/auxiliary-usage-normalization.ts:10,42` checks raw field presence, keeps explicit zero,
   rejects malformed/out-of-range counts, and rejects conflicting cache aliases. Auxiliary metering already uses it.
   Reuse this logic through a thin SDK-v7-to-provider-v4 shape mapping, or extract the same small pure helper for both
   callers. Keep raw objects transient. Do not create a second parser in the Monitor query or persist provider bodies.
   Preserve existing lifecycle/settlement outcomes and unrelated usage semantics; changing the producer of a cache
   metric must not trigger model retries or convert partial accounting into execution failure.

3. **A truthful pair requires more than `IS NOT NULL`.** For each included request, require a finite/safe integer
   input count `I > 0` and cache-read count `0 <= H <= I`, with a trustworthy reported origin. Compute
   `sum(H) / sum(I)` over exactly these pairs. Explicit `H=0` belongs in the denominator; absent/invalid H does not.
   `I=0,H=0` contributes no information to a hit ratio and should remain an observed request outside the informative
   pair count. No valid positive denominator means null. Never average per-request percentages, divide cache by all
   known input, count output in the denominator, or include cache-write as cache-read. Existing schemas bound individual
   counts but do not enforce `H <= I` (`shared/effect-lifecycle-schema.ts:53`, `shared/auxiliary-usage-schema.ts:18`).
   The new aggregate should enforce the relation and expose paired versus observed counts.

## Seeding the currently active summary window

The summary boundary removes the need to reconstruct all-history billing, but the currently active window may still
contain requests recorded before the normalization correction. Do not rewrite them or assume a new UI feature made
old `reported` rows more trustworthy.

- For rows known to have come through the inspected OpenAI-compatible adapter, a **positive** cache count is not its
  missing-field default. A valid positive input/cache pair can be used as evidence-backed seed data.
- A pre-correction **zero** cache count is ambiguous without retained upstream evidence. If such rows exist in the
  active window, keep them in the observed/unpaired count and exclude them from the ratio, or clearly label the view
  as historical SDK-normalized accounting rather than explicit upstream cache reporting. Do not call them cache misses.
- Do not permanently filter all zeroes: new explicitly reported zeroes must count. If the active window must survive
  restart while distinguishing ambiguous old zeroes from new explicit zeroes, retain a trustworthy producer transition
  boundary/provenance marker or disclose that compatibility limit. Replacing the boundary with the latest boot time
  would silently change the cumulative result. A request to display the metric does not justify rewriting history.
- Once a successful summary starts a wholly corrected-producer window, ordinary nullable ledger fields are sufficient;
  no per-provider registry is required. The aggregate should retain the summary/window identity so a stale pre-reset
  refresh cannot overwrite the new window.

Use the request's usage settlement/completion observation for window membership, not only its start time: a call can
start before a summary commit and complete afterwards. Primary rows supply `recorded_at`; auxiliary rows supply
`finished_at` and settlement metadata. Handle equal-time boundaries consistently with the summary commit owner.
Boot interruption's absent `finished_at` is not an invented model completion time. Auxiliary rows have no Character
identity, so the result must not silently claim attribution to one Character beyond the agreed aggregate window.

## Failed requests, deduplication and live refresh

**Include usage that was actually recorded even when its request or containing Run failed, was cancelled, or later
became interrupted.** Model work may already have been billed. Do not filter the numerator/denominator by
`runs.state='completed'` or auxiliary `status='completed'`. A failed request lacking usage increases coverage uncertainty;
it does not contribute fabricated zero tokens.

- Primary: `model-observability.ts:107` permits `finishReason='error'` with usage. `effect-repo.ts:136,151` settles by
  Effect CAS, inserts one usage row and emits its duplicate event representation. Migration `026-run-effects.ts:46`
  declares `run_usage.effect_id` unique. Read the ledger once, dedup by its existing Effect/usage identity, and never
  sum both `run_usage` and `usage.settled` or combine per-request rows with a Run total.
- Auxiliary: `auxiliary-usage-meter.ts:81` suppresses Run-owned calls through the existing immutable ownership context.
  `beginCall` creates a call ID per actual provider invocation; `auxiliary-usage-repo.ts:79,95` makes starts and matching
  settlements idempotent. Read each `call_id` once. Separate retry invocations are separate observations and must not
  be deduplicated by task ID, provider response ID, or prompt similarity.
- Auxiliary `error` followed by `finish` retains the failed call's later usage (`auxiliary-usage-meter.ts:162`, existing
  test at `auxiliary-usage-meter.test.ts:162`). Consumer cancellation without a finish is honestly unknown.
- **Existing coverage limit, not a required lifecycle rewrite for this metric:** primary middleware settles a stream
  error/interruption before an eventual finish (`model-effect-middleware.ts:119`); observer failure removes its binding
  (`model-observability.ts:134`). Later usage can consequently be absent from the ledger. Do not claim this aggregate
  captures every upstream bill, and do not replay or drain cancelled calls merely to improve the metric.
- Refresh after the authoritative write succeeds. Primary already publishes `usage.settled` after its transaction
  (`effect-repo.ts:163`). Re-querying the cumulative ledger projection is safer than incrementing a UI counter from
  replayable events. Auxiliary needs an equivalent invalidation/notification at its successful existing settlement
  seam if it is to update immediately. Observer failure must remain non-interfering.

## Minimal validation

Existing pure normalizer was executed against four synthetic usage objects: missing cache -> null; explicit zero -> 0;
positive 80/100 -> 80; impossible 120/100 -> null. All passed without a model/provider/database call. SDK raw preservation
and primary persistence were verified by installed source, not a real upstream test. A direct attempt to import the
SDK's TypeScript source was refused by Node's `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`; this does not affect the
application's compiled SDK, and that attempt is not claimed as a passing SDK runtime test.

Necessary implementation checks: primary callback and no-observer direct path preserve missing versus explicit zero;
weighted aggregation excludes unknown/invalid pairs; failed-but-metered rows count; duplicate/replayed notifications
do not double count; a multi-step Run refreshes after every usage settlement; summary success resets while failure
does not; empty window is null; boundary-spanning completion and stale-response/reconnect races preserve the window.
These are targeted requirements, not a new general observability platform.
