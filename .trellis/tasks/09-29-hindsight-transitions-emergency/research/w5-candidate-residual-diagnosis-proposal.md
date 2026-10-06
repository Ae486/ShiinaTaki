# W5 residual candidate latency after bounded baseline body reads

Status: read-only diagnosis and next-step proposal. The first repair's production source, report and immutable manifest remain frozen. No second repair is implemented. No source/old-clone database was opened or started by this agent.

## Conclusion

The first repair is effective but insufficient: actual synthetic-vector apply fell from **94.569s to 73.558s**. Baseline captures fell by **24.704s**, while later work and ordinary per-query timings increased enough that whole-apply savings were **21.011s**. The unchanged 60-second budget is still missed by **13.558s**, before allowing any real embedding cost or runtime variance.

Two concrete residual opportunities are visible: **68 same-scope derived-link DELETEs cost 10.127s**, and **ordinary artifact validation still performs independent predecessor/final reads**. Neither should be promoted to a guaranteed complete repair. Even eliminating the entire measured DELETE duration would leave approximately 63.431s; it cannot pass the gate alone. Blindly extending caches or tuning toward 59.x seconds is not a release plan.

Recommend one new parent-only diagnostic clone with stage-specific SQL and codec/process CPU attribution before approving the next production scope. The prepared wrapper changes instrumentation only, keeps the exact first-apply semantics and original finite bounds, and is described below. It must not reuse either already committed clone.

## Immutable evidence

| Evidence | Location / SHA256 |
| --- | --- |
| Before repair result | `.trellis/.runtime/w5-candidate-native-clone-22efe32ae26c4938b6bf3edfd36c8278/result.json`; `45aa7df021304e1fe8891a2087357d48c2ab8d2e2f0876d056cfe70a2da5645d` |
| After repair result | `.trellis/.runtime/w5-candidate-native-clone-a39825bfe71f4e758dfb6275690ea0e5/result.json`; `def8bfd1355b7fc851c3c0b19fde2c36a68842a036a82852300cd1d234573d6f` |
| Frozen repair source manifest | `research/w5-candidate-baseline-source-manifest.json`; `766ff65824c15aaf081be13c4becfc8ffe83d960e3dd7b5e0e15e2b326a12a5b` |
| Unchanged parent clone runner | `research/w5-reentry-candidate-native-clone.py`; `a58da783153ab5e0052310584877b410e0303f473543ea3147eb6e203867b03e` |

The new clone completed one delta, exact lookup matched, and it returned 1559 mappings / 1558 artifacts. Its result reports source/input/Core/original/history preservation, zero model calls and stopped state. At **60.394s** it was awaiting a body descriptor inside `full-apply/write_transition_application_delta/application-predecessors`. That is a real shift from the preceding clone's second-baseline overrun, not an overall budget pass.

## Stage comparison

Values are wall seconds. Nested predecessor time is included in application-writer time and must not be added again.

| Stage | Before | After | Difference |
| --- | ---: | ---: | ---: |
| Full apply | 94.569 | 73.558 | -21.011 |
| Baseline 1 | 30.564 | 18.234 | -12.331 |
| Baseline 2 | 30.336 | 17.962 | -12.374 |
| Both baselines | 60.900 | 36.196 | -24.704 |
| Both preflights | 2.724 | 2.851 | +0.126 |
| First predecessor pass | 4.821 | 5.313 | +0.493 |
| Native writer | 12.409 | 12.795 | +0.386 |
| Application writer, inclusive | 12.623 | 15.490 | +2.868 |
| Second predecessor pass, nested above | 5.003 | 5.382 | +0.378 |
| Application writer excluding its predecessor pass | 7.619 | 10.108 | +2.489 |

Synthetic preparation remained about 2ms. The two actual apply transactions took 25.089s and 48.035s in the new clone. The larger application-writer residual is not yet attributable to one function: no separate timing currently covers body construction, final artifact validation, event publication and receipt assembly. The data does not support describing the entire residual as SQL or CPU.

## SQL evidence and attribution limits

The current SQL aggregates span claim, apply, lookup and preservation probes. They do not retain completed calls' stage membership, and asynchronous renewals can overlap the main operation. `await conn.*` duration includes driver/server/wait work; it is not PostgreSQL CPU. Subtracting global SQL duration from apply time is therefore not a CPU measurement.

| SQL family | Calls before → after | Awaited seconds before → after |
| --- | ---: | ---: |
| Ordinary body descriptor | 21758 → 5982 | 15.714 → 5.419 |
| Ordinary ordered body parts | 21758 → 5982 | 14.658 → 5.155 |
| New bounded metadata + size + parts batches | 0 → 174 (58 of each) | 0 → 0.534 |
| Derived-link deletion per changed existing unit | 68 → 68 | 10.028 → 10.127 |
| Native head lookup | 3522 → 3522 | 2.507 → 3.056 |
| Live memory payload lookup | 2280 → 2280 | 2.115 → 2.522 |
| Memory entity-name lookup | 2040 → 2040 | 1.656 → 1.995 |
| Document logical payload lookup | 1124 → 1124 | 0.808 → 0.929 |
| Original document-text evidence lookup | 1124 → 1124 | 0.789 → 0.905 |
| Complete-step preservation probes, outside apply | 2 → 2 | 3.453 → 3.733 |
| All instrumented SQL, including external probes | 55868 → 24483 | 56.006 → 39.098 |

The optimization eliminated 15776 calls from each ordinary body query family (31552 combined), while adding 174 bounded batch calls. Query latency also increased across unchanged read families, so a call-count reduction is clearer evidence than attributing every millisecond change to the patch. The two complete-step queries belong to before/after history audit in the helper and cannot be optimized to improve the actual request.

## Precisely remaining paths

1. `transition_delta_rows.py:29-98`, `preserve_transition_units`: every existing/restored target updates its row, deletes the temporary row and entity postings, then independently deletes temporal/semantic incident edges from `memory_links`. The statement at line 88 runs 68 times. `current_state_rows.py:205-285` invokes this whole function before rebuilding postings, applying final lifecycle and creating temporal/semantic links. `memories/pg/writes.py:509` restores causal links and queues graph maintenance; the proposed derived-link filter must preserve those causal edges.
2. `transition_delta_application.py:48-64`, `_predecessors`: loads all latest artifacts, verifies exact complete descriptor coverage, then reads every old body. `TransitionDeltaService.apply` invokes it in the first transaction; the application writer invokes it again at line 235 after the native write in the second transaction. Both fresh views are necessary. Their actual sum is 10.695s.
3. `transition_delta_application.py:328-347`: after all application writes, reads the current Bank body and every non-tombstoned current artifact again to validate Block scope and provider-derived provenance. This is a required **post-write** view; it cannot share cached rows/results from either baseline or predecessor pass. Its standalone duration is absent from the current result.
4. `application_state/snapshot.py:92-178`: the baseline's `_bundle_records` still calls `_load_snapshot_source`, then `_validate_head` for every current native head. `application_state/commits.py:56-82`, `current_native`, rereads the current head and actual logical payload before checking its hash. Document heads additionally reload source evidence. These validators remain fully active, as intended; native lookup call counts were unchanged by the byte-reader repair.
5. `transition_snapshot.py:84` already loaded a full logical source before `_bundle_records` loads another at `snapshot.py:101`. Repeated complete-source loading is a possible separate invocation-local opportunity, but its CPU/SQL share has not been measured. Replacing authoritative per-head validation with a stale descriptor would be incorrect.

Paths above are relative to `H:/hindsight/hindsight-api-slim/hindsight_api/engine/`. This is a source-grounded call map, not a measured per-function CPU profile.

## Parent-only measurement ready for review

New file: `research/w5-candidate-residual-profile.py`. It loads the hash-pinned original runner only when explicitly given `--run-reviewed-clone`. Default invocation prints its description and performs no clone import or startup. Production and the 26-entry repair manifest are verified before/after the parent-run probe.

After review, the parent may run from `H:/TakiAgent`:

```text
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-candidate-residual-profile.py --run-reviewed-clone
```

The runner still creates one fresh UUID clone from the stopped pre-apply source, performs normal claim and exactly one original `apply`, observes at 60 seconds, enforces the existing 180-second diagnostic limit, checks exact lookup/preservation and stops the owned server. No optimizer, proposed batching, query-plan change, EXPLAIN ANALYZE, model call or alternate delta is injected.

Additional aggregate output is written into that new clone's `result.json` under `residualProfile`:

- SQL calls and awaited time by actual stage/substage, separating both baseline ordinals, native/application writers and outside-apply audit.
- Full-apply process CPU time; it includes all process activity during apply, including renewals and instrumentation, and is not a per-thread or server CPU metric.
- Synchronous codec call counts, inclusive/self CPU and wall time for decode, encode, semantic/native/current-state digests, schema validation, model parsing and snapshot-record construction. Self time excludes only nested instrumented functions. Installed aliases are replaced by exact function identity, preserving all arguments and behavior.
- Aggregate `_load_snapshot_source`, `_bundle_records`, `_validate_head`, `current_native`, `load_native_source_evidence` and `_body_and_command` wall time, plus body-read counts by closed schema/stage. The application writer's own body-read counts separate its direct final pass from the nested predecessor/command boundaries.
- Per-baseline reader/full-validation call counts and peak verified bytes/entry count, without retaining the reader. Reader calls minus full-byte-validation calls characterize actual hits; these counts are not extrapolated from aggregate SQL.

No bound arguments, body IDs, body bytes, result rows, credentials or raw exceptions enter the added output. Statistics keys are source-authored SQL and closed function/stage/schema labels. This wrapper adds overhead: use it to select and bound the next change, not as the final acceptance latency run.

Executed local checks of the new wrapper: scoped Ruff passed; description-only launch passed without importing the clone runner; offline synthetic checks verified nested sync return/accounting, async arguments/results, cancellation propagation and stage restoration. All frozen repair manifest entries were rehashed successfully. The parent-only branch has **not** run, and no actual new clone/profile result is claimed.

## Shortlist of next narrow production changes

These are proposals for parent approval after attribution. They are not an invitation to implement all candidates at once.

### A. Batch the exact derived-link deletion set

- Candidate production ownership: only `transfer/transition_delta_rows.py::preserve_transition_units`, plus targeted Native tests. Keep the row update, restore, temporary cleanup, entity handling and revision logic intact.
- Collect exactly the existing/restored targets that currently execute the filtered DELETE. After those per-row operations, delete the union of temporal/semantic incident edges in bounded target-ID batches, still inside the same transaction and before `_write_units` recreates links. For this corpus, 68 targets fit one existing-style 128-ID batch.
- Preserve `bank_id`, both endpoint predicates and the exact link types. Do not delete causal/other link types, unrelated-bank edges, unaffected-target edges or old historical records. A link between two affected targets is deleted once with the same final set semantics. No separate connection/commit is allowed.
- Tests: exact edge-set comparison against the original per-target operation, crossing-target edges, unaffected/foreign Banks, causal preservation, live/new/restored targets, empty set, >128 targets and failure rollback; then actual delta/lifecycle/renewal regression.
- Measured opportunity: 10.127s inclusive SQL cost in the current run. Actual batched execution still has nonzero cost and must be measured; no index/plan cause or 10-second saving is asserted. This candidate alone cannot pass 60s.

### B. Fresh bounded readers at each read-only artifact-validation boundary

- Candidate production ownership: `transfer/transition_delta_application.py`, the existing body-reader module for a correctly named shared private reader/contract, and `transition_snapshot.py` only if an internal reader-name import changes. Exact file list and naming must be fixed in the approved implementation brief; ordinary D77 remains unchanged.
- Create/dispose an independent reader **inside each** `_predecessors` invocation. Retain complete latest-artifact coverage, original descriptor comparison and every schema/closure check. Return the same ordinary predecessor models; no reader or acceptance capability escapes.
- Create another new reader only for the final Bank/artifact validation after all application writes. It sees the transaction's final written state. Dispose it before publication/return. Never pass a baseline/predecessor reader through native writes, application body construction or artifact writes; no cache spans these views or transactions.
- Reuse the proven raw batching and immutable-byte rules instead of adding decoded-object caching. Bodies larger than budget still receive complete ordinary validation. The two admission baselines remain independent and unchanged.
- Tests: stage-local read counts/equivalence; intervening corruption and newly written/rebound bodies observed by the final pass; returned-model mutation; Source history closure; cleanup on cancellation/failure; receipt/write rollback. A regression must prove the final pass does not reuse predecessor bytes after a write.
- Measured opportunity: two predecessors total 10.695s, plus an unmeasured final pass. Only part is transport/repeat work; schema/hash computation remains. Global remaining body SQL is 10.574s and includes other stages, so it is an upper allocation bound, not a promised saving for this change.

### C. Complete logical-source/native-head reads within one baseline (contingent)

- Measure the two `_load_snapshot_source` calls and per-head `current_native` CPU/SQL first. Do not pre-approve a general codec rewrite or cached native verdict.
- If material, design a separate complete, same-transaction native read strategy that retains each original hash/namespace/current-head/source-evidence check and creates a new view for the second `_admit`. Any reuse must be immutable and invocation-local; ordinary D77/default capture behavior stays unchanged.
- No production file list is approved for this option yet. The profiling result should decide whether it is needed; changing this more sensitive validation boundary without attribution would repeat the uncertainty that the measurement is intended to remove.

## Decision and acceptance boundary

The immediate requested parent action is review/run the bounded diagnostic wrapper, then approve the smallest measured combination with realistic headroom for real embeddings and variance. Neither A's full 10.127s nor B's inclusive 10.695s can simply be subtracted as a guaranteed win. Do not claim completion from a narrowly sub-60 synthetic result.

After an approved repair, obtain exact-state/receipt/body/history tests and a fresh **uninstrumented** run using the original runner for comparable performance. Then independent review precedes any real recovery. Production timers, lease/TTL, both full admission checks, original transition/delta identities and model counter remain unchanged. This report neither rewrites the first repair's PASS correctness evidence nor upgrades its failed performance gate.
