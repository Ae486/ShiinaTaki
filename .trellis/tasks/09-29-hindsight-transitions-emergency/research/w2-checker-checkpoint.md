# W2 independent checker checkpoint

2026-09-30. Active checker `/root/w2_check`, first/current window `01a0f216-938f-7ac1-89ef-64916938473e`.
Read `w2-check-resume-brief.md` and the parent's supplied ownership brief if resuming. This file is a progress checkpoint,
not a completed independent gate. Do not start W3 or spawn another agent.

## Authority and preservation

- Only Taki `H:/TakiAgent`, main, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`; native `H:/hindsight`, main,
  HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`. Explicit workdir and absolute edits. Never T4.
- Empty `.current-task` is not authority; parent supplies this existing in_progress task. W0/W1/native dirty files stay.
- Initial checker hashes: `w2-checker-baseline.json` (164 Taki / 322 native dirty+untracked file hashes).
- Required PRD/design/implement/check context, W2 report/hash/preservation/codegen artifacts and W1/interface notes read.
  Trellis check/before-dev and native code-review standards loaded. Relevant memory query found no W2 guidance.
- No original data/instances, paid calls, new dependency, commit/push/reset/rebase/archive. Test runners create isolated PG18.

## Fixed finding 1: late queue admission

`e30...` queue trigger returned for active/aborted/no-owner before validating inherited execution context. Stale callbacks
could enqueue work that a fresh worker would execute. Added `check_transition_publication(bank,true)` before those
branches whenever server writer/transition context is present; preserves owner-only queue lock order.

- Red `9a6f3170c63b52f4`: 1 failed (expected stale exception absent), exit1/stopped true.
- Green `e596e075f300bb09`: entire fence file 8 passed/52.27s/exit0/stopped true. Covers old writer/transition after abort,
  completed/expired writer with no owner, accepted descendants and original barriers.
- TODO: cover actual activate followed by old writer/transition late admission, then include in final affected run.
- Initial ordinary exec runner was killed by Windows session `-1073741510` before pytest (`ce7d9847feae2569`);
  no test result. Its sole owned `taki-drill-ffbcbbecc291` was checked and manually stopped. No process remains.
  Use `Start-Process node ... -WindowStyle Hidden -RedirectStandardOutput/-RedirectStandardError` and poll logs/results.

## Finding 2: real B3 template cannot qualify unused

Actual `applyHindsightBank -> importTemplate -> api/http.py::_apply_bank_template_resources` unconditionally refreshes
the model. Queue trigger set ever_used; unused rejected any async/history. Parent approved minimal provenance fix and
explicitly required real birth/import/operation/worker/output, complete events, sticky usage, no backfill, same template
retry, failed/pending/unknown rejection, auxiliary/capability/backup/restore coverage. No new owner decision needed.

Implemented (new code needs full independent verification):

- New `engine/transition_initialization.py`: typed template+event models, first template scope under real Bank lock and
  origin, same-template retry, current-task-only scope, admission event before actual queue INSERT, complete unused
  validation against current task rows/history/template/model output. Unrecognized/used banks retain ordinary behavior.
- Added e30 `memory_transition_initializations` append-only event table. Existing bank/queue trigger classes record
  admitted refresh/history/completed output only with original birth and live writer/exact worker operation. Other data,
  ordinary queue or post-init config/model/directive writes permanently set ever_used. No restore exemption broadened.
- Actual engine `bank_template_import_authorization` and default-template entry own scope; generic `_submit_async_operation`
  records admission. Context emission adds only task-owned initialization ID. Nested synchronous execute_task carries the
  actual operation while retaining the foreground writer's revocation; async workers retain their own registered ID.
- Ledger included in native backup, capability columns/immutable trigger inventory and full auxiliary baseline.
  `capture_unused_scope` delegates async/history checking to provenance validation.
- Canonical wire structs are unchanged, table names are open strings; no SDK regeneration currently necessary.
- Fixture `tests/native_results/taki_character_template.json` generated from real Taki `loadTakiBankTemplate`.
- Real PG red `7f8cc81af5820c53` (actual mock refresh completed, unused refusal), then `w2-checker-template-first.log`
  reports 1 passed/12.39s with source_query refresh + retained model history + directive and actual unused proof.
- TODO: strengthen provenance regression matrix and realistic backup/restore; scrutinize implementation for gaps and style,
  then root/native checks. Default template mixed with a different Taki template must remain a truthful refusal if provenance
  cannot justify it, not silently clear usage or invent birth.

## Remaining whole-W2 review

Already source-reviewed owner/storage/context/writers, full migration, maintenance/store/certificate/rebind, delta service,
preflight/models/application and first half of delta rows; actual B3 template/import/worker chain and restore helper.
Need finish native rows, verify actual wrapper inventory/auth/capabilities, Core/Shared strict client/proof/error paths,
SDK backward independence/source naming and test gaps. Implementer completed prior W2 legacy/SDK/generation gates; do not
rerun unrelated W0/W1. Source/read-source baseline preserves preexisting 27 full-native ty diagnostics and unchanged format
quirk; use non-mutating/scoped checks. Update specs/design, final preservation/current ownership hashes (retain old reports),
and deliver `w2-independent-check.md` with concrete fixes, exact new results, limits and gate disposition.

## Update at 21:20 (latest)

- Native initialization matrix first run had 13 passes/one test bug: compared internal FK trigger OIDs across two
  schemas. Corrected to compare the target's modes before/after its own restore. Production restore was already correct.
- `2ac2e83b87145e94`: 54 passed/388.34s/exit0/stopped. Includes initialization complete/pending/failed, same-template
  retry, missing admission/completion/history events, extra/foreign model/history/template/refresh, retain then clear,
  concurrent ordinary admission, all-column true initialization backup/restore, origin/history immutability, original
  fences/unused/integrity/backup/admin restore. Whole template import now holds one writer across every await/child.
- Added precise Core client claim attempt/revision/generation and resolve submitted-decision response checks, plus
  corresponding 4 regressions. Core 4 files/39 passed. Native claim replay now checks a true previous-generation
  takeover rather than treating any revision+1 phase change as a claim. Fence regression covers same-old-attempt refusal.
- Root `pnpm lint` and `pnpm typecheck` both exit0; logs `w2-independent-{lint,typecheck}.log`. No Core changes since.
- Found/fixed ID-discovered writer gap: delete_memory_unit without explicit Bank, and bulk delete_memory_units now
  authenticate, discover immutable Bank membership, register sorted per-Bank writers, retain them through the original
  atomic bulk transaction and actual post-commit graph/consolidation children. Context carries additional per-Bank
  identities; SQL `transition_write_permit` selects the exact identity. Nested callbacks reuse it, never mint a new writer.
  Invalid UUID and empty-input behavior still delegates to the original pre-auth validation.
- `c849124808c39320`: 16 passed/123.43s/exit0/stopped. New two actual single/bulk delete PG tests pause after COMMIT,
  prove each Bank refuses final fence until graph children finish under accepted parent identity, then prove old children
  cannot enqueue after source abort/resume. Also original fence/unused tests; the unused journey now actually activates
  then refuses both original normal writer and old transition executor queue admissions.
- Capability checks now cover ledger plus missing consumed writer/request columns, exact trigger function OID bindings,
  and nested SQL function presence (new renamed-helper regression). No public schema changes; canonical OpenAPI/SDK bytes
  still untouched. e30 downgrade also refuses retained initialization ledger.

Remaining: final scoped native tests for new helper dispatch, original template API/validation, updated auth/ID behavior;
actual HTTP->Core regression for changed claim/resolve adapter; native final Ruff/ty; final spec/design/docs/hash artifacts
and report. No open product blocker; these execution gates are still pending. Root and native original data untouched.

## Final update: independent W2 PASS

All wave work is complete; read `w2-independent-check.md` for the final disposition, fixes, commands and limits.
Do not rerun tests or start W3 from this checker. Parent owns advancement.

- `17a70c72e9936de9`: original-template/init/delete validation compatibility, 54 passed/258.14s/exit0/stopped.
- `af40244a2b5c5651`: proof/delta/recovery/API/integrity, 35 passed/380.28s/exit0/stopped. Added duplicate-running-verify
  refusal before a second pass, with exactly one execution and unchanged sealed proof recovery.
- Parent identified a second-discovery race in ID-only deletes. Final transaction now checks actual Banks against
  the closed admitted set (even initially empty); SQL and nested child calls refuse missing membership. Two tests
  insert a target ID through another connection between real discoveries and prove no rows were deleted.
- `7cf21fcc2931a9b5`: final membership/definition/template checks, 9 passed/53.24s/exit0/stopped.
- Initial HTTP `7215ae87ed9b` 2 passed/39.11s proved Source projection and Python-native recovery only. Parent correctly
  noted it did not execute changed Core claim/resolve. Updated `research/validation/w2-projection.fixture.ts` so the
  real Core client owns claim, verify, old-executor refusal and exact new decision; Python only prepares/checks storage.
  Final `739ff8e3adc9`: 1 passed/22.99s/exit0/owned stopped+cleaned, zero repeated native maintenance.
- Final native Ruff passes; format passes 782 files excluding the original unchanged curation-test discrepancy.
  Scoped transition types and final changed memory_engine/Postgres/context/writer modules pass. Full ty remains exactly
  the 27 original Windows/MLX/Unix-resource diagnostics. Root lint/typecheck remain green.
- OpenAPI-only canonical regeneration `dcc5d19657d9` is byte-identical to `fe0f1f29...185`; four SDKs and wrappers are
  unchanged. No need to repeat their already accepted generation/build suites.
- Final native ownership 138 paths. Original 205 dirty files: 179 unchanged, 26 explicit W2 extensions, none missing.
  The extra original path is api/http.py for actual template provenance. Protected control-plane CLI hash unchanged.
  Historical implementer manifests retained separately; final hashes and checker-only delta are updated in the reports.
- No current test process/fixture remains running. No user data/service/dependency/Git/task lifecycle action occurred.
