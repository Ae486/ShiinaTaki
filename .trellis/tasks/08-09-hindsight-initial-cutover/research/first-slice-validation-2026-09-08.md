# B4 current Local coverage and source evidence - validation (2026-09-08)

The approved first slice is complete and independently reviewed. The final recursive run passed all 3168 tests;
five-project typecheck, lint, isolated native Core startup and the 60-file encoding/index/diff audit passed.
Full B4, B6/B7 and live/manual acceptance remain open.

## Checkpoints and ownership

- Taki G1/B5 baseline: `dd2e15b98b6661a01b1f951cfb85f718f2aea75d`, created under the owner's checkpoint approval.
- Paired Hindsight checkpoint: `8ab65b4c2ea238223eeef84cbdcc012ca7601e86`, created in the earlier approved provider step.
- This first slice changes Taki source/tests/specs/task records only. Its changes are not committed or pushed.
- Active task remains `.trellis/tasks/08-09-hindsight-initial-cutover`, `in_progress`; no finish/archive occurred.
- No user database, `.env`, protected B2 backup, other-worktree filesystem or live Hindsight/model endpoint was used.
- After process interruption, the final data reviewer was resumed and confirmed that its last immutability/readback
  review had finished with no additional edits or new in-scope findings. Completed work was preserved.

## Delivered behavior

| Slice | Implemented result | Main verification |
| --- | --- | --- |
| Applied migration histories | 036 converges main Pending Memory 035 and T4 Timeline presentation 035; 037/038 add independent B4 storage | Real-file fresh/034/main035/T4035/both-history reopen; prior Timeline/Pending/receipts and sequence watermarks preserved |
| Current Local coverage | Immutable versioned full-state manifest, actual B2 comparison, explicit new/changed/missing/unproven entries and lease-owned selection | Real Local retain/edit/invalidate/restore, policy/provenance, Bank, lineage, derived/Block and missing-record tests |
| Actual cutover refusal | Create/capture/status/verify/readiness/promotion use current coverage; final acceptance reserves the SQLite writer before reading | Stale/missing/unproven coverage and two-connection races refuse without changing Local authority |
| Reversible preparation | Real persisted Local source and separate records produce durable typed evidence and a versioned native item or explicit gaps | Seven Core integration tests cover source/unit type separation, retained source, stale versions, invalidation, missing text, reopen and rollback |
| Confirmed projection | Real repository validates full G1 results and parsed snapshot/journal observations before exact native-version bindings | Typed metadata, namespace/revision/hash/layer refusals, native field ownership, actual seed/reseed, tombstones and lost evidence |
| Local/native identity | Source confirmation and promotion share the real Local-scope to verified B3 Bank mapping | Ten mapping tests including distinct IDs, missing/unverified bindings, wrong scope and empty Bank sets |

The preparation entry is `packages/core/src/memory/hindsight/hindsight-current-local-source.ts`.
The executable contract is `.trellis/spec/backend/memory-local-cutover-coverage.md`.
Source evidence remains durable Taki provenance when replica rows are rebuilt; it is not a second writable Memory
Authority and is not a disposable cache.

## Review findings and fixes

| Finding | Fix and evidence |
| --- | --- |
| COMMIT failure decremented transaction depth twice and attempted the wrong rollback | Capture the parent boundary until commit/rollback completes; real deferred-FK tests verify no DDL, receipt or row survives |
| Catching an inner SQLite whole-transaction rollback allowed a later write to auto-commit | All wrapper SQL entry points reject work until the aborted outer boundary unwinds; six execution paths failed before the fix and pass afterward |
| `table_xinfo` cannot prove the absence of CHECK/UNIQUE/FK/COLLATE constraints | Bare-TEXT declaration and native constraint checks conservatively reject incompatible or unrecognized shapes |
| `INSERT OR REPLACE` bypassed manifest UPDATE/DELETE immutability guards | BEFORE INSERT checks cover every unique collision key; all three manifest replacement regressions went from red to green |
| Equivalent confirmation through a new snapshot ID/cursor conflicted with the first saved binding | Compare semantic source/native/result identity while preserving the first observation receipt; different evidence or operations still conflict |
| Promotion compared Local Bank IDs directly to native Bank IDs | Shared verified Bank binding reader is reused for the complete native set and source confirmation |
| New temporary-file tests lacked explicit cleanup path checks | Validate resolved parent and owned prefix before recursive cleanup |
| Two old tests pinned a migration tail ending at 035 | Update the expected 038 tail; retain their actual replica/checkpoint/Pending/Character preservation assertions |

The independent migration/transaction review passed 82 tests across five files. The independent data review passed
83 focused tests across seven files and completed a final immutability/readback audit. These focused sets overlap
with the package suites; they are not added to the package totals.

## Final quality gates

| Command / scope | Result |
| --- | --- |
| Shared package suite | PASS: 47 files, 404 tests |
| Core package suite | PASS: 310 files, 2169 tests; final recursive run, 51.51 seconds |
| CLI package suite | PASS: 8 files, 47 tests |
| Desktop package suite | PASS: 103 files, 548 tests |
| `pnpm -r --workspace-concurrency=1 test` | PASS: all four package suites, 468 files and 3168 tests; e2e has its separate opt-in test command |
| `pnpm -r typecheck` | PASS: Shared, Core, CLI, Desktop and e2e |
| `pnpm lint --ignore-pattern '.backup-memory-legacy-migration-live-20260821-01/**'` | PASS: zero errors; one unchanged unused `max-lines` disable warning at `packages/core/src/db/run-repo.ts:6` |
| Native Node Core startup | PASS: listening, all migrations 1..38, zero external Provider requests, zero Pending/activation receipts |
| Task context validation | PASS: 17 implement and 15 check entries; no injection truncation warning |
| Final diff / UTF-8 / source-index audit | PASS: 60 changed/new files, no BOM/trailing whitespace/missing source headers or folder-index entries; historical 035 and frozen G1 producer files unchanged |

### Initial full-run failures

The first `pnpm -r test` run passed Shared/CLI/Desktop but failed Core with two old migration-array expectations and
one 15-second timeout in the unchanged ZIP test in `skill-package-source.test.ts`. Both expected migration tails were
corrected; their 26 focused tests passed. The ZIP file then passed all 16 tests alone (904 ms test execution), and
the entire Core suite passed all 2169 tests with the original timeout and source unchanged. No ZIP root cause is
claimed proven. The final aggregate invocation runs packages sequentially to avoid repeating the initial concurrent
package load; it keeps every test and assertion enabled.

### Isolated startup details

The native `node packages/core/src/main.ts` child used a fresh owned temporary data root, an ephemeral loopback WS
port and an owned loopback dummy provider. It inherited only basic OS/path variables and explicit dummy model
settings. It did not load `.env.local` or real provider credentials. Hindsight and ambient capture were disabled.

- Startup reached `ws server listening`; migrations were exactly 1..38.
- Timeline `presentation` was ordinary nullable TEXT, without a default, primary-key or hidden-column flag.
- `pending_memory=0`, `hindsight_authority_activation_receipts=0`, initial selection `legacy-markdown`.
- Dummy provider request count was zero.
- Owned child PID 43136 exited by SIGTERM. This proves startup, not graceful shutdown.
- Child, SQLite inspection handle, port probe and dummy provider were closed; the validated owned temporary root
  was removed. No user data path was involved.

Local execution logs and startup result are under `.trellis/.runtime/b4-execution/058d1247aca2/`; they are ignored
runtime artifacts, not a dependency for the portable code/tests or this result summary.

## Boundaries still open

1. **D78 - complete current-version import and independent maintenance proof.** New/current Local sources and
   revisions must be dispatched from the selected prepared identity, mapped and reconciled through actual native
   operations. Old B2-only receipts cannot discharge the new catch-up set. The old `requireImportBanks` rule also
   needs replacement so an empty verified Bank does not require a fabricated historical source operation.
2. **D77 - complete provider-only fidelity and later native-edit rebinding.** If all Taki source evidence is lost,
   current Hindsight snapshots alone cannot reconstruct every original typed field/provenance. Native unit map/layer
   mismatch is a refusal, not a guessed projection. Version-1 unit associations are explicit and one-to-one; a
   source-to-many extraction does not automatically prove per-unit policy/metadata ownership.
3. **B6/B7 and real acceptance.** Production runtime recall/tools/Local maintenance, operator UI, planned switch-back,
   emergency takeover, real model calls/user-data import and owner-confirmed manual acceptance remain separate.

Missing or unproven coverage intentionally prevents readiness/promotion. No actual Authority Epoch was changed by
this work. The existing full-task acceptance checklist remains open even when this offline first slice is complete.
