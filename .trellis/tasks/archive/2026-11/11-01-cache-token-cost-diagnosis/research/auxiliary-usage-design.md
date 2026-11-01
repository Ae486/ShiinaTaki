# Durable auxiliary usage and bounded reasoning comparison

The owner agreed to the next steps after real catch-up: durable auxiliary model usage and a small real reasoning
cost/quality comparison. Existing real-data/paid-call authorization persists. Use the current task/worktree; no commit,
push, Run replay, history deletion or generic billing/recovery framework is authorized by this change.

## Accepted design after independent challenge

Keep canonical Run/Effect `run_usage` intact. Add an independent metadata-only `auxiliary_model_calls` table in migration
065, one row per observed provider-model invocation, including SDK retries and multiple calls inside a Utility task.
This is observed request accounting, not proof that a failed invocation reached the network or was billed.
Do not merge task totals with request records. No pricing engine or new UI page is needed.

Use a tiny shared `observability/model-usage-context.ts` AsyncLocalStorage owner context. Utility establishes immutable
auxiliary task ID/label inside its existing serial task. `createModelEffectMiddleware` wraps only actual
`doGenerate`/`doStream` with Run ownership. The auxiliary meter captures context at entry and skips Run-owned calls.
This avoids double-counting private summaries, optional Run-aware screenshot calls and viewing invitations, without a
new Utility.run parameter or label heuristics. Context contains no database dependency, raw text or mutable global label.

Meter resolved Utility models plus specific untracked VLM consumers in main (image-description memory and shared
screenshot description). Foreground Chat models/vision keep their existing Run observers. Metering failures never alter
provider return/exception identity, trigger retries or block source persistence. Existing authoritative Run settlement
failures retain their current semantics. Fixed diagnostic codes report optional observation loss; no compensation queue.

## Data and API contracts

Shared `auxiliary-usage-schema.ts` owns strict bounded public row/query/result schemas.
Source values: `utility`, `image-description`, `screenshot-description`.
Rows include callId, nullable taskId, source, label, provider/modelId, startedAt, nullable finishedAt, updatedAt,
status (`started`, `completed`, `failed`, `cancelled`, `interrupted`), nullable responseId and counts.
Counts: inputTokens, noCacheTokens, cacheReadTokens, cacheWriteTokens, outputTokens, reasoningTokens, totalTokens.
Every count is a safe nonnegative integer or null. Missing is not zero; reasoning is a subset of output.

Repository `createAuxiliaryUsageRepo(db)` exposes:

- `start({callId, taskId, source, label, provider, modelId, startedAt})`
- `settle({callId, status, finishedAt, usage, responseId})` for terminal observations
- `reconcileInterrupted()` called explicitly once at Core boot, never by constructors or queries; old started rows become
  interrupted with no invented finishedAt/duration or retry.
- `query(params)` for `from`, `to`, optional source/label/provider/modelId, bounded limit, stable `(startedAt,callId)` cursor.
  Results include the page, nextCursor, full-filter totalCalls/state counts, each counter's sum+knownCount and a cache
  fraction calculated only over rows having both input and cache-read. It is an observed-auxiliary scope, not invoice completeness.

`observability.auxiliaryUsage` is an operator-only, mode-gated read method. DISABLED still records counters but refuses
the optional query instead of returning a false empty bill. Existing Run views/subscriptions remain unchanged.

For recognized OpenAI-style raw usage, use whitelisted field presence to undo adapter-synthesized zeros. Preserve
explicit raw zero; absent/malformed raw counts remain null. Unknown raw formats are not interpreted by guessing.
Never store raw prompts, results, reasoning text, images, provider exceptions, credentials or the full raw usage object.

Stream observation forwards consumed chunks/backpressure/cancel exactly once, never drains for metrics. Error followed
by finish+usage remains failed but retains returned usage; finish followed by consumer cancel remains completed.
An uncompleted stream is interrupted/cancelled with unknown unreported counters. Original provider exceptions propagate.

## Implementation sequence and acceptance

1. Shared schema, additive repository/migration and precise count/query tests.
2. Actual provider middleware/context and tests for zero/multiple calls, SDK retry, missing-vs-zero, metadata/storage
   failures, stream error/finish/cancel, and existing Run deduplication.
3. Main/Utility/VLM/RPC wiring, explicit boot reconciliation, indexes/specs, real composition checks.
4. Fixed-input real comparison using saved actual ingestion spans and original summary material. Reuse prior measured
   thinking results where the exact prompt matches; run only the small non-thinking counterpart set initially. Official
   DeepSeek documentation states thinking defaults to enabled/high and accepts `thinking:{type:'disabled'}`.
   Compare valid gate decisions, grounded facts, omissions/unsupported additions, tokens and latency; separate cache
   warm-up from reasoning savings. Do not change production thinking defaults from this small sample alone.
5. Independent final check, required project checks, isolated boot and real-data migration with a fresh backup.
   The five previously captured real calls may be imported exactly and idempotently with their original times/usage;
   unknown older calls are not invented. Persist experiment calls with explicit labels, not fake foreground Runs.

Full project checks passed before this follow-up. Run appropriate focused tests while implementing and the required
final scope checks after integration. No ordinary failure path may replay already completed provider work.
