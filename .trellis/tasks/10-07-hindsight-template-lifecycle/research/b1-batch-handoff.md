# B1 batch handoff

Status (2026-10-08): **B1 implementation and self-checks are complete; both implementation owners have released
their source/test scopes. Execution is stopped at the owner's requested batch boundary.** Root verified the
handoff identities and actual check results. Independent B1 review remains pending; whole Stage 5B is not accepted.
Do not automatically dispatch another checker, B2, B3, C1 or new research. Resume only when the owner continues.

## Accepted predecessor

Stage 5A configuration observation independently passed its bounded automated/isolated-fixture acceptance.
R1 Secret Catalog ABA invalidation and R2 lazy compatibility initialization were corrected and independently
rechecked. Read the sibling task's `research/independent-check.md` for exact evidence and platform limits.
No original/installed/manual acceptance or complete Stage 5 acceptance is implied.

## Current batch and evidence sources

| Owner | Scope | Final evidence |
| --- | --- | --- |
| `/root/stage5a_implement` | Complete: B1 Shared/Native contracts, bounded hashing, authenticated snapshot/apply/result/refresh-result, additive Native storage, stable refresh admission/execution/result guards, initialization proof, compatibility and generation. | `b1-implementation.md`, `b1-final-source.json`; final checks complete and ownership released. |
| `/root/stage5b_composition_implement` | Complete: new Core template-lifecycle catalog/user/base/ownership/composition/preview/storage modules, additive 058 and registry tests. | `b1-composition-implementation.md`; final Core types/lint, 5 files / 40 tests pass. Source released. |

Both exclude B2 runtime/orchestration/policy and Home. Preserve W9, 5A, all old migrations/receipts and unrelated
working-tree changes. The post-5A baseline is `pre-b1-baseline.json`; Core's assigned-path baseline is
`b1-composition-baseline.json`. Root-owned planning/HANDOFF changes are intentional concurrent artifact edits.

Root read the final Core logs and verified all 25 owned files plus the 3 consumed Shared files against
`b1-composition-final-source.json`; see `b1-core-handoff-verification.json` (zero mismatches at handoff).
The 40-test final run supersedes earlier 38-test evidence and includes the external-label preservation fix.
This is identity/evidence readback, not the deferred independent B1 code review. No full Core suite is claimed.

## Delivered behavior and self-checks

- Core separates immutable v2 template revisions from explicit user revisions, captures real before-images and
  ownership, produces pure exact previews and persists receipt-validated selections/defaults through CAS.
  User choices, complete user resources and unrelated label groups survive Taki removal. Old v1 stays unchanged.
- Native authenticates namespace/Bank/action/field access, reads coherent snapshots and atomically applies one
  Bank's definitions, logical events, fixed refresh children and receipt. Receipt-first replay recovers the original
  result. Final writer guards refuse stale authority or leases before commit.
- Refresh uses durable Sync/Worker claims and exact definition/object guards before provider work and publication.
  Content, history, logical events and the child result marker commit together; crash recovery observes that result.
- Additive storage is Core 058 and Native `e51c2f9a8b43` after `e40b1e8a7d32`. The exact new build is
  `taki-memory-hindsight-0.9.0-template-lifecycle-v1`; older build support and required contracts remain.
  Label/backup wire shapes are present, but their actual producers/consumers remain B2/B3 work.

| Check | Verified result |
| --- | --- |
| Shared suite | 66 files / 565 tests passed. |
| Core affected integration | 9 files / 66 tests passed, including the released 40-case composition/storage slice. No full Core run claimed. |
| Workspace types / root lint | All five workspace typechecks and root ESLint exited 0. |
| Native isolated matrix | 35 passed / 2 test-side failures, followed by test-only corrections and 3/3 targeted passes. No clean full matrix rerun claimed. |
| Native static checks | Ruff passed; affected 19-module Linux-target ty passed. Full-package Windows ty retains 27 existing platform/optional-dependency diagnostics. |
| Maintained SDKs | Python 103, Rust 12 across five binaries, TypeScript build plus 12 suites / 45 tests, and selected Go offline contracts passed. |
| Canonical generation | Correct-input runs 03 and 04 both exited 0; all 906 generated/preserved artifacts are byte-identical. |

Counts overlap and must not be added. Native failures were the quoted-SQL fault injector and old manifest
expectations; the targeted rerun proves rollback at all five injected publication boundaries. The first positional
claim-call correction, wrong-input/failed generation attempts and SDK fixture correction remain recorded in the
implementation report. No original deployment/data or real model calls were used. The long typecheck wall-clock
interval is retained as recorded and must not be interpreted as a performance measurement.

Correct canonical OpenAPI SHA-256 is
`8d49efa07c17b9694354259ac9e7795a8c0c824ec6a7b0119947d85f791b012f`.
Python/TypeScript/Rust outputs match the tested identities. Only Go changed during complete canonical formatting;
its final offline contracts reran with `-count=1` and exited 0. Old-input run 01 and failed run 02 are not repeatability evidence.

## Final identity and resource handoff

`b1-root-handoff-verification.json` records root's final readback: all 101 Taki and 201 Native files in the released
manifest match, as do all 25 Core files, three Shared consumers and 906 generated artifacts. These source inventories
include preserved preexisting work, not 302 newly changed B1 files. Both repository HEADs remain unchanged.
The final source manifest SHA-256 is `0035fe442960cdf5083985f3d1216b1d02b10aaa0adf86ecd93ef22b9a5fb567`.
All 76 retained evidence identities matched before this leader-owned stop-state update; this handoff file then
intentionally changed. The immutable implementation source and other retained evidence were not edited by root.
The logical Rust build key resolves through `pin-b1-generated.py`, not a literal `rust-build/` source directory.

Existing W9/5A work and old migrations are preserved, with the intentional B1 integration deltas enumerated in
`b1-implementation.md` and the manifest. Legacy v1 still has SHA-256
`9d1f05100444af6c03f319df98cb04bfcf5bfe2504d0c059f2731ee531346952`.
Both repositories' whitespace checks and owned-source UTF-8/no-BOM checks passed.
All four owned Native fixtures have stopped/dataRemoved/registryRemoved true in `b1-fixture-cleanup-final.json`.
Both implementation owners report all test/generation sessions returned; the live agent list has no running child.
Root performed evidence/identity handoff checks only, not the deferred independent B1 review.

## Required follow-up after the owner resumes work

1. **Independent B1 review.** Review the combined final Native/Shared/Core delta using `review-plan.md`; verify
   authentication, composition/preservation, real PostgreSQL rollback/concurrency, receipt-first replay,
   Sync/Worker claim and result ownership, migration/pristine proof and generated compatibility. Owner self-checks
   are evidence for this review, not its replacement. Fix actual findings before B2.
2. **B2 Core lifecycle and policy.** Add the durable operation executor/CAS/lease and unpublished-effect hold,
   fixed-Bank rollout/recovery, exact final selection publication, runtime/custody admission and binding-only
   recovery. Deliver actual structured per-fact provenance sidecar and exact-version trusted policy consumption.
   Then run the focused runtime/recovery/policy independent check.
3. **B3 Home and paired restore.** Add operator preview/apply/customization/removal/recovery flows, two-observer
   reconnect behavior and truthful derived state. Complete managed-template backup equality and new-table/receipt
   accounting, customized/removed-overlay restores, generation and full-slice checks. Only then assess whole 5B.

## Prepared later work (not implemented)

- C1 `10-07-hindsight-managed-host-custody` remains planning. Its independent design review passed all six
  engineering corrections with exact artifact hashes in `stage5c-c1-readiness-review.md`; contexts have 18 entries.
  C1a installs/validates the real helper/Host/custody path; C1b proves the fake-secret process protocol. C2a must
  pass actual isolated Docker confidentiality/restart proof before real delivery or trusted deployment receipts.
- `stage5d-candidate-dependencies.md` establishes C1-C3 -> D1 isolated candidate/same-version restore -> C4 full
  re-embedding -> D2 migration/publication/recovery. Ordinary portable Bank import is not a complete clone, and
  the Stage 3 exact original-version restore gate must not be weakened for upgrades.
- The parent `stage5-execution-map-2026-10-07.md` retains 5E and Stage 6 boundaries. No subsequent dispatch is
  authorized in this run. Original deployment/data, real models, new dependencies and Git lifecycle stay separate.

## Stop-state checklist

- [x] Both current implementation scopes complete and release source/test ownership.
- [x] Actual self-check commands/results, limitations and fixture teardown verified from retained evidence.
- [x] Final changed-path/source identities and existing-change preservation recorded.
- [x] Root summary updated to distinguish B1 implementation from pending independent acceptance and remaining 5B.
- [x] No owned process or child task is left executing work after the requested stop.

Keep the task unarchived and in_progress. Do not commit, push, finish or mark the whole PRD complete at this batch boundary.
