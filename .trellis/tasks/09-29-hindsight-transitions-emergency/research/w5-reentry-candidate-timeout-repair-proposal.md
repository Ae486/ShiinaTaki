# Proposed bounded repair for W5 reentry candidate baseline cost

Status: proposal only, awaiting parent implementation scope. No production source or production timer has been changed.

## Measured problem and confidence

The parent-owned physical clone ran the exact `TransitionDeltaService.apply` once, using normal claim of the same transition, unchanged logical delta request hash/operation and synthetic embeddings. Actual apply took **94.569 seconds**. At **60.382 seconds**, it was still inside the **second `_admit` / `capture_transition_baseline`**, before native or application writes. The two complete baseline captures took **30.564 + 30.336 = 60.900 seconds**. The synthetic embedding seam took **1.97 milliseconds**.

This establishes a reproducible request-budget overrun in the actual Native apply read path for the copied corpus. It is independent of later synthetic-vector-dependent graph writes. It does not prove which original HTTP request timed out: the original logs did not record an endpoint, and no exact delta receipt existed after the original server stopped.

Evidence: `.trellis/.runtime/w5-candidate-native-clone-22efe32ae26c4938b6bf3edfd36c8278/result.json`, SHA256 `45aa7df021304e1fe8891a2087357d48c2ab8d2e2f0876d056cfe70a2da5645d`. The clone committed one receipt, exact lookup matched, all preservation flags are true and PG stopped. These are fixture outcomes, not real-pair acceptance.

## Chosen initial repair

Reduce repeated body loading and integrity work **inside each individual delta baseline invocation**. Retain both independent baseline validations, their complete native/application/auxiliary sets, all hashes, original row ordering and all state/owner guards.

The current baseline creates one `ApplicationStateStore`, asks `_bundle_records` to validate every native head and historical artifact body, and then validates the same retained body references again. The full-clone trace records 21,758 body-descriptor queries and 21,758 body-part queries. They consume about 30.371 seconds in SQL alone across the complete probe, before repeated byte/digest work. Optimizing this concrete duplication has substantially more evidence than changing TTLs, skipping a baseline or optimizing the later graph writes.

Use an opt-in private baseline reader that prefetches raw body storage in bounded batches and reuses checked **immutable bytes** for identical complete descriptors. Do not cache or share mutable Pydantic results. Every `read_body` still decodes and validates a fresh model using the existing schema and source-evidence closure code.

## File ownership

All paths in the first table are under `H:/hindsight/hindsight-api-slim/`.

| File | Exact responsibility |
| --- | --- |
| `hindsight_api/engine/transition_baseline_reads.py` (new) | Private invocation-local reader, bounded raw descriptor/part prefetch, exact immutable-byte cache, dependency-cycle guard, and disposal. It is a baseline-read helper and exposes no cache capability to callers. |
| `hindsight_api/engine/application_state/store.py` | Extract protected raw metadata/part loading methods from existing `stored_body` / `body_bytes`; default methods execute the same SQL and retain the existing validation/error code/order. The private reader overrides only loading and explicitly scoped byte reuse. No default cache. |
| `hindsight_api/engine/transition_snapshot.py` | Select the private reader only for an explicit internal delta-baseline option, create it inside the invocation and dispose it in `finally`. Keep the ordinary `TransitionBaseline` return value and all source/hash/auxiliary validation. |
| `hindsight_api/engine/transfer/transition_delta.py` | Opt in only at `_admit`'s existing baseline assertion, after the existing Bank lock and exact executor/baseline checks. Both transaction invocations remain. No reader is passed into preflight, embeddings or writes. |
| `tests/native_results/test_transition_baseline_reads.py` (new) | Owned-PG equivalence, corruption, isolation, mutation, closure and budget-fallback regressions over the actual reader/caller. |
| Existing `tests/native_results/test_transition_delta.py` | Add the targeted two-transaction revalidation regression if its existing fixture is the smallest seam. Preserve existing cases. |

Task artifacts stay under the existing task's `research/`. Add an immutable repair source manifest and new before/after measurement artifacts; never rewrite the diagnostic source/evidence manifests. If implementation changes the executable contract, update the narrowly relevant section of `.trellis/spec/backend/memory-transition-healthy-drivers.md` after verification. No generated template, protocol schema, migration, dependency or Core runtime changes are currently proposed.

## Reader contract and implementation constraints

1. **Opt-in and lifetime.** Only delta `_admit` enables the reader. Its existing synchronous logical scope is a live SQL transaction that already holds the canonical Bank/fence protection and validates the exact executor. The baseline helper performs no logical write. Allocate a fresh reader per `capture_transition_baseline` call; do not attach it to the backend, connection, process, request, or transition. Discard it on success, failure and cancellation. No reader/cache object is returned.
2. **Two independent views.** The first transaction's reader is gone before configuration/embedding preparation. The second `_admit` constructs another reader and rereads/revalidates all relevant storage. Do not extend this optimization to the application writer, final artifact pass, ordinary D77 snapshot/hydration, unused-scope capture or final proof without a separately reviewed scope.
3. **Exact identity.** Bind every entry to the actual connection invocation, provider lineage, Bank ID, Bank generation, body ID and the complete canonical body descriptor, including schema, payload hash, byte hash, lengths and part layout. A body ID alone is not a valid cache key. A mismatching descriptor still reaches the existing `body_conflict` path; it cannot alias a prior verified entry.
4. **Same validators.** Raw prefetch is transport, not evidence. Reuse the existing sealed-state check, exact descriptor comparison, part count/order/size/SHA256 checks, whole byte hash, semantic digest, body schema, and dependency validation. Preserve native head/current payload checks and complete logical/auxiliary hashes. No caller-supplied subset or captured hash substitutes for current storage.
5. **Fresh mutable results.** Cache only Python `bytes` after successful validation; do not retain decoded dictionaries or returned Pydantic objects. Each `read_body` executes the existing decoder/schema/source-evidence validation anew. Mutation of one returned model must not alter a later read. No new recursive deep-copy path is introduced for arbitrarily deep supported metadata.
6. **Dependencies and failures.** Preserve recursive Source-evidence checks, including the referenced original Source body and exact historical artifact revision/hash. Track active dependency identities and reject a cycle with a closed existing integrity/source-reference error. Failed schema/closure reads must not produce an accepted cached result. A cached raw byte value never suppresses a subsequent schema/closure check.
7. **Missing/duplicate/corrupt storage.** Do not collapse duplicate prefetch rows into a dictionary silently. Detect duplicate descriptor/part keys, missing bodies, absent/extra/out-of-order parts, wrong namespace and byte/digest mismatches. Preserve the corresponding ordinary refusal, including when failure occurs on a nested Source body. Never silently fill missing rows from another scope.
8. **Bounded memory and fallback.** Use bounded descriptor batches and a declared/actual-byte budget before materializing a multi-body batch. A proposed initial implementation budget is at most 128 descriptors and 8 MiB of raw parts per prefetch batch, with at most 64 MiB of cached verified bytes. Actual row-size metadata must prevent an unexpectedly oversized batch from being loaded as if the declared size were trustworthy. Oversized bodies, exhausted cache budget or eviction use the ordinary one-body full validation path; they never skip validation, reject otherwise legal data solely due to the cache budget, or request a new public configuration. The implementer may lower these private optimization budgets with measurement, while preserving this fallback contract.
9. **Ordinary path preservation.** `ApplicationStateStore` without opt-in has byte-equivalent SQL inputs, validation and outputs. Existing upload/seal/write/row-locking paths use the ordinary loader. The private baseline reader does not service writes or lock-taking body calls.

The budgets are optimization resource bounds, not memory/provider acceptance limits. No production request timeout, setup deadline, executor lease, maintenance budget or admission TTL changes.

## Regression and equivalence gate

Add the regression first at the real baseline caller/owned-PG seam, then implement. Required cases:

- Optimized and ordinary captures of the same owned fixture produce identical native, application, auxiliary and complete baseline hashes, including all retained history, invalidated units, Source aliases and nested Source evidence.
- Corrupt body byte/checksum, missing/extra/out-of-order part, mismatched descriptor/schema, duplicate raw key and foreign namespace each refuse through the real validators. Exercise corruption in a dependency as well as a top-level body.
- Read, mutate the returned Pydantic model/dictionary, then reread the same descriptor: the second result still reflects verified stored bytes. A same-ID/different-descriptor call refuses rather than hitting the previous entry.
- Exercise cyclic dependency refusal and legal deep metadata without replacing the established iterative codec with recursion-limited copy logic.
- Force a tiny cache/prefetch budget to exercise fallback and eviction; compare output/refusal with the ordinary reader. An over-budget body still receives complete validation.
- Between the first and second apply transactions, change a relevant stored body or logical witness in the isolated test fixture. The second `_admit` must independently refuse and leave no delta/native/application commit. Reuse the actual existing between-transactions embedding/config seam for this regression.
- Verify disposal after failure/cancellation and separate Bank/generation calls. A new capture cannot reuse an earlier invocation's accepted bytes.
- Retain actual lookup-before-apply recovery behavior: a committed exact delta is returned without another embedding or write. Preserve partial/failed transaction rollback, native/application receipt atomicity and renewal concurrency tests.

Use the existing affected native transition delta/integrity/Source/historical-reference/proof-renewal tests, plus scoped Ruff/format and the established Native type-baseline comparison. No repeated broad Core test run is justified by this Native-only initial repair.

## Performance gate and evidence handling

The current full-apply evidence is the RED budget signal: it is pending in baseline at 60.382 seconds and completes at 94.569 seconds. It does not emit an actual HTTP `HINDSIGHT_TIMEOUT`, because the diagnostic process deliberately observes at 60 seconds and permits at most 180 seconds of apply work to expose the later stages.

After correctness gates pass, the parent must create a **fresh pre-apply clone** from the still-preserved stopped source. Do not rerun `apply` on the already committed diagnostic clone: its exact receipt would bypass work and create a false performance pass. Use the same request, synthetic-vector implementation, pool settings, instrumentation and finite bounds. Record all source hashes with the new measurement.

Require complete apply to finish before the unchanged 60-second observation point, with a meaningful reduction in both baseline times and repeated body I/O. Report actual elapsed time and headroom. Do not assert a margin in advance or treat a narrowly passing synthetic fixture as proof of actual embedding acceptance. If this bounded initial patch still exceeds 60 seconds, report its measured residual and request the next narrow scope; do not enlarge timeouts or silently extend caching across transactions.

For deterministic fixtures, compare complete typed receipts and final logical state under controlled clock/IDs. For the corpus probe, preserve the exact request/operation/manifest identity, baseline equality before dispatch, mapping/artifact coverage, body reuse and original-source evidence; separately report nondeterministic new executor/receipt timestamps rather than claiming raw hash equality across different runs.

The later 12.409-second native write and 12.623-second application write in the current clone are diagnostic measurements. Synthetic identical vectors affect semantic links; their times do not establish real-model write cost. The decisive pre-write 60-second overrun is not subject to that limitation.

## Real continuation boundary

Parent review, scoped implementation, independent check and a new affected performance measurement precede any real recovery. The real transition remains `6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53`; retain operation/hash identity, ordinary recovery semantics, cumulative model count 301 and all original maintenance history. Do not invoke admission renewal again or promote the fixture's receipt to real acceptance. No Git, dependency, task-lifecycle or manual-acceptance changes are part of this proposal.
