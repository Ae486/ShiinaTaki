# W5 bounded head-prefetch repair delivery

Date: 2026-10-05. Implementer: `w5_head_prefetch_implement`.
Task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Taki root/branch/HEAD: `H:/TakiAgent`, `main`, `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
Native root/branch/HEAD: `H:/hindsight`, `main`, `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
The explicitly assigned task was used; no task pointer was changed.

## Result and exact ownership

The approved three-file production repair is complete. Ordinary `ApplicationStateStore.heads()` retains its SQL
and delegates parsing to protected `_heads_from_rows(rows)`. The validation reader overrides that parser, invokes
the superclass parser and registers the same non-null body references in the existing order. `_locked_native_view`
uses that hook for its already fetched SQL-keyed rows. No duplicate SELECT, reader-state poke or public API was added.

Production replacements relative to the immediately preceding checked inventory:

- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/store.py`.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/snapshot.py`.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/transition_baseline_reads.py`.

Three other existing paths changed: `tests/native_results/test_transition_native_view.py` now gives its mock store
the actual protected parser; `H:/hindsight/TAKI_PATCHES.md` and Taki's
`.trellis/spec/backend/memory-transition-healthy-drivers.md` record the head-first parse/register contract.
Fresh byte-exact copies of all six preimages are in `w5-head-prefetch-preimages/`, with original SHA256/size/path.
The only new Native file is `tests/native_results/test_transition_head_prefetch.py`.

All SQL text, indexed object-key comparison, malformed/duplicate/invalidated fallback, null-reference registration
condition, validators, Source checks and budgets are retained. `transition_snapshot.py`, delta apply, codec,
models, serializers, transaction/migration code and Core production are unchanged. Both admissions and the other
three reader lifetimes retain their original creation/disposal boundaries. No generated/config/dependency change.

## Meaningful RED before production changes

The new regression invokes the actual `_bundle_records`, `_locked_native_view`, `_TransitionValidationReader`,
ordinary `current_native`, body decoder/schema validation and live native Source-evidence comparison. Only the SQL
transport and bulk source loading are simulated. Its fixture has 260 complete Document heads, 260 independently
hashed native Source bodies and 260 complete Block artifacts. Each native Source is an unlisted dependency;
head/artifact enumeration crosses multiple default 128-body batches.

Before patching, both paths returned identical 520 descriptors and fully validated all 780 distinct bodies once.
Each performed one head and one artifact enumeration, all 260 fresh Source comparisons, and a second full-schema
body traversal added zero SQL. The optimized path also retained zero native head/document point reads.
The regression then failed on the transport schedule, rather than an implementation-private queue assertion:

| Per first bundler traversal | Ordinary reader | Broken locked view | Repaired locked view |
| --- | ---: | ---: | ---: |
| Ordinary body metadata | 258 | 519 | 258 |
| Ordinary body parts | 258 | 519 | 258 |
| Each metadata/size/part batch family | 5 | 3 | 5 |
| Fully verified distinct bodies | 780 | 780 | 780 |

`w5-head-prefetch-checks/red.json` preserves the actual failing pytest output (exit 1, 1 failure, 6.04s).
`green-offline.json` records the same regression plus all 19 existing native-view tests: 20 PASS, 7.84s.
Re-enumeration after cached reads and post-close read refusal are also asserted by the new regression.
The old corpus-shaped diagnostic probe and its historical evidence remain byte-identical; they were not rewritten
or rerun through their intentionally prepatch-only main assertion. This fixture's counts are not a latency forecast.

## Scoped verification actually performed

| Gate | Result | Evidence |
| --- | --- | --- |
| New complete-body scheduling regression before patch | Expected exit 1 / 1 failure | `w5-head-prefetch-checks/red.json` |
| New regression plus existing offline native-view suite | Exit 0 / 20 PASS / 7.84s | `green-offline.json` |
| Fresh owned PostgreSQL differential/corruption/disposal selectors | Exit 0 / 23 PASS / 113.13s | `owned-pg.json` |
| New exact inventory and inherited checked V2/report/failure tests | Exit 0 / 12 PASS / 1.422s | `helper-offline.json` |
| Scoped Native Ruff and format | Exit 0 / 5 Python files | `quality.json` |
| Scoped Native `ty` | Exit 0 / all 3 production files | `quality.json` |
| Scoped helper Ruff/format and `ty` | Exit 0 / 3 Python files; types on 2 implementation files | `quality.json` |
| Scoped Native/Taki `git diff --check` | Exit 0; existing Native Markdown LF/CRLF advisory only | `quality.json` |
| Unchanged previous inventory verifier over actual changed source | Expected `POSTPATCH_SOURCE_DRIFT` | `quality.json` |

The PostgreSQL selectors cover complete baseline/component hashes and auxiliary rows; all native kinds; original
Source/Block/policy bodies; Unicode and duplicate archived entity IDs; fresh document evidence; two independent
apply admissions; corruption between admissions with no delta commit; success/error/cancel disposal; cached queue
cleanup; historical Source closure and cycles; missing/extra/order/byte/whole/semantic/schema/sealed-state faults.
They reuse the existing fixtures and tests. These 23 tests were not followed by an unrelated broad suite.
Counts overlap prior waves and do not imply 55 new regression scenarios.

Fresh fixture `taki-hindsight-g1-d205f3078fed` used PostgreSQL 18.1 and the existing isolated runner, disabled dotenv,
fixture-only settings and network guard. Cleanup reports `Stopped=true`, `DataRemoved=true`, `RegistryRemoved=true`.
Logs remain at `.trellis/.runtime/g1-validation/taki-hindsight-g1-d205f3078fed/`. No real model request was made.

Exact argv/cwd/stdout/stderr/exit codes are retained in the five evidence JSON files above. Core commands were not
needed because Core production is unchanged. Native's unrelated global auto-fix/dependency-sync hooks were replaced
by the parent-approved scoped commands. Self-review against Native's code-review guidance found no new production
type/API/locking/backup/registration concern. Independent review remains required.

Representative reproducible commands:

```powershell
# Native cwd H:/hindsight/hindsight-api-slim; PYTHON_DOTENV_DISABLED=1 and explicit Native PYTHONPATH.
H:/hindsight/.venv/Scripts/python.exe -m pytest --noconftest -o addopts= tests/native_results/test_transition_head_prefetch.py tests/native_results/test_transition_native_view.py -q --tb=short

# Task research cwd.
H:/hindsight/.venv/Scripts/python.exe -m unittest test_w5_head_prefetch_postpatch -v
```

Use the exact owned-PG command in `owned-pg.json` for the scoped fixture selectors; it must run through
`09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py`, never against an existing DB URL.

## Additive source inventory and execution entry

`w5_head_prefetch_inventory.py` pins the complete previous 382-entry checked manifest at
`e0ec8c9e8b10706411e1f1bc2c43d1d0022a2b010471ef3bc976e4bea8331f4c`.
The new `w5-head-prefetch-source-manifest.json` contains exactly **404 entries**: every preceding entry with only
the six authorized replacements, plus 22 explicitly declared additions. It includes the preceding manifest itself,
all seven inherited historical manifests, the new analysis/probe/evidence/brief, preimages, new helpers/test,
delivery report and check evidence. The manifest excludes itself; its SHA256 is delivered separately to avoid a
self-hash cycle. Unauthorized replacement, missing/extra/duplicate entries, changed predecessor, missing inherited
pins, current source drift and parent/worker manifest mismatch all refuse. All previous helper files stay sealed.

`w5-head-prefetch-postpatch.py` is a thin module composition over the unchanged checked native-view wrapper.
It injects only the new inventory module and the new entry path. The checked wrapper therefore routes the actual
V2 worker to this same new file, verifies the same complete source set before/after in both processes, and retains
all four persisted inventories, original handshake, failure records, watchdogs, offline model/dependency pins,
clone-only access, normal claim/apply, exact lookup and cleanup. The 12 offline helper tests include the checked
persisted-report and failure-record tests against this new composition. Default CLI reports `executed=false`.

After independent review, the parent must rehash the final set, then may execute exactly one newly owned clone:

```powershell
# cwd H:/TakiAgent; parent only, after independent correctness review and final source rehash.
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-head-prefetch-postpatch.py --run-reviewed-clone
```

This implementer did not execute that flag, an owned-job worker, a model/corpus/HTTP path, or the working pair.
Neither diagnostic success nor restored query structure establishes complete 60-second timing. Parent must inspect
the ordinary/batch body counts independently of full apply time, then establish adequate actual-model margin before
HTTP acceptance. Same-transition recovery, separately reviewed per-Bank maintenance, all-Bank COMMIT/readiness/
custody/queue proof and final W5 acceptance remain pending. No renewed admission, Local edit, corpus conversion,
system/model/timer setting change, dependency change, commit/push/archive or manual acceptance was performed.
