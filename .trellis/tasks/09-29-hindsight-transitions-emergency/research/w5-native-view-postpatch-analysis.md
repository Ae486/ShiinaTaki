# W5 native-view postpatch: independent residual analysis

Date: 2026-10-05. Reviewer: `w5_postpatch_review`.

## Conclusion

**The current actual-model Native gate fails, and a concrete body-prefetch scheduling regression is reproduced.**
The native-view patch removed its intended duplicate native reads, but bypassed the reader's head-body registration.
That omission replaces batches with **3124 additional metadata reads and 3124 additional part reads across two
baselines**. A new offline reproduction using the actual reader and locked-view entry points reproduces those exact
count deltas. This is actionable independently of machine-load variation.

The smallest repair is a shared protected head-row decoding/registration seam in three Native files. Parent has
approved that scope separately in `w5-head-prefetch-repair-brief.md`. This analysis does not implement it, replace the
previous independent semantic check, release HTTP/working-pair recovery, or declare W5 complete.

## Evidence and custody audit

Actual-model job: `.trellis/.runtime/w5-actual-embedding-2e081d2289694da987c48eb7455690a2`.
Owned clone: `.trellis/.runtime/w5-candidate-native-clone-0af8fc86c932456e988477b8fda2c2f6`.

- Main `result.json` SHA256: `d8772db72496b14a7bbf2cb238e253898404988e8be986d7a115459c81e5833a`.
- Embedded child report equals the persisted clone `result.json`, whose hash equals the parent's recorded
  `f8985f8be18eb14ee41989a9c765de7bee3d89bf14dcc32a0cb337f209889842`.
- All four persisted parent/worker before/after inventories are identical: SHA256
  `e23b13ae58b4a961e91061b8738513d3625d013a4148d191df7a10bbd53b265b`. Each reports the complete checked source manifest
  `e0ec8c9e8b10706411e1f1bc2c43d1d0022a2b010471ef3bc976e4bea8331f4c`, 382 entries and seven inherited manifests.
  The two child manifest fields match. Parent already reverified all source entries; this audit compared persisted
  report identities rather than repeating its source/database inventory work.
- Held and script PID are both 30268; parent PID is 14116. Held identity equals `child.json`, including creation ticks
  134356735711534765 and base executable `G:/AppDataMove/PythonPrograms/Python311/python.exe`. Logical executable/prefix
  remain `H:/hindsight/.venv`; saved package origins are in that venv. The persisted launch/self/embedding objects equal
  their copies in the final result. This is a saved-identity audit, not a new live-process observation.
- One actual CPU batch encoded 68 inputs with `BAAI/bge-small-en-v1.5`, revision
  `5c38ec7c405ec4b44b94cc5a9bb96e735b38267a`, dimension 384. Synthetic/query encoder counts are zero.
- Apply completed once, exact lookup matches, one delta row exists, 1559 mappings and 1558 artifacts are reported.
  Request hash remains `946b0a8228df74206a91ea4154e34d6592082e5afae2c069a71846e8e301b8d7`.
  Historical maintenance and source/input/Core/original/source-code preservation report true. Saved cleanup reports
  stopped/port released. Parent independently checked the live cleanup and working pair in
  `w5-native-view-postpatch-execution-2026-10-05.md`; no database/model was started by this reviewer.
- `diagnosticSucceeded=true` is consistent with exit 0 and complete evidence. `nativeApplyBudgetPassed=false` and
  `httpOrAuthorityRecoveryProven=false` are equally consistent. At 60.448 seconds the observation showed the final
  delta receipt INSERT pending; full apply completed at **60.544 seconds**, exceeding the unchanged budget by 0.544s.

## Comparison against the prior real-model job

Reference: `.trellis/.runtime/w5-actual-embedding-1dc8a7eda5124dcc948b1b95032ae484`.
Both jobs use the real CPU model, the same sealed request, and the existing V2/telemetry composition.

| Inclusive stage | Before native-view, seconds | Current, seconds |
| --- | ---: | ---: |
| Full apply | 58.174 | 60.544 |
| Baseline 1 | 16.871 | 16.609 |
| Baseline 2 | 16.671 | 16.508 |
| Predecessors before embedding | 2.764 | 3.115 |
| Prepare current-state rows | 2.663 | 3.236 |
| Actual document encoding, nested inside prepare | 2.654 | 3.227 |
| Native delta write | 6.502 | 7.398 |
| Application delta write | 8.827 | 9.829 |
| Second predecessors, nested inside application write | 3.067 | 3.356 |
| Exact lookup, outside apply | 0.709 | 0.905 |

Do not add nested rows. The two baselines improve by only 0.426s combined; increased embedding/write/other costs
leave full apply 2.370s slower. Current initialization is separately 19.245s versus 16.537s and is outside full apply.

Whole captured SQL counts below include pre/post diagnostic bookkeeping and lookup; they are not all apply SQL.

| SQL family | Before calls | Current calls | Interpretation |
| --- | ---: | ---: | --- |
| Native source bulk family, e.g. document enumeration | 8 | 6 | Two duplicate source loads removed |
| Head-only full enumeration | 10 | 6 | Two duplicate-source reads and two bundler reads removed |
| SQL-keyed full head enumeration | 0 | 2 | One new exact keyed view per baseline |
| Single current head | 3522 | 440 | 3082 safe head point reads removed; fallback remains |
| Single current document payload | 1124 | 0 | Safe native document payload reads removed |
| Single current live memory | 2280 | 328 | Safe native unit reads removed; fallback/other stages remain |
| Single live-unit entity list | 2040 | 88 | Corresponding derived entity reads removed |
| Current document original text/retain parameters | 1124 | 1124 | Required fresh Source evidence remains |
| Ordinary immutable-body metadata | 1393 | 4517 | **3124 extra ordinary reads** |
| Ordinary immutable-body parts | 1393 | 4517 | **3124 extra ordinary reads** |
| Each of metadata/size/part batch families | 96 | 72 | **24 fewer batches per family** |

Total captured SQL calls decrease 15345 -> 13388, but captured awaited SQL increases 22.233s -> 23.122s.
That total includes preservation work outside apply, including about 3.304s of complete-maintenance-step reads;
it must not be subtracted from apply to infer Python CPU. The intended source/head/current-native work really
was removed. The failure is not evidence that the opt-in source path was unused.

## Confirmed regression and its exact mechanism

Code paths are relative to `H:/hindsight/hindsight-api-slim/`:

1. `application_state/snapshot.py:47` reads actual SQL keys and heads in `_locked_native_view` and parses heads
   directly at line 57. `_bundle_records:147-149` uses `view.heads`, bypassing `store.heads()`, then lists artifacts.
2. `transition_baseline_reads.py:90-95` overrides `heads()` to register every non-null head `body_ref.body_id` in
   `_pending`. The locked-view branch therefore never registers its native head bodies.
3. `artifacts():97` still registers all artifact bodies. The first native body read starts a batch with itself plus
   127 future artifacts. Those raw artifact rows stay staged while the native-head loop continues.
4. `_load_body_metadata:182-194` deliberately will not discard a nonempty staged batch to prefetch an unrelated
   newly encountered body. That protects Source dependency reads and should remain intact. In the broken traversal,
   however, nearly every later native head and native Source becomes an ordinary metadata/part pair.

The old detailed profile has 1559 native heads, 562 native Source bodies and 2102 artifact bodies. The new synthetic
transport reproduction preserves their traversal order and counts, with small independently hashed synthetic bodies:

| One baseline's actual reader scheduling | Ordinary `reader.heads()` | Current `_locked_native_view(reader, source)` |
| --- | ---: | ---: |
| Pending head bodies immediately after enumeration | 1559 | 0 |
| Metadata batches / size batches / part batches | 29 / 29 / 29 | 17 / 17 / 17 |
| Ordinary metadata / part reads | 558 / 558 | 2120 / 2120 |
| Fully byte-verified distinct bodies | 4223 | 4223 |
| Second traversal extra SQL | 0 | 0 |

Thus `(2120 - 558) * 2 = 3124` extra pairs and `(29 - 17) * 2 = 24` fewer batches, matching all six actual SQL-count
differences exactly. No `_pending` write or production monkeypatch is used by the reproduction; it only observes
private counters. Both actual reader instances are disposed. Real byte descriptor/sealed/part/whole/semantic checks
execute. Synthetic JSON is intentionally not a complete domain artifact schema: this proves transport scheduling,
not complete baseline validity or database SQL equivalence. A repair still needs the production-path tests below.

Existing semantic tests need not fail: `test_transition_baseline_reads.py:38-77` counts complete byte validations and
separate baseline lifetimes, which remain correct. `test_transition_native_view.py:123` verifies point-read removal
through a mocked store; that store does not implement the real reader's registration side effect. The previous PASS
therefore remains valid for its recorded semantic gate while missing this performance integration case.

## Ranked residual hypotheses and falsifiable predictions

1. **Confirmed: head registration was bypassed.** Restoring the shared parse/register seam must restore head-first
   batch scheduling and eliminate the exact 3124 excess pairs without restoring native payload point reads. Failure
   to recover those counts falsifies the proposed repair's effect at the actual integration seam.
2. **Likely material residual: repeated codec/schema/hash work.** The separate model-free job
   `23075927a75543e4bfdb326a46bbbaaf` measured 14.428s / 12.828s process CPU in the light baseline and
   14.770s / 13.313s in its detailed pass. Four final current-state hashes took 1.230s inclusive; second-pass decode
   0.642s, body schema validation 0.464s and descriptor `json_bytes` 0.566s were also recorded. Native `current_native`
   was 2.266s including 1.281s SQL, and the duplicate source load was 0.390s. These identify old work owners, not current
   exclusive costs. If the next repaired baseline is still slow, unchanged body-validation counts plus high exact
   baseline worker/thread CPU would support this hypothesis. Low CPU with long waits would weaken it. No codec change
   or validator removal is warranted before the known scheduling defect is repaired.
3. **Observed variation, unproven cause: process/machine load and scheduling.** Mean ordinary metadata/part waits
   rose from 0.730/0.669ms to 0.906/0.878ms; current document Source reads rose from 0.692 to 0.848ms and model encoding
   rose 21.6%. Sampled `apply-and-lookup` spans show worker CPU 81.297 -> 83.906s across 63.968 -> 66.109s of sampled wall
   time, and system busy fraction 13.11% -> 19.51%. Process CPU includes model threads and can exceed wall time; system
   busy is across the observed machine, not a saturated-core proof. Working set is similar (1161 vs 1157MiB), sampled
   page faults do not increase (636886 -> 626456), and process read traffic is 2.66 -> 2.54MiB. These counters do not
   establish physical paging, a particular competing process, model-thread contention or a PostgreSQL bottleneck.
   The actual-model telemetry explicitly has no backend attribution. A future bounded run with recovered structural
   counts but similarly slower unrelated stages supports variation; no machine setting change follows from this data.
4. **Known remaining SQL cost: the one derived-link DELETE.** It remains one call, 4.079 -> 4.391s. It can matter after
   the scheduling repair, but current evidence does not distinguish plan cost, row deletion/index maintenance, triggers,
   I/O or waiting. Only a separately scoped plan/backend measurement could justify another change. Rewriting it now
   would combine independent variables and exceed the narrow repair scope.

At the two runs' measured mean SQL rates, replacing 3124 metadata/part pairs with 24 batches of each of the three
families corresponds to **4.173s (old rates) or 5.340s (current rates)** of conditional awaited-SQL savings. The formula
is `3124 * (metadata_mean + parts_mean) - 24 * (batch_metadata_mean + size_mean + batch_parts_mean)`.
Those are allocation estimates, not measured gains, confidence bounds or a forecast: batch payloads differ, overhead
is included, and rates/load may change. Even a nominal current-time subtraction leaves about 55.2s, not abundant
headroom. The next real measurement decides Native margin; HTTP remains a later separate gate.

## Smallest repair and meaningful test scope

Three existing production files, no API/schema/dependency/timer/model configuration change:

| File under `hindsight_api/engine/` | Allowed change |
| --- | --- |
| `application_state/store.py` | Extract the current head-list parsing into protected synchronous `_heads_from_rows(rows)`; ordinary `heads()` returns that result. Base behavior remains the same parser/order, with no new query. |
| `transition_baseline_reads.py` | Move existing head-body registration from the async `heads()` override to a `_heads_from_rows` override. Call the base decoder once, queue its non-null refs in original order, return the same heads. Keep all batch/cache/fallback/disposal limits and checks. |
| `application_state/snapshot.py` | Decode already fetched keyed rows through `store._heads_from_rows(rows)` instead of a parallel list comprehension. Keep the actual SQL-key/envelope comparison, duplicate-key handling, invalidated-unit fallback, membership checks, canonical hashes and fresh Source/body checks unchanged. |

Parsing occurs before registration; malformed rows still raise. Queueing an ambiguous/duplicate key is transport
bookkeeping only, not acceptance. Exact indexed-key validation still uses the original raw rows and `zip` pairing.
Do not call `heads()` again from the keyed path, expose `_pending`, grant cached validation capability, remove the
protective nonempty-batch fallback, or share models/bytes across readers or write boundaries.

Required focused tests:

- An offline test at actual `_bundle_records` + `_TransitionValidationReader` verifies the shared seam is exercised,
  one keyed head SELECT occurs, native body refs precede artifact refs, and point native reads remain eliminated.
  Exercise enough heads/artifacts to cross a batch boundary; mocked body-only validators are insufficient alone.
- An owned-PG baseline differential with enough mixed native/document/Source/artifact bodies to fill batches checks
  exact baseline/component/auxiliary equality and an explicit count bound for ordinary body SQL. The ordinary
  non-reuse snapshot is an equality reference, not the batching performance target.
- Preserve and run the affected wrong indexed-key/envelope, duplicate/invalidated fallback, ordinary snapshot,
  Source corruption, second-admission corruption and independent-reader disposal/rollback cases. Test failures in
  head parsing leave no newly queued partially parsed head set; each baseline must independently register its heads.
- Scoped Ruff/format/ty on only the changed sources and tests, plus the small new scheduling/helper tests. Do not
  repeat all 35 Native/12 helper checks automatically or widen to a whole-package gate without a new reason.

For the parent measurement entry, create a NEW additive helper/verifier/manifest composition. Pin the currently
checked 382-entry manifest itself at its SHA above and preserve every old helper/report/manifest byte-for-byte.
Only the explicitly approved new production/test/spec preimages may replace inherited entries. Include this new
analysis/probe/evidence and the repair/check records as additions. Reuse existing worker/V2/telemetry dispatch and
its worker handshake, offline model, clone ownership, timers, exact result lookup and cleanup. Both parent and actual
worker must verify the new same inventory before/after; default entry does no work. Do not repin an old sealed helper
in place or suppress its expected rejection of changed source. Independent correctness check precedes the one next
parent actual-model run. Inspect recovered body batch/point counts before interpreting its elapsed time.

## Files created and verification

- `w5-native-view-postpatch-scheduling-probe.py`: final SHA256
  `77e52af3582ef59cb22d211f8db5f1ccade652588ed3a986c00b4a88863d1795`.
- `w5-native-view-postpatch-analysis-evidence.json`: exact commands, stdout/stderr/exit codes, saved-identity audits,
  extracted stage/SQL/telemetry metrics and conditional arithmetic. SHA256
  `4df7bc16d6e15aa08d08ee140719630046121cd6483d8dded6e4ba01c739e6d7`.
- This report. No prior report/helper/manifest, production source, task pointer or parent status file was edited.

The final offline probe, its scoped Ruff, Ruff format check and scoped `ty` all pass (exit 0). The probe also asserts
that neither `torch` nor `sentence_transformers` was imported. The exact commands and outputs are in the evidence
JSON. Existing Native/helper gates were read, not rerun; actual-model/HTTP/DB gates were not executed by this reviewer.

## Findings (fixed)

None in production: this assignment authorizes new analysis artifacts only. The confirmed defect and regression
seam are ready for the separately approved implementer; the diagnostic script itself passes its local checks.

## Findings (not fixed)

- The shared head parsing/registration regression above awaits the bounded three-file implementation and check.
- Actual-model Native margin, complete HTTP timing, same-transition working-pair recovery and complete W5 acceptance
  remain unproven. The current failed timing and all earlier inventories remain immutable evidence.
