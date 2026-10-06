# W5 residual profile attribution and concrete A+B scope

Status: read-only supplement, awaiting parent approval of the exact implementation scope below. No production file or earlier evidence has been edited. This supplements, rather than replaces, `w5-candidate-residual-diagnosis-proposal.md`.

## Recommendation

Implement **A+B** as the next narrow measured repair: batch the exact derived-link deletion set, and use fresh bounded body readers inside the two predecessor passes and the final post-write artifact-validation pass. Leave **C** (native logical-source/current-head validation changes) untouched.

The new attribution makes A and B concrete, independently testable opportunities. It also proves that increasing the current byte-cache capacity will not help this corpus. A+B still carries no promised elapsed time: retain the unchanged 60-second production deadline and inspect the new uninstrumented result with real embedding uncertainty and variance in mind. **Approximately 50 seconds or less is a diagnostic target for useful headroom, not a new product timeout or a hard acceptance contract.** A marginal synthetic-only result cannot release real recovery.

## Profile evidence and limits

Parent-owned result:

`.trellis/.runtime/w5-candidate-native-clone-c968532a988a40cdbe5a446cbca64399/result.json`

SHA256: `a90ff8aacc4fc12d4615fc55751511848b385c4d808095acf12b775169e076ce`.

The profiled run completed one original apply and exact lookup, with one delta row, all preservation/stopped flags true and zero real-model calls. It took **153.961s** versus **73.558s** without the extra profiler. Even the unchanged derived-link SQL rose from 10.127s to 20.429s. Consequently, neither a global scaling factor nor individual profiled durations should be used as a prediction for an uninstrumented repair. Counts and call ownership provide stronger attribution than those wall times.

Process CPU during full apply was **96.984s**, including all process activity and profiling overhead. Aggregate measured codec self CPU was dominated by tagged-byte construction, JSON decoding, body schema validation, current-state hashing, JSON encoding and model parsing. These are real instrumented paths, not an independently measured pre-profile CPU budget. Windows process-clock resolution and nested instrumentation also make small function-level CPU numbers approximate.

### The first reader is working as designed

Each of the two baseline invocations reported exactly:

| Counter | Each baseline |
| --- | ---: |
| `read_body` / reader `body_bytes` | 8446 |
| Full ordinary byte validations | 4223 |
| Second-pass verified-byte hits | 4223 |
| Peak verified bytes | 8,543,936 bytes, about 8.15 MiB |
| Peak entries | 4223 |

The reader's existing limits are 64 MiB / 8192 entries. Every body receives one complete byte validation per baseline; the second pass hits immutable bytes. There is no observed capacity/eviction problem to repair. The second pass intentionally still performs fresh decode/schema validation; no mutable result is cached.

### All remaining ordinary body queries are now assigned

Each count below describes both one descriptor query and one part query in this corpus. Their sum is exactly the 5982 calls per family in the prior uninstrumented run.

| Current stage | Full body reads | Proposed disposition |
| --- | ---: | --- |
| Baseline native-source dependency fallback, both invocations | 1116 | Keep current baseline behavior in this scope. |
| Source preflight, both invocations | 136 | Keep ordinary preflight behavior. |
| First predecessor pass | 1515 | Fresh scoped reader; retain all validation. |
| Second predecessor pass after native write | 1515 | Another fresh reader; never reuse the first. |
| Application body construction/commands | 140 | Keep ordinary writer behavior. |
| Direct application final-validation/publication path | 1560 | Scope the final validation only: 1559 reads including the Bank duplicate; the record-page read remains ordinary publication. |
| Total | 5982 | No inferred or missing calls. |

The two predecessors each validate 1 Bank, 1 Block, 951 Memory and 562 Source bodies. The final direct path has 2 Bank, 1 Block, 994 Memory, 562 Source and 1 publication record-page read. Thus B targets **4589 body-read occurrences / 9178 descriptor+part round trips** before batched replacement, while keeping the three complete views separate. This is not a proposal to remove 4589 validations.

Under profiling, each predecessor made 3031 SQL calls: one latest-artifact enumeration plus 1515 descriptor/part pairs. Their awaited SQL totals were 5.136s and 5.194s out of inclusive walls 11.155s and 11.287s. The instrumented final direct path included 5.980s SQL and 4.766s measured codec self CPU, but also publication/lineage work; it is not all removable. In the uninstrumented run both predecessors together took 10.695s and all remaining ordinary body SQL across every stage took 10.574s. These are context and allocation bounds, not promised B savings.

### Why leave C alone now

- The two extra `_load_snapshot_source` calls inside `_bundle_records` total only **1.640s even in the heavily profiled run**. Removing just this duplicate source load is a smaller and more semantically sensitive opportunity than A/B transport batching.
- Each baseline still runs 1559 `current_native` checks, with 4112 SQL calls totaling 7.518s / 7.382s in the profiled run. Those calls verify current head/version/tombstone and authoritative native payload/derived entities. A bulk or reused-native representation would need a separate exact validator-equivalence design; it is not a safe incidental extension of body prefetch.
- The direct second body pass performs 4223 fresh decodes and schema validations per baseline. Its measured codec self CPU is material, but skipping/merging that pass requires proving the union of all current integrity/source-reference obligations, including atypical non-document source references. No such validator elimination is included in A+B.

## Exact proposed production ownership: four existing files

All paths are relative to `H:/hindsight/hindsight-api-slim/`. No additional production path is implicitly approved.

| File | Allowed change |
| --- | --- |
| `hindsight_api/engine/transfer/transition_delta_rows.py` | Only `preserve_transition_units`: collect the existing/restored targets currently receiving the per-target derived-link DELETE; issue that exact union in bounded ID batches before returning. Preserve all other per-row/native-write behavior. |
| `hindsight_api/engine/transition_baseline_reads.py` | Rename the private `_TransitionBaselineReader` class to `_TransitionValidationReader` and update its documentation for a single locked, read-only validation pass. Reuse the existing byte/descriptor/batch/cycle/disposal implementation and limits without new caching behavior. Keep the module path to minimize churn; add no compatibility alias. |
| `hindsight_api/engine/transition_snapshot.py` | Update the private reader import/constructor to the new class name only. Both complete baseline invocations, their existing internal opt-in, loops and disposal remain unchanged. |
| `hindsight_api/engine/transfer/transition_delta_application.py` | Construct/dispose a new validation reader wholly inside each `_predecessors` call and another only around the final Bank/current-artifact validation. Keep the ordinary writer store for `_body_and_command`, writes and `publish_event`. |

`ApplicationStateStore` and its raw loaders need no further change. `transition_delta.py`, ordinary D77 code, preflight, current-state row creation, native payload loaders, protocol, migrations, indexes, dependencies, production timers and Core are outside this scope.

The previously frozen profiler imports the old private class and pins the old source manifest. Do not rewrite it to match the new code. It remains evidence for the measured snapshot. The original uninstrumented clone runner has no private-reader dependency and remains the performance comparison entrypoint.

## A: exact set and transaction contract

1. Keep each target's existing live/restore decision, row update, temporary-row deletion, entity-posting deletion and revision semantics. Collect only targets for which the old `if exists` branch executed the derived-link DELETE, including successful restored targets. Newly assigned targets do not enter that set.
2. After per-row preservation, delete in bounded batches of at most 128 target UUIDs using the same Bank and link-type filters and the union of both endpoints:

   `bank_id = current Bank AND link_type IN ('temporal', 'semantic') AND (from_unit_id IN batch OR to_unit_id IN batch)`.

3. Finish all deletion batches before returning to `_write_units`, which then restores the final metadata/lifecycle and builds new retrieval links. Use the existing connection and transaction; no separate commit or asynchronous work.
4. Preserve causal/other links, unrelated edges, foreign Banks, old history and queued relink-victim ownership. A crossing edge between affected targets is deleted with the same final set even if batches encounter it twice. Restore rematerializes causal links; the exact type filter must keep them.
5. Any restore/update/delete/validator failure still rolls back the whole native/application/receipt transaction. Moving a deletion later within that transaction must not expose intermediate state to another owner.

There are 68 eligible targets in the measured corpus. One batch should replace 68 scans/commands; the amount of actual SQL work saved is established only by the next uninstrumented run. No cause such as a missing index is inferred from elapsed time alone.

## B: five independent reader lifetimes in complete apply

The existing two baseline readers remain. The next repair adds exactly three distinct read-only lifetimes:

1. First `_predecessors`: create from the ordinary store's exact connection/table/Bank/namespace, load and validate complete latest artifacts and bodies, return the same ordinary predecessor models, and close in `finally` before the first transaction ends.
2. Second `_predecessors`: create anew after native writes, re-read its complete current state, close before application commands begin. No bytes, rows or result capability from baseline 2 or predecessor 1 may be reused.
3. Final Bank/artifact validation: create after all application writes, perform the existing Bank/body/scope/provenance checks against the written state, then close before `publish_event`. Preserve the existing Bank-first failure order and all original filters/loops.

The reader never services writes. The original `ApplicationStateStore` remains the writer/publication object. Body/descriptor caches do not cross any of these boundaries, even within the same SQL transaction. Every model is freshly decoded and every Source closure/history reference is checked through the existing validators. Failure and cancellation clear raw batches, verified bytes, active identities and pending IDs; no reader is returned or attached to the connection/backend.

Retain the current 128-body, 8 MiB raw batch, 1024 raw-part-row and 64 MiB / 8192-entry cache bounds and the complete ordinary fallback. The first repair's immutable-byte, exact descriptor/namespace, duplicate/corrupt-row and mutation-isolation contracts remain mandatory.

## Exact test and evidence scope

Proposed Native test ownership:

- `tests/native_results/test_transition_baseline_reads.py`: update only the renamed private import/usages; retain all existing 29 cases and independent two-baseline assertions.
- New `tests/native_results/test_transition_derived_link_batches.py`: direct owned-PG `preserve_transition_units` regression against the original exact edge-set behavior; cover crossing affected targets, untouched/foreign Banks, causal/other link types, mixed existing/new/restored targets, empty set, >128 eligible targets and failure rollback. Assert the bounded query count as performance structure in addition to exact state equality.
- New `tests/native_results/test_transition_artifact_reads.py`: actual apply assertions for the two baseline plus three new independent readers, complete body validation at each relevant pass, exact unchanged receipts/lookup, and fresh state after the write boundaries. Include a body/rebinding change after predecessor validation which the final reader must observe/refuse; no final validation may hit predecessor bytes. Cover Source closure/history, mutable return isolation, fallback and failure/cancellation disposal where the existing reader tests do not already cover the shared implementation.

Run sequential owned-PG checks with the existing `run_isolated_hindsight.py` harness, `-q --tb=short -n 0`; zero actual models. Re-run the affected delta, integrity, Source evidence/refusals, historical references, proof renewal and ordinary application body/state group only after the scoped changes. Both native/application writes and the exact receipt must roll back on a forced final-pass failure; exact committed lookup must bypass repeated effects.

Run scoped Ruff/format and an exact **new preimage** type comparison for the four approved files. Save new preimages, logs, implementation report and immutable manifest under new task-owned names; never overwrite either prior repair/profile snapshot. Update only the corresponding healthy-driver spec section if needed. No Git, task lifecycle or manual/real acceptance changes.

## Performance and release decision

After correctness checks, parent runs one new pre-apply clone with the unchanged **uninstrumented** runner. Record actual apply and stage durations, ordinary-body and batched SQL counts, DELETE count, exact receipt/lookup, complete mappings/artifacts and preservation. Approximately 50s is a useful diagnostic target, not a replacement timeout or an automatic release criterion.

Assess measured headroom against the unchanged 60s request budget, the observed runtime variation and still-unmeasured real embedding cost. If A+B leaves inadequate margin, retain the measured limitation and request a separately specified C scope; do not silently drop a validator, share a cache across views, enlarge a timer or call a synthetic near-pass real acceptance. Independent review and the parent's separately controlled real recovery remain outstanding.

The only action authorized by this supplement's preparation was read-only analysis and new evidence writing. Production remains at repair manifest `766ff65824c15aaf081be13c4becfc8ffe83d960e3dd7b5e0e15e2b326a12a5b` pending parent implementation approval.
