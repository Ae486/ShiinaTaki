# W5 locked-baseline Native view — independent check

Date: 2026-10-05. Reviewer: `w5_native_view_check`.

## Verdict

**PASS for this bounded source/fixture/helper gate, after checker repairs.** No Native production defect was
confirmed. The two production files and all three Native tests remain byte-identical to the delivered 375-entry
inventory. Scoped lint, format and type checks pass; 35 independently selected Native tests and all 12 final
offline helper tests pass. This permits the parent-owned fresh actual-model diagnostic only. Actual-model margin,
HTTP timing, real working-pair recovery and complete W5 acceptance remain separate, unperformed gates.

Verified repositories: `H:/TakiAgent`, `main`, `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`; `H:/hindsight`,
`main`, `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`. Both worktree lists were inspected. The child uses the parent's
explicit existing `09-29-hindsight-transitions-emergency` assignment; no task pointer was changed. Parent-owned
`leader-now.md` and `w5-session-recovery-2026-10-05.md` were not edited. No agent was spawned.

## Findings (fixed)

1. **File:** `w5-native-view-postpatch.py`, with regressions in `test_w5_native_view_postpatch.py`.
   **Issue:** final success used in-memory parent-before/after values without rereading both persisted reports.
   Removing or altering parent-before still produced `diagnosticSucceeded=true` (two reproduced failures).
   **Fix:** reread all four parent/actual-worker before/after reports and require exact equality to the same verified
   inventory. Missing, malformed JSON and non-object JSON reports fail closed while retaining a final result.
   A parent review additionally identified the valid-JSON/non-object telemetry case; `[1]` is now a bounded
   `InvalidReportShape` refusal rather than an exception that loses `postpatch-result.json`. Regressions cover
   missing/changed worker reports, missing/changed/malformed parent-before, changed persisted parent-after,
   invalid telemetry shape, and a successful diagnostic with independently failed Native timing.

2. **File:** `w5-native-view-postpatch.py`, same regression file.
   **Issue:** the NEW worker bypassed V2's sanitized failure record when initial inventory or worker handshake
   failed (two reproduced missing `child-failure.json` errors). Final inventory errors likewise lost their evidence.
   **Fix:** write bounded error class/stage for initial inventory and handshake failures before rethrowing. Final
   verification failure writes an explicit failed worker-after report and a child failure when none exists; an
   earlier original child failure is preserved. No child dispatch follows failed admission. Offline regressions
   exercise initial inventory, handshake, final verification and simultaneous original/final failure.

3. **File:** `w5_native_view_inventory.py`.
   **Issue/required follow-up:** checker repairs invalidate the delivered source inventory; changing that sealed
   manifest would erase the evidence being reviewed.
   **Fix:** use NEW `w5-native-view-checked-source-manifest.json`. Pin the original delivered manifest itself to
   `0e7bfeae8c3531b1782acc81f25db9f39ef34ed1b0a8df3969575a7934cf7f33`, and permit exactly three replacements
   relative to it: this verifier, the postpatch entry and its test. Every other delivered path, including all six
   original Native/spec owners, stays unchanged. The seven inherited manifest pins and six original authorized
   predecessor paths remain enforced independently. Explicit additions include this report, final quality record,
   the delivered manifest, and checker preimages; missing/extra/duplicate/undeclared entries still refuse.

The initial RED regression invocation ran two test methods: two failed subcases and two missing-file errors.
After repairs, all 12 methods pass (the original nine plus three new methods; parameter subcases are not counted
as additional unittest methods). Historical implementation reports, manifests, helpers and runtime results were
not rewritten. Checker preimages preserve all three changed task-only sources.

## Actual-path review

- Compared both Native production files against original and resumed preimages. All 13 preimage hashes/sizes
  validate, and all six shared original/resumed entries are identical. Only `capture_transition_baseline` with
  `_reuse_body_bytes=True` supplies `_locked_source`; `_admit` remains the only production opt-in caller, after
  the existing Bank/fence lock, executor and exact retired-proof checks. Its ordinary transactions contain a
  write-free validation segment; this is not a general repeatable-read cache. Both admissions create new sources.
- `_locked_native_view` reads actual SQL keys and parsed heads together. Full native/head membership, exact
  envelope identity, duplicate fallbacks, tombstones and canonical payload hashing remain enforced. Boolean/number
  equality does not substitute for hashing. Independent body version/hash/Bank validation remains unchanged.
- Invalidated memories keep `current_native`, preserving SQL collation/ANY duplicate-ID semantics. Unchanged valid
  row serializers cover all five kinds. Document original text, retain parameters, availability and full Source
  digest checks remain fresh. Source closure, schema validation and immutable-body reads are not bypassed.
- Borrowed state expires at private bundler return. Default snapshot/hydration, writers/publication, predecessor
  passes and final post-write validation retain ordinary/fresh behavior. Independently run tests confirm complete
  baseline/component hashes and auxiliary equality, Source/Block/policy bytes, Unicode/archive duplicates, separate
  admissions, corruption before the second admission, five disposed reader lifetimes, and rollback after writes.
- The existing two spec paragraphs and Native `TAKI_PATCHES.md` accurately describe this contract. No additional
  production/spec/template/API/configuration/generated-client change is required by these task-helper fixes.
- NEW entry routes the real V2 launcher to itself, restores the checked manifest after V2's historical reset, and
  adapts nested rehearsal/V3 manifest references while preserving fixed dependency pins. The Windows handshake
  still checks the held process identity, real parent PID, base executable, logical venv executable, prefixes and
  package origins before model imports. These identities were inspected and routing tested offline; this review
  did not launch an actual-model worker. Parent and actual worker verify the same checked inventory SHA/count.
- Offline model configuration, clone-only network access, Native 60-second observation, initialization 180-second
  and overall 900-second watchdogs, SQL/migration/stop limits, custody, cleanup and inherited results remain intact.
  Diagnostic completion does not imply `nativeApplyBudgetPassed`; HTTP/authority success remains explicitly false.

## Verification

| Independently executed check | Result |
| --- | --- |
| Scoped Native Ruff / format (2 production + 3 test files) | PASS; 5 already formatted |
| Native two-file `ty check`, exact command below | PASS; exit 0, no diagnostics |
| Task helper Ruff / format (3 files) | PASS; 3 already formatted |
| Task helper two-file `ty check` | PASS; exit 0, no diagnostics |
| Offline helper unittest | PASS; 12 methods, final argv/output in `w5-native-view-independent-checks/quality.json` |
| Default postpatch invocation | PASS; `executed=false`, no verification/model/PG execution |
| One fresh owned PG18.1 fixture | PASS; 35 tests, 190.51 seconds |
| Fixture cleanup | PASS; stopped, data removed, registry removed; only owned fixture used |
| Scoped Native/Taki `git diff --check` and cached diff checks | PASS; existing Native Markdown LF-to-CRLF warning only |
| Delivered source audit before repairs | PASS; all 375 entries checked with verifier and separate hashlib/size loop |
| Original/resumed preimages | PASS; 13 entries, six shared preimages equal |

Fixture: `.trellis/.runtime/g1-validation/taki-hindsight-g1-d27f8eb0f4d7/`; `pytest.log` and `ownership.json` remain.
This review selected 19 pure native-view cases, five actual locked-PG differential/Source cases, eight baseline
admission/hash/corruption/disposal cases, two artifact lifetime/rollback cases and one ordinary snapshot/replay case.
The implementer's historical 89 distinct cases were inspected, not reclassified as new executions: the five retained
logs show RED 7 failures; 73 pass; 24 pass/1 assertion failure; 12 pass; 6 pass. The retain-parameter assertion correction
is valid: logical payload hashing refuses at `native_version_conflict/412` before the independent Source check;
original text/availability still refuse `capture_gap/503`. No old broad suite was repeated.

Exact PG command from `H:/TakiAgent`:

```powershell
& H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- tests/native_results/test_transition_native_view.py tests/native_results/test_transition_native_view_pg.py tests/native_results/test_transition_baseline_reads.py::test_delta_reads_each_verified_body_once_in_each_independent_baseline tests/native_results/test_transition_baseline_reads.py::test_ordinary_and_optimized_baseline_have_identical_complete_hashes tests/native_results/test_transition_baseline_reads.py::test_second_admit_rereads_corruption_and_leaves_no_delta_commit tests/native_results/test_transition_baseline_reads.py::test_baseline_disposes_reader_on_every_exit tests/native_results/test_transition_artifact_reads.py::test_actual_apply_uses_five_separately_disposed_validation_readers tests/native_results/test_transition_artifact_reads.py::test_final_reader_detects_body_corrupted_after_predecessors_and_rolls_back_all_writes tests/native_results/test_application_state.py::test_snapshot_plus_complete_event_replay_equals_later_snapshot -q --tb=short -n 0
```

Native static commands from `H:/hindsight/hindsight-api-slim`:

```powershell
& H:/hindsight/.venv/Scripts/ruff.exe check hindsight_api/engine/transition_snapshot.py hindsight_api/engine/application_state/snapshot.py tests/native_results/test_transition_native_view.py tests/native_results/test_transition_native_view_pg.py tests/native_results/test_transition_baseline_reads.py
& H:/hindsight/.venv/Scripts/ruff.exe format --check hindsight_api/engine/transition_snapshot.py hindsight_api/engine/application_state/snapshot.py tests/native_results/test_transition_native_view.py tests/native_results/test_transition_native_view_pg.py tests/native_results/test_transition_baseline_reads.py
& H:/hindsight/.venv/Scripts/ty.exe check hindsight_api/engine/transition_snapshot.py hindsight_api/engine/application_state/snapshot.py --output-format concise
```

Task-helper commands from the research directory:

```powershell
& H:/hindsight/.venv/Scripts/ruff.exe check w5_native_view_inventory.py w5-native-view-postpatch.py test_w5_native_view_postpatch.py
& H:/hindsight/.venv/Scripts/ruff.exe format --check w5_native_view_inventory.py w5-native-view-postpatch.py test_w5_native_view_postpatch.py
& H:/hindsight/.venv/Scripts/ty.exe check w5_native_view_inventory.py w5-native-view-postpatch.py --output-format concise
& H:/hindsight/.venv/Scripts/python.exe -B -s -m unittest test_w5_native_view_postpatch -v
& H:/hindsight/.venv/Scripts/python.exe -B -s w5-native-view-postpatch.py
```

The parent-approved scoped checks replace the unrelated full Native auto-fix/dependency-sync hook. `trellis-check`,
`trellis-before-dev` guidance and Native code-review standards were applied. This two-file type invocation is not
the historical seven-production-file/preimage comparison recorded in `w5-candidate-combined-independent-check.md`.
That earlier command retained one `transition_delta.py:97` optional-UUID `invalid-argument-type` diagnostic. The
implementer separately reported a current three-file pass. This review did not rerun either the three-file or
historical seven-file commands and makes no claim that the historical debt vanished or the whole package is green.

## Final source identity and parent gate

NEW final inventory: `w5-native-view-checked-source-manifest.json`, 382 entries. Its complete SHA256 is delivered
externally in the checker handoff because this report is itself a manifest entry (avoiding a self-hash cycle).
The parent should compare that SHA first, then call `verify_inventory(expected_sha)` from this research directory.
All inherited files outside the explicit three helper repairs are preserved byte-for-byte; the original delivered
375-entry manifest remains at the pinned SHA above and its unadapted verification must now reject changed helpers.

Unchanged production SHA256:

- `transition_snapshot.py`: `eb5d447224ac67357265af860d60d20024c75e8b12cc30deecab9ad94994cbda`.
- `application_state/snapshot.py`: `986ab9fab3e643ee5207c9df3cc4fe9c5b02d035223a8af2a9b0f585374e33a1`.

Only after parent verification of this independent gate, the parent may run from `H:/TakiAgent`:

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-native-view-postpatch.py --run-reviewed-clone
```

Inspect all four exact source reports, `result.json`, `telemetry-result.json`, `postpatch-result.json`, real worker
identity, actual embeddings, exact apply/lookup/mapping/artifact proof, timing and stopped/port-released cleanup.
Adequate actual-model margin precedes a separately reviewed complete HTTP measurement. Real-pair migration/recovery,
the same admitted transition, actual per-Bank maintenance plans/allowances, complete roundtrip/custody/readiness/queue
proof and final W5 acceptance remain parent-owned. No clone/model/HTTP/working-pair access, renewal, maintenance
allowance, reconversion, commit/push/archive, authority replacement, W6 dispatch or owner/manual pass occurred here.

## Findings (not fixed)

No unresolved defect remains within this bounded review. Historical type-check differences and the unperformed
parent execution gates above remain explicitly separate from this scoped PASS.
