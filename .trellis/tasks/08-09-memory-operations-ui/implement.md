# Memory Operations and Setup - Draft Execution Plan

## Current execution order (2026-10-07)

Read the [current execution/review map](research/stage5-execution-map-2026-10-07.md) for live 5A/5B ownership,
5C risk milestones and the populated-model/candidate dependency refinement. It supersedes older scheduling below.

The old numbered checklist below is historical and must not be dispatched directly. Current order:

1. Complete the [Stage 4 W9 correctness gate](../09-29-hindsight-transitions-emergency/research/stage4-w9-lease-plan-2026-10-07.md)
   under its existing task and independent review. This is not a performance optimization project.
2. Refresh this B7 task's remaining Stage 5 requirements/design and configure current spec/research manifests.
   Treat the Stages 1-4 operation/lifecycle/backup/transition implementations as dependencies already delivered.
3. Ground a first independently testable vertical slice from actual remaining capabilities; review its artifacts
   before activation and `trellis-implement` dispatch. Model fields or managed receipt schemas alone are not producers.
4. Sequence remaining templates/model/deployment, candidate upgrade and full Home/admin work by real dependencies,
   including D88/D90 safety gates. Keep Core/runtime/migration ownership serial.
5. Perform Stage 6 integrated/package/environment and owner/manual acceptance separately. Preserve D23/D79-D83
   deferrals and do not mark original-data/credential acceptance from fixture tests.

W9 passed independent acceptance on 2026-10-07. The owner has now approved the presented Stage 5 plan,
including the first bounded configuration observation slice, and delegated implementation/check scheduling.
The 5A child independently passed and released all ownership. The reviewed 5B child is active with one B1
Native/Shared/Core implementation owner; a separate read-only reviewer prepares the C1 custody boundary.
Use the [current-source readiness report](../09-29-hindsight-transitions-emergency/research/stage5-readiness-2026-10-07.md)
for the proposed 5A configuration evidence, 5B overlays, 5C managed/model application, 5D upgrade and 5E full Home
and administration sequence. Each slice needs its own concrete contract/acceptance review before dispatch.
The [5A child](../10-07-hindsight-configuration-observation/implement.md) passed permission, disclosure, runtime
truth, stale-read, compatibility and UI checks. Follow the [5B implementation and review plan](../10-07-hindsight-template-lifecycle/implement.md)
and its `research/review-plan.md` for B1/B2/B3 boundaries. Later grouping depends on concrete complexity and ownership.

Status: planning. Follow [design.md](design.md) and [prd.md](prd.md); no B7 production code has been changed.
The owner approved B6 closeout before B7; [bounded B6 verification](../08-09-memory-runtime-integration/research/b6-closeout-validation-2026-09-13.md)
is now available. The previous R1 premise is withdrawn; [grill.md](grill.md) records the accepted continuation contract,
actual implementation gaps and accepted U1. Do not start implementation from this draft.

2026-09-19 current direction: grill is conditional on major unresolved requirements; no currently known owner
question blocks continuation. Follow the [overall review](../09-14-hindsight-integration-completeness-audit/research/overall-grill-2026-09-19.md).
Stage 1 is committed/archived; reuse its operation owner and Home card. Resume the existing Stage 2a research/planning
task and complete its artifacts/readiness review before implementation. Older grill-first sequencing below is historical.

2026-09-18: the [current-code recheck](../09-14-hindsight-integration-completeness-audit/research/source-recheck-2026-09-18.md)
is recorded. The owner is still discussing overall gaps/closure; resume the interaction grill only after that discussion.
This update records source findings, not implementation approval or completed product acceptance.

## 1. Complete the existing design gate

- [x] Inventory actual producers, registered RPCs and Home seams using the current main worktree.
- [x] Re-read existing designs and grills; apply the verified-baseline/mapping/change-reuse rule to repeated switching.
- [x] Complete the owner-requested integration completeness research before further interaction questions; include all
      accepted parent requirements and memory-related multi-endpoint use, with implementation/reachability/acceptance evidence.
- [x] Review the overall gap/closure findings; no currently known owner question blocks continuation.
- [x] Record U1's single-confirmation selection and withdraw G1's premature administration choice. Reopen grill only
      if a material unresolved product issue emerges; remaining engineering prerequisites are still required.
- [ ] Specify and independently verify the missing backend transition prerequisites before advertising working UI actions.
- [ ] Ground incremental re-entry, managed helper/backup commands, provider-side fence/drain proof and dynamic runtime replacement against
      actual source; record exact contracts and refusal boundaries in `design.md`.
- [ ] Review the complete design and execution plan, curate context, then start this existing B7 task.

## 2. Operator status and durable operation foundation

- Add strict Shared contracts and a narrow facade over the selected live runtime and existing B3/B4/B5/B6 producers.
- Add admitted operation discovery/status/subscription, durable identity and stage-aware cancellation/recovery.
- Preserve native/application/parent-write distinctions, unknown values and existing authority/CAS gates.
- Deliver an initial Home Operations projection with truthful loading, degraded, progress and failure states.
- Verify actual producer-to-RPC-to-Home data, idempotency, lost response, window closure and connection replacement.

## 3. Setup, activation and routine controls

- Connect both setup modes, sensitive secret editing, template preview and explicit model-health actions.
- Wrap current-source preparation/import/verification and first promotion in the durable operator workflow.
- Expose the existing manual sync/full reconciliation/retry producers without a second scheduler or recovery loop.
- Handle orphaned setup and interrupted preparation from durable evidence, preserving remote unknown outcomes.
- Verify first activation refusal until all current-source and final-writer gates pass on isolated data.
- Prove admission/drain coverage for actual Canonical Local foreground/background writers. The existing Legacy fence
  and unused promotion wrapper do not provide that integration; keep DB consistency and runtime drain evidence separate.

## 4. Administrative helper, backup and staged upgrade

- Implement the grounded helper boundary for process/storage/deployment work, with explicit ownership and receipts.
- Produce and validate persistent native/application/control backups, including pending recovery evidence.
- Restore and check an isolated candidate; promote only after compatibility and operational checks.
- Verify failure before promotion preserves the active authority, backup and user overrides; report post-promotion
  failures through the recorded committed state rather than destructive downgrade.

## 5. Planned return, re-entry and emergency takeover

- Complete authority-transition orchestration, provider-side fencing/drain, all-Bank final sync/reconciliation and
  zero-unresolved-write checks. Add the accepted durable queue for writes arriving during the fence.
- Commit the new epoch and replace the runtime while preserving old-reference refusal and original field/provenance
  identity. Test failures on both sides of the commit boundary and exact recovery of queued intents.
- Implement current-Local re-entry using verified baselines, identity mappings and subsequent changes; preserve the
  agreed consumable state and prior epoch history. Verify complete current-epoch change coverage without forging
  first-activation receipts or requiring new Banks/full retransfers by default.
- Implement the separately confirmed emergency path, preserved uncertainty snapshot and foreign-branch behavior.
- Verify representative Local -> Hindsight -> Local -> Hindsight cycles and interrupted transitions on isolated copies.

## 6. Integrated gate and delivery

- Run applicable focused tests, all affected typechecks, root lint and required complete package gates.
- Exercise real Core startup, actual native/helper boundaries and Home key paths; distinguish automated evidence,
  real-model quality, owner/manual acceptance and original-data activation.
- Synchronize executable specs, task notes and the operations guide with actual producer behavior.
- Keep D79-D83 outside this implementation. Do not mark unperformed backup/switch/upgrade/takeover or manual cases passed.
- Do not stage/commit/push/archive or operate on original data as an incidental finish step.

Workstream ownership and migration numbers are assigned only after the design is settled and current workspace,
branch, task binding and migration lineage are rechecked. Shared runtime composition and authority transactions
remain serial ownership; independent UI/helper/test slices may be delegated with explicit file boundaries.
