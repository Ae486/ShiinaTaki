# W5 head-prefetch repair: independent check

Date: 2026-10-05. Reviewer: `w5_postpatch_review`.

## Verdict

**PASS for the bounded source, offline scheduling, owned-PG correctness and execution-helper gate.** No defect
requiring a change to the delivered source was found. Parent may next run one actual-model fresh-clone diagnostic.
Restored scheduling does not prove a numeric saving, adequate Native margin, complete HTTP latency or W5 acceptance.

Verified checkout identities: `H:/TakiAgent`, `main`, `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`;
`H:/hindsight`, `main`, `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`. Both worktree lists were inspected.
The parent's explicit existing task assignment was used; the empty global task pointer was not modified.

## Actual-path review

- All six fresh preimages match their recorded hashes and sizes. The complete UTF-8 diff contains exactly the
  three approved production changes, the existing mock-store adaptation and two contract paragraphs. The new
  complete-body scheduling test is the only added Native test file. No production SQL, model/schema, codec,
  lifetime/budget, transaction, migration, timer or configuration behavior was changed.
- `ApplicationStateStore.heads()` keeps its original SELECT and delegates the identical complete list parser to
  `_heads_from_rows`. `_TransitionValidationReader` registers non-null refs after the superclass successfully parses
  the entire list. `_locked_native_view` invokes that same hook over its already fetched rows. Both callers reach
  the hook once without another query; raw SQL keys remain available to the original key/envelope comparison.
- The original head-first queue order, duplicate-body deduplication and tombstone/null exclusion remain intact.
  Registration grants no accepted-body or native-payload proof: exact descriptor identity, scoped immutable-byte
  validation, independently decoded models, Source checks, unsafe/invalidated fallbacks and disposal are unchanged.
- New checker cases verify malformed JSON and malformed later head models cannot leave a partially registered batch,
  while preserving an already queued earlier set. Ordinary and locked callers each make one SELECT. Additional
  cases verify tombstones, duplicate refs, original head order and the ordinary base parser's exact return value.
- The delivered scheduling regression really invokes `_bundle_records`, the locked view, the actual reader,
  immutable byte/schema validators and native document Source comparison for 260 Documents, 260 native Source
  bodies and 260 Blocks. The SQL transport and bulk source loader are simulated. It independently passes with
  equal descriptors, 780 fully verified distinct bodies, restored ordinary-reader body-query schedule, no optimized
  current-head/document point reads, and no body SQL in its second full-schema traversal. This is stronger than the
  earlier transport-only probe, but is not a PostgreSQL or elapsed-time benchmark.
- The separately executed real-PG differential cases verify complete baseline/component/auxiliary equality across
  all native kinds, Unicode and duplicate archive entity IDs, with only invalidated payloads retaining native point
  reads. The chosen apply cases also verify independent reader lifetimes, corruption at second admission, and final
  post-write corruption rolling back all writes. The large multi-batch body-count assertion is from the offline
  complete-body fixture; no large-corpus PostgreSQL count/latency result is claimed here.
- Native `TAKI_PATCHES.md` and the healthy-driver spec accurately record the parse/register integration constraint.
  No API, generated client/template, schema or configuration sync is required for this repair.

## New execution composition and inventory

The thin new entry injects only the new inventory module and entry path into the sealed checked wrapper. The
wrapper's actual V2 worker, nested rehearsal/V3 manifest routing and fixed historical dependency pins remain intact.
Both parent and worker verify the same successor inventory before/after. The unchanged checked four-report equality,
malformed/missing report refusal, sanitized worker failure records and separate diagnostic/timing flags are exercised
by the new composition's inherited tests. Default CLI remains inert; its actual-model/worker/clone branches were not invoked.

The new verifier authenticates the predecessor itself at
`e0ec8c9e8b10706411e1f1bc2c43d1d0022a2b010471ef3bc976e4bea8331f4c`, requires its full 382-entry set, permits only
the six explicitly named replacement paths, requires exactly the declared additions, and preserves every inherited
manifest pin. Missing/extra/duplicate paths, unknown replacements, repinned history, changed current files and an
incorrect caller-supplied digest fail closed. Parent and reviewer independently verified the delivered inventory;
this reviewer ran it before and after the checks below.

**Final inventory remains the unchanged delivered `w5-head-prefetch-source-manifest.json`: 404 entries, eight
inherited manifests, SHA256 `ca275f841f3f5a66620be833a692b33117b9256b735f1cf10f4c17f6522647fb`.** No gratuitous
successor manifest was created. This report and its new checker-only tests/logs are independently hashed evidence.

Current production SHA256:

- `application_state/store.py`: `e1d1e0c7800d86dc6ba2729515f49a3c15666a5b4076fd96ac6a60a408a11ab8`.
- `application_state/snapshot.py`: `a180475953e5fda013f8f2ce3ad930fcfff27910cf9dcf7dc45ac380be06e874`.
- `transition_baseline_reads.py`: `70cd538d7f49116f484713e67200a20182e3329c83a51454456fc8681075b30d`.

## Verification

All commands used the existing Native venv and parent-approved scoped checks. `trellis-check`, already loaded
`trellis-before-dev` guidance and Native code-review standards were applied; global auto-fix/dependency sync was not run.

| Independently executed check | Result |
| --- | --- |
| Offline Native selection: complete bundler (1), new parser/registration cases (6), indexed-key refusal (1), duplicate fallbacks (2) | 10 PASS, 8.63s |
| New successor helper/inventory tests, including inherited checked failure/report tests | 12 PASS, 1.427s |
| Fresh owned-PG selection listed below | 5 PASS, 41.03s |
| Native Ruff/format: three production files and two affected test files | PASS; five already formatted |
| Native `ty`: exactly the three changed production files | PASS, no diagnostics |
| Helper/checker Ruff/format: three delivered helper files and new checker test | PASS; four already formatted |
| Helper `ty`: two delivered implementation files | PASS, no diagnostics |
| Scoped Native/Taki `git diff --check` | PASS; existing Native Markdown LF-to-CRLF advisory only |
| Complete 404-entry verifier before and after checks | PASS, identical final SHA |

The implementer's earlier RED/GREEN, 20 offline, 23 PG and 12 helper results were read as historical delivery
evidence, not recounted as new executions. No unrelated broad suite was rerun.

Exact argv, cwd, stdout, stderr and exit codes for every test/static command are in
`w5-head-prefetch-independent-checks/{offline,helper,native-lint,native-format,native-types,helper-lint,helper-format,helper-types,owned-pg}.json`.
The new `test_registration.py` and those logs are hashed by `summary.json`, SHA256
`e155ddaff5c11a5f71c4f24dc760c7384a1fecfac101cfc1aea1d8938642bec0`.
All checker files are UTF-8 without BOM and outside the unchanged delivered source inventory.

Exact owned-PG command from `H:/TakiAgent`:

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- tests/native_results/test_transition_native_view_pg.py::test_complete_native_view_matches_ordinary_kinds_source_policy_and_unicode tests/native_results/test_transition_baseline_reads.py::test_second_admit_rereads_corruption_and_leaves_no_delta_commit[body] tests/native_results/test_transition_artifact_reads.py::test_actual_apply_uses_five_separately_disposed_validation_readers tests/native_results/test_transition_artifact_reads.py::test_final_reader_detects_body_corrupted_after_predecessors_and_rolls_back_all_writes -q --tb=short -n 0
```

Fixture `taki-hindsight-g1-f55d5a3edd27` reports `Stopped=true`, `DataRemoved=true`, `RegistryRemoved=true`.
Its ownership file confirms stopped state; retained logs are under `.trellis/.runtime/g1-validation/`.

## Findings (fixed)

No delivered-source findings. Added only the six checker parser/registration cases and new review evidence;
all delivered production, test, helper, report and manifest files remain byte-identical to the 404-entry seal.

## Findings (not fixed)

No unresolved defect was found in this bounded repair. Actual-model Native margin, complete HTTP measurement,
same-transition working-pair recovery, per-Bank maintenance decisions and final W5 acceptance remain parent-owned
and unproven. No model/corpus/HTTP/working-pair run, renewal, reconversion, Git mutation, later-wave dispatch or
inferred owner/manual pass was performed.

After independently checking this report/evidence and the final source SHA, the parent may run once:

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-head-prefetch-postpatch.py --run-reviewed-clone
```

Inspect recovered body ordinary/batch counts separately from timing, all four inventory reports, worker identity,
actual encoding, exact result/lookup, preservation and owned cleanup. Adequate actual-model margin still precedes HTTP.
