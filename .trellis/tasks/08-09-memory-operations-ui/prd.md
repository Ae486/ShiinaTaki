# Memory Operations and Setup UI

## Current continuation baseline (2026-10-07)

This existing B7 task is the parent planning map for the remaining Stage 5 operator scope. On 2026-10-07 the
owner approved proceeding with the presented Stage 5 plan and delegated implementation/review scheduling.
Child `10-07-hindsight-configuration-observation` independently passed its bounded automated acceptance;
`10-07-hindsight-template-lifecycle` is now `in_progress` with reviewed artifacts and B1/B2/B3 check gates.
Stages 1-4 have already delivered durable operations, Local onboarding, first activation, active Bank/connection
lifecycle, paired backup/recovery and repeated/emergency transitions with minimal Home controls. Earlier passages
below describing these as absent are historical inputs, not instructions to implement them again. See the current
[Stage 4 review](../09-29-hindsight-transitions-emergency/research/stage4-review-2026-10-07.md).

Stage 4's newly identified final healthy-publication lease guard gap was corrected and independently accepted
under W9 on 2026-10-07. Its correctness prerequisite is satisfied; Stage 5 still requires concrete slice design,
context and artifact review before implementation. Historical/manual acceptance boundaries remain separate.

Remaining scope is managed provisioning, effective Native model configuration, complete versioned templates/user
overlays, candidate upgrade and full Home operations. D88 Bank conflict remedies and D90 artifact cleanup require
explicit administration ownership and preservation checks. D89 manual/environment acceptance and the remaining
original-environment D91 boundary belong to Stage 6. D23 and D79-D83 stay separately scoped.

U1 is accepted as one normal-switch confirmation with all integrity gates retained; emergency has a separate
confirmation. Older statements that U1 is unanswered are superseded. No new production action, real-data change,
deployment, paid call, commit or archive is authorized by this planning refresh.

## Goal

Planning input: [Stage 5 current-source readiness report](../09-29-hindsight-transitions-emergency/research/stage5-readiness-2026-10-07.md).
The approved first slice is genuine existing-instance Native configuration observation through Core to Home.
Its bounded non-secret producer contract is documented in the child artifacts; ordinary Bank configuration and
health APIs do not provide provider/model read-back. Its independent check passed and all ownership is released.

The completed first implementation slice is [10-07-hindsight-configuration-observation](../10-07-hindsight-configuration-observation/prd.md),
with separate design/execution artifacts. Research narrowed its truthful coverage to administrator-authorized,
API-runtime-only single-profile identity, with workers/routed/embedding/reranker coverage unknown. It adds a
default-denied disclosure policy reviewed with the owner; ordinary tenant keys are not administrator grants.
Stage 5B now implements the reviewed [template lifecycle](../10-07-hindsight-template-lifecycle/prd.md).
Later helper/custody work remains planning; see the [execution map](research/stage5-execution-map-2026-10-07.md).

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
