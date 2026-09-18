# Memory Operations and Setup - Draft Execution Plan

Status: planning. Follow [design.md](design.md) and [prd.md](prd.md); no B7 production code has been changed.
The owner approved B6 closeout before B7; [bounded B6 verification](../08-09-memory-runtime-integration/research/b6-closeout-validation-2026-09-13.md)
is now available. The previous R1 premise is withdrawn; [grill.md](grill.md) records the accepted continuation contract,
actual implementation gaps and pending interaction U1. Do not start implementation from this draft.

2026-09-18: the [current-code recheck](../09-14-hindsight-integration-completeness-audit/research/source-recheck-2026-09-18.md)
is recorded. The owner is still discussing overall gaps/closure; resume the interaction grill only after that discussion.
This update records source findings, not implementation approval or completed product acceptance.

## 1. Complete the existing design gate

- [x] Inventory actual producers, registered RPCs and Home seams using the current main worktree.
- [x] Re-read existing designs and grills; apply the verified-baseline/mapping/change-reuse rule to repeated switching.
- [x] Complete the owner-requested integration completeness research before further interaction questions; include all
      accepted parent requirements and memory-related multi-endpoint use, with implementation/reachability/acceptance evidence.
- [ ] Finish the overall gap/closure discussion using the current-code recheck, keeping backend prerequisites explicit.
- [ ] Then complete the interaction grill, starting with U1's normal switch confirmation flow.
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
