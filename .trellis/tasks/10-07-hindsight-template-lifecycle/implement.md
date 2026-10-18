# Stage 5B implementation and review plan

Current status (2026-10-13): **Stage 5B isolated automatic acceptance PASS**. All eleven PRD automatic
criteria and the final source/check/cleanup reconciliation pass. Read
[the acceptance report](research/b3-whole-acceptance.md), `research/b3-whole-source-readback-01.json` and
`research/b3-whole-handoff-readback-01.json`. Core coverage combines the unchanged 516 passing files with
complete reruns of the six corrected files: 522 files, 4108 passed and one Windows-inapplicable skip.
The original full-suite failure is retained; no new complete 522-file execution is claimed.

Both independent reviewers and all checks have completed. The existing task remains `in_progress`, bound to
`codex_01a1309f-e374-7241-ab38-4e50f040d985`, uncommitted and unarchived. Stop before 5C. Installed/manual and
original-environment acceptance remain separate; no further automatic gate or development dispatch is pending.

## Historical checkpoints

The following execution and pause records are retained as history; the accepted status above supersedes them.

Historical recovery (2026-10-12): the owner requested recovery and continuation of the interrupted approved work.
The existing task is bound to the new session; source continuity is verified. Follow
`research/b3-recovery-2026-10-12.md` for current failures, ownership and gates, while retaining the approved
`research/b3-resume-plan-2026-10-11.md` scope. Whole 5B remains unaccepted; stop before 5C.

Historical continuation (2026-10-11): 2026-10-11 owner approved resuming after the readiness assessment. The 2026-10-10 pause is superseded. Reuse this task, complete remaining Core matrices and nonempty joint restore, independent Core/Native review and whole-5B automated gates, then stop before 5C. Read research/b3-resume-plan-2026-10-11.md. No original environment, new dependency or Git lifecycle work is authorized.

Historical execution (2026-10-09): B2 combined independent review PASSES in `research/b2-independent-review.md`.
Root verified 2994 current source/input/generated/evidence paths without mismatch. B3 is now released to the
original Core/Shared, Native and Home implementers under `research/b3-dispatch-plan.md`; Core publishes the common
wire/hash fixture first. Complete B3 and the whole-5B independent gate, then stop before 5C. Historical checkpoints
below remain evidence, not current pause instructions. No Git lifecycle or original-environment work is included.

Historical continuation (2026-10-09): the owner approved resuming. Root reverified all released sources and inputs.
Independent B2 Core review now follows `research/b2-core-review-dispatch-2026-10-09.md`; reconcile it with the
accepted Native/label scope before B3. The stop checkpoint below is historical. Complete 5B before stopping;
5C, original services/data/models and Git lifecycle remain outside this scope.

Historical stop point (2026-10-08): the owner requested completion of the two existing agents followed by a pause.
Core B2 implementation/self-check and Native/seven-file-label independent review are complete and released.
Read `research/b2-batch-handoff.md`. No agent/check is running. Core independent review, the combined B2 gate and
B3 remain pending; do not dispatch them until the owner resumes. The older milestone history below is retained.

Historical status (2026-10-08): B1 combined independent review PASSED, with a verified current-source baseline in
`research/b1-reviewed-source.json` and acceptance in `research/b1-independent-review.md`. Resume the original
Core and Native implementers for B2 under `research/b2-dispatch-plan.md`; B2 and B3 acceptance remain pending.
The Core label consumer and actual Native HTTP/SQLite integration fixture now have a third disjoint implementer;
the original Core owner retains lifecycle/runtime/Shared and wiring. B3's source-grounded proposal is complete,
with root decisions in `research/b3-dispatch-plan.md`; its implementation still waits for independent B2 acceptance.
Native/label independent review may start after their complete source/self-check release while Core lifecycle
implementation and tests continue in disjoint files. The final Core review and source reconciliation remain required
for the combined B2 gate. Read the current cadence in `research/review-plan.md`; a partial pass never starts B3.
`research/resume-review-plan-2026-10-08.md` retains the resumed review cadence and serial heavy-check policy.
See `research/b1-batch-handoff.md` for B1 release evidence and limits. 5A independently passed before B1.

## Readiness

- [x] Reuse existing B7 scope, user precedence, C16 taxonomy and Stage 6 boundaries.
- [x] Complete current Native/Core research and definition-only/stable-refresh follow-up.
- [x] Draft PRD/design with exact ownership, CAS, recovery, user preservation and derived-state boundaries.
- [x] Independent design review identifies seven concrete engineering gaps; bounded resolutions, limits, hashing,
      refresh claim/result guards, durable hold and provenance/backup/initialization proof are incorporated.
- [x] Independent bounded confirmation accepts the seven resolutions; leader applies and verifies its sole final
      correction: Taki label removal preserves surviving user overrides before restoring inheritance.
- [x] Recheck post-5A source and migrations/build identities; freeze compatibility/schema owners.
- [x] Curate and validate implement/check manifests; split oversized research into untruncated source excerpts.
- [x] Readiness review and 5A source/check release complete; activate this existing child for B1.

Pre-B1 readiness baseline: Taki HEAD `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`, Core migration registry ended at 057;
Native HEAD `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`, sole static migration head `e40b1e8a7d32`, current
build `taki-memory-hindsight-0.9.0-config-observation-v1`. Delivered B1 source adds Core 058, Native
`e51c2f9a8b43` after e40 and build `taki-memory-hindsight-0.9.0-template-lifecycle-v1`.
Both repository HEADs remain unchanged; curated contexts and old migrations are preserved. B2 reserves Core
059 and Native e62a3d0b9c54 after the freshly rechecked e51 head; do not modify recorded migrations.

## Ownership and order

One Native/Shared owner controls Native migrations, compatibility, refresh, strict wire and generation. After the
B1 Shared shapes stabilized and Shared typecheck passed, a disjoint Core composition/storage owner was assigned
the new `packages/core/src/memory/hindsight/template-lifecycle/` directory, Core 058 source/tests and migration
registry/index files. Its scope excludes B2 runtime/operation executor and Home. Coordinate frozen interfaces and
serialize heavy tests. B2 operation/publication/policy integration remains assigned only after the B1 check.
A separate Home owner is useful only after the complete strict Shared/runtime contracts stabilize.
No concurrent modification of the same generator/manifest/Shared/boot files. The leader controls
task lifecycle and acceptance, and may reuse agents after handoff. Do not spawn nested implementation/check agents.

1. **B1: composition and atomic Native application.** Add independently versioned catalog/user/before-image models,
   pure composition/preview, strict Native/Shared lifecycle contracts, additive receipt storage and coherent
   snapshot/CAS. Implement definition-only SQL changes, logical events, stable optional refresh admission and
   exact replay, persisted Sync/Worker claims, apply-time definition/object guards and atomic child result markers.
   Add genuine definition-installed initialization proof and label/backup evidence wire shapes early. Preserve legacy
   v1 and existing API methods. Run migration/auth/rollback/concurrency/composition
   tests and canonical generation. Pause source ownership for a targeted independent transaction/auth review.
2. **B2: Core lifecycle, runtime and taxonomy.** Add the existing-operation adapter with explicit durable executor
   CAS and unpublished-effect hold, fixed Bank rollout/recovery, quiescence, exact final publication guard and
   selected-overlay runtime admission/provisioning. Add the server-owned structured-label sidecar producer,
   exact-version invalidation/read and trusted consumer, plus original-job recovery. Cover source custody, partial
   multi-Bank commit, failed/unknown terminalization plus restart, lease expiry, no-overlay and old v1 paths.
   Review cross-layer transaction/rebind/policy results before treating the producer as complete.
3. **B3: Home, backup/restore and whole-slice closure.** Complete operator preview/apply/customization/removal,
   two-observer/reconnect outcomes and derived-state display. Add backup table/receipt accounting and isolated
   customized/removed-overlay restore tests. Run consolidated affected-package/type/lint/build/generation gates
   followed by one independent full-slice review of all B1-B3 changes.

Every milestone includes relevant tests while implementing; these review boundaries are based on persistent
mutation and recovery risk, not number of functions. Reuse unchanged passing evidence, but rerun changed
compatibility/boot/refresh or transition-adjacent behavior. Do not run a full Core sweep after every small edit.

## Verification

Inspect package scripts and current specs for exact commands. At most two Vitest workers and one heavy suite
at a time. Native fixtures are isolated; external model/embedding calls use fakes or fail-on-call traps.

- Pure composition: explicit equal-to-old values, suppression, inheritance, unrelated labels/resources, user
  resource completeness on Taki removal, empty tags, triggers and duplicate/colliding resource identities.
- Native actual route: authentication/schema/Bank/field validators; coherent snapshot; every fault inside commit;
  one winner for overlapping effective mutations (independent no-ops allowed); same-ID/cross-target/hash mismatch;
  one durable child; lost notification. Read-only preview/result must not ensure missing identity state.
- Derived job: no provider work at definition commit, ungenerated vector-search behavior, existing full/delta
  refresh, expected-definition checks before generation and publication, same-child crash retry, no billing guarantee.
- Core: operation exclusion, active Run/source drain, partial Bank application, exact lease/revision/epoch/config
  guards, restore/restart/lost response and post-commit binding-only recovery. No remote I/O inside SQLite.
- Taxonomy: both real Native extraction paths with fake providers to replica/binding/policy; exact object labels,
  server-owned structured provenance despite caller content-wide entity/tag injection, exact-version invalidation,
  neutral fallback, pinned/mood-gated rejection and preservation of original/curated policy.
- Backup/migration: fresh/historical/reopen, native table parity and receipt-map validation, customized/removed
  paired restore with managed-state equality independent of ordinary Native-ahead cursors, pre-Core/post-Native
  mismatch, transition return/reentry and exact definition-only pristine initialization provenance.
- Home: real operator dispatcher/client/controller/DOM, preview effects, failure/partial/stale/conflict/unsupported,
  two observers/reconnect; reads never write or refresh a model.
- Canonical OpenAPI/all maintained SDKs, old/5A/new build compatibility, mandatory capabilities, whole-manifest
  stale-preview rejection and fresh preview success. Appropriate package types, root lint and Desktop build.

Record commands/exits/counts/source hashes and fixture teardown in task research. Do not call stage-wide C16/C11
or installed/manual acceptance complete from only this slice. No original data/services/grants, paid/model calls,
new dependencies, destructive repair, commit/push/finish/archive are included.
