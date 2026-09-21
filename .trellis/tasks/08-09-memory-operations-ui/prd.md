# Memory Operations and Setup UI

## Goal

Make Hindsight setup and ongoing memory authority operations understandable, observable, and safely controllable without making the Home window authoritative.

## Dependencies

- `08-09-hindsight-connection-setup`.
- `08-09-hindsight-initial-cutover`.
- `08-09-memory-replica-sync-recovery`.
- `08-09-memory-runtime-integration`.

## Scope

- Guided managed-local or existing-instance setup with prerequisites, authentication, model, bank, template, and migration preview steps.
- Provider/authority/epoch, health, replica age, checkpoint, pending, failure, and next-sync presentation.
- Manual incremental sync, full reconciliation, retry, backup, and staged-upgrade workflows.
- Planned healthy switch-back to Local and separately guarded Emergency Local Takeover.
- Producer-backed shared/Core status and operation contracts with resumable progress after window closure.
- Secret presence/edit UX that never reads secret values back.

## Acceptance Criteria

- [ ] Setup cannot activate Hindsight before every compatibility, migration, and integrity gate succeeds.
- [ ] Sync remains asynchronous and the UI reports the last attempt and last successful synchronization separately.
- [ ] Closing/reopening Home restores authoritative operation state from Core rather than React cache.
- [ ] Degraded, recovering, stale-replica, superseded-write, and failed-upgrade states have actionable diagnostics.
- [ ] Planned switch-back requires final sync, full reconciliation, zero pending writes, a write fence, and a new epoch.
- [ ] Emergency takeover shows the potentially missing interval and requires explicit confirmation.

## Out of Scope

- Recreating Hindsight Control Plane administration wholesale.
- Storing authority state, migration progress, or secrets in frontend-local persistence.
- Automatic failover or active-active conflict resolution.

## Owner sequencing clarification (2026-09-13)

The owner prioritizes this existing B7 scope ahead of new long-term memory capabilities. Complete the required B7
design/grill before implementation; a planning PRD is not proof of an implemented switching workflow.

The [B6 follow-up inventory](../08-09-memory-runtime-integration/research/memory-capability-followups-2026-09-13.md)
records D79-D83 for after B7. Do not enlarge this task with daily whole-library model review, a new Taki retention
executor, complete derived-policy propagation, expanded curator promotion or speculative latency optimization.
Existing dependency closeout, ordinary policy/field preservation and final synchronization/authority gates remain
required. Display verified limitations accurately instead of implying a stronger derived-visibility guarantee.

The [bounded B6 closeout](../08-09-memory-runtime-integration/research/b6-closeout-validation-2026-09-13.md) is now
verified. B7 remains planning; [design.md](design.md) and [implement.md](implement.md) are drafts for its required grill.

## Grounding correction and implementation prerequisites (2026-09-14)

The previous R1 destination question is withdrawn. The accepted B6 grill already requires repeated provider switching
to reuse verified baselines, identity mappings and subsequent changes while preserving or reconstructing the agreed
consumable state. Re-entry includes all current Local-epoch mutations; it does not require a new Bank set, another
instance, or full retransfer of unchanged data by default.

B7 leads the operations interaction and includes the Core-backed operations required by its original scope. Current
code implements initial promotion foundations and Hindsight-authority checkpoint/Pending recovery, but not complete
healthy return, Local-authority re-entry or repeated runtime handoff. These are explicit implementation prerequisites;
neither B6 closeout nor an available status RPC proves they are complete.

The [grounded grill record](grill.md) maps existing rulings to current source evidence. U1 is accepted: one normal-switch
confirmation, completion after all checks pass, and separate emergency confirmation. The owner's latest direction
makes grill conditional on major unresolved requirements; no currently known owner question blocks continuation.
B7 remains planning; the synchronization and preservation principles are settled and engineering readiness is required.

## Completeness audit delivery (2026-09-16)

The owner-requested [completeness audit](../09-14-hindsight-integration-completeness-audit/research/README.md) now records
54 implementation/reachability/evidence entries and [16 acceptance cases with dependency order](../09-14-hindsight-integration-completeness-audit/research/closure-plan.md).
Use that ledger before continuing B7 design. First activation, active Character Bank preparation, setup recovery,
model/template application, durable operator lifecycle, repeated handoff and administration require explicit closure.
Keep D23/#29, optional capabilities and D79-D83 in their documented scope. U1 remains unanswered; this research does
not authorize implementation or mark product/manual acceptance complete.
