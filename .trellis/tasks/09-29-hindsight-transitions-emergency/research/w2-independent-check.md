# W2 independent check

2026-09-30. Reviewer: `/root/w2_check`. Taki: `H:/TakiAgent/main`, HEAD
`fccfc4fb78958c90efebdb4a5a98b355bcb73a40`. Native: `H:/hindsight/main`, HEAD
`6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.

## Gate

**W2 PASS after the fixes below.** No known unresolved blocker remains in this wave. The final real HTTP invocation
of Core claim/verify/resolve passed. The leader owns advancement to W3; W2 does not compose a driver, build a Local
candidate, select Core authority, execute transition queues, or certify product/manual/original-data acceptance.

The supplied existing task/session authority was used; the empty legacy `.current-task` never redirected work to T4.
Reviewed PRD/design/implementation plan, curated context, W0/W1 and W2 reports, native guidance, source and regression
paths. The original implementation evidence is historical input, not relabeled as this review's new execution.

## Findings (fixed)

### F1 — High: retired callbacks could enqueue fresh work after the Bank became writable

- File: `hindsight-api-slim/hindsight_api/alembic/versions/e30a9d7f6c21_add_transition_publication_fences.py`.
- Issue: the queue trigger returned early for no-owner/active/aborted states before checking inherited writer or
  transition execution identity. A late callback could enqueue a job that a fresh worker would execute in the current
  generation, although the same callback's direct canonical write was correctly refused.
- Fix: validate server-owned execution identity before those allow branches, using the admission form of the existing
  publication check so queue lock order remains owner-only. Fresh roots retain normal admission. Tests cover completed
  and expired ordinary writers, old transition executors, source resume, actual activation and accepted descendants.
- Reproduction: real PG run `9a6f3170c63b52f4` failed because the expected stale exception was absent. The subsequent
  complete fence group passed. No new worker can pick up the refused job because no async row is inserted.

### F2 — High: actual B3 template initialization could never prove a new unused scope

- Files: new `engine/transition_initialization.py`, `engine/memory_engine.py`, `api/http.py`, transition SQL/context/
  unused/snapshot/storage modules and `admin/cli.py` under `hindsight-api-slim/hindsight_api/`.
- Issue: actual B3 `applyHindsightBank -> importTemplate` always schedules a mental-model refresh. The old W2 queue
  trigger permanently marked that fresh Bank used, and unused validation rejected its async operation and real model
  history. Empty-Bank fixtures missed the incompatibility; a real `taki-bank-v1` Character template reproduced it.
- Fix: the actual authenticated importer owns one writer over its whole operation and records immutable native
  initialization events in `memory_transition_initializations`. First admission is bound under the Bank lock to the
  actual non-backfilled birth, exact parsed template and import. Each refresh admission is recorded in the same
  transaction as its real queue row. Only its original live writer/exact operation may record model history and actual
  completed output. A task-local scope alone, model ID, GUC or DTO token does not replace those joins.
- Unused validation checks the complete operation set, exact task/model/template definitions, real completion, all
  history rows and actual final output/config/directives. Same-template retries retain original evidence; pending,
  failed, unknown, extra/missing events, altered definitions/templates and ordinary interleaved writes refuse. Other
  source/data/queue use stays sticky; `ever_used` is never reset. Changed-template import can still perform ordinary
  template work, but cannot regain unused eligibility.
- Added the ledger to actual capability detection, complete auxiliary evidence and physical backup/restore. The
  existing restore exemption still suspends only the same three publication/admission trigger function classes;
  immutable guards and FKs remain active. Old archives receive neither new birth nor invented initialization history.
- Reproduction: `7f8cc81af5820c53` completed the real mock refresh then refused unused proof. New tests run the actual
  template producer, both synchronous and separate workers, and compare every stored column after physical restore.
  The JSON fixture was generated directly from Taki's `loadTakiBankTemplate("taki-bank-v1", "character")`.
- Test-only correction: `353dfbfeca0097db` had 13 passes and one bad assertion comparing generated FK trigger OIDs
  between different schemas. The corrected test compares the target's own trigger modes before/after restore;
  production restore did not require another fix for that assertion.

### F3 — High: ID-only deletion did not own the complete writer lifetime or final Bank set

- Files: `engine/transition_writers.py`, `transition_context.py`, `db/postgresql.py`, `memory_engine.py`, e30 SQL.
- Issue: the decorator recognized explicit `bank_id` only. Existing `delete_memory_unit` without a Bank and multi-Bank
  `delete_memory_units` discover Banks from IDs, so their data transaction and post-COMMIT graph/consolidation children
  lacked a whole-call identity. Post-COMMIT work could obtain a fresh writer after a transition resumed writes.
- Fix: authenticate, discover the immutable Bank membership, register each Bank in sorted order, then retain those
  identities across the original atomic delete and all awaited children. SQL and nested calls select the original
  Bank identity; parent completion/expiry revokes every retained child.
- The leader additionally identified a discovery race: a requested ID absent from the first lookup may appear in
  another Bank before the transaction's second lookup. Both delete paths now require the final Bank set to be a subset
  of the registered set before any delete. Initial emptiness is an explicit closed set, and SQL/child admission refuse
  missing membership rather than registering it mid-call. Actual pre-transition schemas keep their original behavior;
  malformed UUID and empty-input validation still run before authentication.
- New real PG tests pause after the delete COMMIT and prove every Bank remains draining until its actual graph child
  finishes, then reject its stale child after source resume. Two further tests create the requested ID through another
  connection between the two real lookups, proving both single and bulk paths preserve every row and enqueue nothing.

### F4 — Medium: claim and decision replies were not fully bound to the submitted command

- Files: Core `hindsight-transition-client.ts`; native `engine/transition_service.py`.
- Issue: Core validated general status identity but could accept a different claim attempt/revision or a validly hashed
  outcome for a different decision. Native claim replay could mistake any matching-attempt revision+1 phase update for
  a successful generation takeover.
- Fix: Core checks exact claim attempt, expected revision increment, real takeover generation and no terminal outcome;
  resolution must contain the exact submitted decision/executor. Native replay checks the previous execution generation
  and changed attempt. Stale or mismatched replies refuse without retrying another command. Existing historical proofs
  remain valid under a newer current executor; no proof publisher/current-owner equality was imposed.
- Core regressions cover wrong attempt/revision/generation and a self-consistent foreign decision. Native fence tests
  reject treating an ordinary phase advance as claim. Final real HTTP coverage is recorded below.

### F5 — High: concurrent verify requests could start two native passes under one live executor

- File: `engine/transition_maintenance.py`.
- Issue: `_prepare_transition` accepted an already-running attempt with the same executor and started `_execute_attempt`
  again. A lost response followed by retry could repeat in-flight model work under the same logical pass.
- Fix: under the same Bank transaction, a duplicate live running attempt refuses `accepted_work_unresolved`. The caller
  polls the original proof, resumes a recorded incomplete attempt, or claims a new generation after real expiry. The
  durable fence remains held throughout. A real PG regression pauses the first pass, verifies the second never enters
  native execution, then recovers the sealed proof with the execution count still one.

### F6 — Medium: advertised storage checks omitted consumed columns and nested function dependencies

- File: `engine/transition_storage.py`.
- Issue: the storage probe checked trigger names/types but not their actual function binding; several consumed owner/
  writer fields and new nested publication dependencies could be absent while the surface appeared supported.
- Fix: probe all consumed request/writer/initialization columns, the expected trigger function OIDs and nested function
  signatures. Transactional table/function-rename regressions prove the capability refuses incomplete storage and
  recovers after rollback. This does not claim to detect arbitrary privileged replacement of a function body.

## Findings (not fixed)

None remaining within the W2 producer/transport scope after the listed checks. The intentional boundaries below are
not waived: native cannot certify actual Local database completeness or a Core authority receipt; W3 joins complete
Local captures/manifests/mappings and preserves unbound derived objects with its explicit initial policy producer.
W4 owns authority/custody/queue COMMIT and runtime recovery. W5-W8 and owner/manual/live acceptance remain open.

## Actual-path review

| Area | Result and boundary |
| --- | --- |
| Native writer ownership | Ordinary engine writes, accepted async roots/descendants, cursor/journal publication and association row/endpoint ownership share fixed Bank locks and durable revocation. ID-only and whole-template gaps above are now covered. Whole-Bank portable import still requires a nonexistent target; it cannot overwrite a transition-owned existing Bank. |
| Final proof | Actual finite D78 algorithms run under separate transition owners/stores. Native snapshot, D77 history, auxiliary rows, maintenance evidence and proof share one final transaction. Static models retain explicit non-applicability; newly derived unbound objects remain in evidence. |
| Delta | Complete native/chunk/application inventory, predecessor revision/body hashes, retirement witnesses and baseline re-read gate one native/application transaction. Unchanged bodies/IDs and policy/Block-only reuse are retained; actual post-delta Source witness drives Core original projection. |
| Recovery | Sealed proof/history stays immutable through executor claim/TTL. Old writers do not revive; safe pre-effect abort restores the retired baseline or unused hold. Applied/unknown effects keep the original recovery identity. |
| Restore | Exact original origins, initialization ledger, fences, proofs/outcomes and body bytes survive offline COPY. Deferred constraints validate before exact trigger-mode restoration. Failed COPY rolls back data and DDL; ordinary HTTP has no exemption. |
| Protocol | Named OpenAPI nullable unions add no root wire field. Core error handling intercepts ordinary/normalized fence 409 before legacy cursor reset, preserving D93. The independent build/version and old G1/D77/D78 guards remain intact. |
| Generated clients | Canonical OpenAPI regeneration is byte-identical. All existing generated SDKs/maintained wrappers remain byte-identical to the reviewed implementer result; no wrapper method or public schema changed in this review. |

## Verification

Counts overlap and must not be added as unique coverage. Every native group below uses fresh owned PostgreSQL 18,
disabled dotenv, mock/deterministic models, cached embeddings and restricted local networking. Its recorded exit is 0
and stopped=true unless explicitly shown as a retained red/test-fixture run above. Native runner logs/results are in
`.trellis/.runtime/stage4-native-tests/<id>/`; named command-output logs are beside this report.

The prefix `N` below is the exact command (cwd `H:/TakiAgent`):

```powershell
node .trellis/tasks/09-29-hindsight-transitions-emergency/research/native-tests.mjs
```

| Exact selectors following N | Run / result |
| --- | --- |
| `tests/native_results/test_transition_fence.py` | `e596e075f300bb09`: 8 passed / 52.27s. |
| `tests/native_results/test_transition_initialization.py tests/native_results/test_transition_fence.py tests/native_results/test_transition_unused_scope.py tests/native_results/test_transition_integrity.py tests/native_results/test_transition_backup.py tests/test_admin_backup_restore.py` | `2ac2e83b87145e94`: 54 passed / 388.34s. Initialization/restore and original affected gates. |
| `tests/native_results/test_transition_writers.py tests/native_results/test_transition_fence.py tests/native_results/test_transition_unused_scope.py` | `c849124808c39320`: 16 passed / 123.43s. Actual delete/child ownership and activate-then-stale admission. |
| `tests/native_results/test_transition_initialization.py tests/test_bank_templates.py tests/test_delete_memory_units_validation.py` | `17a70c72e9936de9`: 54 passed / 258.14s. Original template/default-template API and validation compatibility. |
| `tests/native_results/test_transition_proof.py tests/native_results/test_transition_delta.py tests/native_results/test_transition_recovery.py tests/native_results/test_transition_api.py tests/native_results/test_transition_integrity.py` | `af40244a2b5c5651`: 35 passed / 380.28s. Includes duplicate live verification and nested capability dependency refusal. |
| `tests/native_results/test_transition_writers.py tests/test_delete_memory_units_validation.py tests/native_results/test_transition_initialization.py::test_real_b3_template_refresh_can_prove_a_new_unused_scope tests/native_results/test_transition_initialization.py::test_initialization_proof_rejects_missing_extra_or_foreign_effects[definition]` | `7cf21fcc2931a9b5`: 9 passed / 53.24s. Final membership race, exact definition and real template retry checks. |

Native tests were launched with hidden `Start-Process` and redirected stdout/stderr after the first ordinary exec
session was terminated by Windows (`-1073741510`) before pytest. That attempt's sole owned fixture
`ce7d9847feae2569` / `taki-drill-ffbcbbecc291` was verified and stopped. It is an interrupted harness execution, not a
failed test; no unrelated instance was touched.

Core command (cwd Taki):

```powershell
pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-transition-client.test.ts src/memory/hindsight/hindsight-application-transport.test.ts src/memory/hindsight/hindsight-compatibility-service.test.ts src/memory/hindsight/hindsight-cursor-reset.test.ts --maxWorkers=2 --reporter=dot
```

Result: 4 files / 39 passed, exit0. Shared schemas were unchanged by this review; their implementer 7-file/66-pass
evidence remains historical, not a new execution. No Desktop/Rust Shell change required a desktop build.

Real HTTP command (cwd Taki):

```powershell
& 'H:/hindsight/.venv/Scripts/python.exe' '.trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py' --allow-http-fixture -- tests/native_results/test_transition_core_projection.py -q --tb=short -n 0
```

The final run invokes Core `claimTransition`, `verifyTransition` and `resolveTransition` through the owned HTTP
listener, including old-executor refusal and exact new decision success: fixture `739ff8e3adc9`, **1 passed / 22.99s**,
exit0; owned instance stopped and owned data/registry removed. Python only prepares the sealed proof/expired lease
and checks final storage plus zero repeated maintenance. The earlier
`7215ae87ed9b` group passed 2 tests/39.11s but exercised Source HTTP projection plus Python-native recovery; it did
**not** prove the modified Core claim/resolve methods. Its evidence remains separate.

Quality and generation:

- `pnpm lint`: pass/exit0, `w2-independent-lint.log`.
- `pnpm typecheck`: pass/exit0 for all five workspaces, `w2-independent-typecheck.log`.
- Native `.venv/Scripts/ruff.exe check hindsight-api-slim`: pass/exit0.
- Native `.venv/Scripts/ruff.exe format --check hindsight-api-slim --exclude '**/test_taki_replication_curation.py'`:
  pass/exit0, 782 files. The unchanged pre-existing curation-test blank-line discrepancy remains byte-preserved.
- Native `ty check --python ../.venv` over all transition engine/transfer modules, `maintenance_candidate.py`,
  `api/taki_transitions.py` and `admin/transition_restore.py`: pass/exit0. The one new callable-name typing diagnostic
  was fixed with a checked optional attribute lookup, without a type suppression.
  The final membership/context edits were checked again together with `db/postgresql.py` and `memory_engine.py`:
  pass/exit0, `w2-independent-native-ty-final-delta.log`.
- Full `ty check --python ../.venv hindsight_api`: exit1 with the same 27 pre-existing Windows/MLX/Unix-resource
  diagnostics. It is not reported green. Log: `w2-independent-native-ty-full.log`.
- Canonical Windows generator `run_windows_codegen.py --openapi`: `dcc5d19657d9`, exit0. Output remains SHA-256
  `fe0f1f29ef5ff03e0cd9e0c81204ac5a3224cfa623deeb70abcfe3cb356de185`. No SDK regeneration was necessary; the unchanged
  four-client generation/build/repeat evidence remains the implementer's recorded result.
- Both repositories' `git diff --check`: pass; source byte checks also cover new/untracked files separately.
- `python ./.trellis/scripts/task.py validate 09-29-hindsight-transitions-emergency`: pass, 24 implement / 28 check entries.

The native monolithic lint hook was not invoked because it synchronizes dependencies and rewrites unrelated dirty
trees. Non-mutating/scoped equivalents above were used. No full native suite, paid model quality, original data
round-trip, live deployment, GUI acceptance or OS crash/power-loss test is claimed.

## Preservation and final ownership

Original implementer manifests are retained as `w2-native-files-implementer.json` and `w2-preservation-implementer.json`.
Current `w2-native-files.json` records all 138 W2 native paths and final SHA-256 values; this includes the new actual
template entrypoint, initialization module, native fixture/tests and the existing generated assets. The checker-only
delta and Taki source hashes are in `w2-checker-source-hashes.json`.

`w2-preservation.json` / `w2-checker-preservation.json` rehash the original 205 native dirty paths: 179 byte-identical,
26 explicitly extended within W2, none missing. The one additional original path beyond the implementer's 25 is
`api/http.py`, changed only to thread the real parsed-template scope into the authenticated native producer. Existing
patches were retained. Historical migration `d77a4f8c2e10` and all unrelated generated/maintained SDK bytes remain intact.
The separately protected CLI still hashes to
`ce3ccd97b3759b2a0848221a9487de67178ce640d1ddc324a3043f7507655ef2`.

Native build remains the matched unpublished `taki-memory-hindsight-0.9.0-transitions-v1`, transition contract 1.0.0,
e30 migration after unchanged d77; Core migration head remains 052. Only the accepted initialization/ownership proof
was completed; no new public wire field, environment variable, dependency, live authority, Git commit/push/rebase/reset
or Trellis finish/archive was performed. A deployment still requires the separately authorized matched native upgrade
and actual capability probe. Downgrade cannot erase retained origin/transition/initialization evidence.
