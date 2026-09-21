# B7 Operations Interaction - Grounding and Grill

## Status

2026-09-19 current direction: the
[overall Memory/Hindsight review](../09-14-hindsight-integration-completeness-audit/research/overall-grill-2026-09-19.md)
covers all remaining stages. The owner clarified that grill is conditional, not a mandatory interview before delivery.
No currently known owner question blocks continuation; resume Stage 2a research/planning, retaining the engineering
readiness gates. Stage 1 is committed and archived. U1 is accepted; G1's premature administration choice is withdrawn.
Earlier mandatory-grill and U1-unanswered statements are superseded. B7 remains planning.

2026-09-14: the owner required a review of the existing designs, discussions and grill records before continuing B7.
This is a planning correction and source audit, not implementation or switching acceptance. B7 remains planning.

The previous draft R1 (a new Bank set versus another instance on each re-entry) is withdrawn. It incorrectly turned an
implementation gap into a new product choice and failed to apply the accepted baseline/mapping/change-reuse rule.

## Owner sequencing update - completeness research before further B7 grill

2026-09-14: the owner requested that the current conclusions be recorded first, then an independent research task be
inserted to identify every remaining item needed for usable Hindsight integration, repeated Local/Hindsight switching,
memory-related multi-endpoint use within the current task, and the rest of the accepted design. The purpose is to catch
missing functionality and integration gaps before further implementation. U1 has not been answered and is deferred;
this request is not acceptance of either confirmation-flow option.

Proposed research deliverable: an evidence-backed completeness matrix covering each accepted requirement, its original
batch/owner, current implementation, boot/RPC/UI or helper reachability, existing validation, remaining work, dependencies
and a concrete usable-state acceptance case. Distinguish implemented-and-connected, implemented-but-unconnected,
partially implemented, missing, unverified and explicitly deferred/out-of-scope behavior. Include D79-D83 in the ledger
with their existing deferral and practical impact, without silently adding their implementation to B7.

Research scope includes setup/first activation, both providers' normal operation, incremental sync/degraded recovery,
healthy return/re-entry/emergency takeover, runtime and operation lifecycle, memory ownership across local/remote Core
connections and multiple clients, backup/restore/upgrade, secrets and compatibility, and every other accepted parent
requirement. Multi-endpoint findings must follow the current Core/Host boundaries and must not invent cross-Core memory
merging or expand unrelated T4 work. Investigate source and existing evidence; do not activate authority or start
production implementation as part of the audit.

The research precedes further B7 interaction questions. The owner explicitly approved registration and planning;
[the independent research task](../09-14-hindsight-integration-completeness-audit/prd.md) is now a child of the existing
Hindsight parent. This does not authorize B7 production implementation or resolve U1.

## Current-code recheck and discussion stop point (2026-09-18)

The owner requested a recheck of the overall missing functionality against actual code, followed by documentation of
those results. The [dated source recheck](../09-14-hindsight-integration-completeness-audit/research/source-recheck-2026-09-18.md)
confirms the missing first-enable, round-trip, active Bank/setup and operator journeys. Periodic sync, Pending recovery
and the selected-provider runtime are implemented foundations. The audit's 54 entries are not 54 missing features.

Narrow the earlier fence wording: runtime composition gives the shared admission fence to Legacy, not Canonical Local;
new fenced calls are rejected, not durably queued. A promotion wrapper and DB consistency guards do not establish
complete writer drain, transition replay or runtime replacement. These remain explicit backend prerequisites.

Continue the overall gap/closure discussion before resuming U1 or detailed B7 interaction design. This record does not
resolve U1, authorize implementation, reopen baseline/mapping/change reuse, move D79-D83 ahead of B7, or change task
status. See the dated record for foreground-wait and stale-validation qualifications and evidence limits.

## Existing records applied

- [Parent PRD](../08-09-hindsight-memory-provider/prd.md), especially the batch table and existing decisions.
- [Parent technical design](../08-09-hindsight-memory-provider/info.md), especially planned return and Batch 7.
- [ADR 0009](../../../docs/adr/0009-single-memory-authority-with-local-replica.md), especially incremental replication,
  routine recovery, healthy return and the separate emergency branch.
- [Domain glossary](../../../CONTEXT.md): Authority Epoch, Local Memory Provider, Memory Replica and Replica Checkpoint.
- [B1 design](../archive/2026-08/08-09-memory-provider-foundation/design.md): epoch vocabulary does not implement later transitions.
- [B3 design](../archive/2026-08/08-09-hindsight-connection-setup/design.md): setup/disable are not authority changes.
- [B4 design](../08-09-hindsight-initial-cutover/design.md): current-Local import coverage and first-activation proof.
- [B5 design](../08-09-memory-replica-sync-recovery/design.md): synchronization and recovery never change authority.
- [B6 design](../08-09-memory-runtime-integration/design.md): selected-provider runtime integration excludes authority changes.
- [Recovery discussion and grill](../09-07-hindsight-recovery-evidence/grill.md): interoperability, preservation and the
  distinction between routine factual confirmation and cutover completeness; code-answerable gaps are engineering work.
- [Accepted B6 grill](../08-09-memory-runtime-integration/grill.md): repeated switching reuses verified baselines,
  identity mappings and subsequent changes; B7 has its own interaction/design gate.

## Settled constraints

1. Exactly one provider is authoritative. An outage does not switch authority; Pending recovery still targets the
   existing Hindsight authority and is distinct from Local-authority re-entry.
2. Healthy return requires accepted-work/required-maintenance completion, final incremental synchronization, full
   logical reconciliation, zero unresolved writes, a short write fence/queue, and a new Local Authority Epoch.
3. Re-entry must include every mutation from the current Local epoch and preserve or reconstruct the agreed consumable
   state. Reuse verified baselines, identity mappings and subsequent changes. A fresh authority migration does not mean
   mandatory new physical Banks, another instance, or retransfer of every unchanged record.
4. Full logical reconciliation checks complete identity/revision/lifecycle/integrity coverage. It is not permission to
   replace incremental continuation with unconditional full copying. A checkpoint alone also cannot prove that a new
   Local epoch's changes reached Hindsight; source/target identity and change coverage must be verified.
5. The former epoch cannot overwrite the new one. Emergency takeover preserves uncertainty and treats a recovered old
   authority as a foreign historical branch; it must not be confused with ordinary verified continuation.
6. Home projects Core/helper-owned operation state. Closing the window does not complete, cancel or forget an admitted
   operation. Unknown outcomes stay explicit. D79-D83 remain separate follow-ups.

## B7 scope and verified implementation boundary

B7 is led by setup and operations interaction. The original PRD also requires producer-backed Shared/Core operations,
and the parent design assigns healthy Local cutover and disaster takeover to Batch 7. It is therefore more than view
rendering. However, B4/B5/B6 completion does not establish an already working round-trip transition behind those views.
The missing transitions must be explicit prerequisites with their own verification, not hidden inside UI wiring or
used to reopen settled product rules. No batch reassignment or new task is made by this audit.

| Capability | Current source evidence | Consequence for B7 |
| --- | --- | --- |
| First Local-to-Hindsight preparation/promotion | `hindsight-authority-repo.ts:79` requires active Local with reason `initial-local`; `:90` requires its B2 activation receipt. `hindsight-cutover-run-repo.ts:111` retains that source-run constraint. | Reuse current-state capture/import/proof, but do not claim this is a general re-entry operation. |
| Hindsight-to-replica continuation | `hindsight-runtime-bank-service.ts:75` resumes from persisted checkpoints; `hindsight-replica-sync-runner.ts:80` applies change pages and `:90` runs reconciliation. | The existing incremental producer is real and should be reused. Its direction is not Local-authority changes back to Hindsight. |
| Outage/Pending recovery | `hindsight-pending-recovery-runner.ts:52` pulls, replays and pulls again; `:78` explicitly requires Hindsight authority and preserves its epoch. | This implemented recovery is not a provider switch or Local re-entry protocol. |
| Healthy return and subsequent Local-authority re-entry | Production authority writers provide initial Local creation and first Hindsight promotion, with no general return/re-entry transaction or end-to-end operation. Local has revision snapshots and idempotent receipts; those are not by themselves a reverse replication workflow. | Complete the guarded transition and baseline/change coverage before the UI can advertise executable round trips. |
| Runtime replacement | `runtime-selector.ts:26` selects once from the durable marker; `:51` handles Legacy-to-canonical binding. `runtime-composition.ts` retains the selected subsystem's consumers. | A complete repeated Local/Hindsight runtime handoff is still missing. Existing retirement guards remain useful. |
| Operator cutover surface | `hindsight-cutover-methods.ts:21` registers status and verification only; its module is explicitly read-only. | Actual start/resume/transition operations still need a Core-owned facade and durable progress. |

Source paths in the table are under `packages/core/src/db/`, `packages/core/src/memory/` (including `hindsight/`), and
`packages/core/src/server/methods/`. This is static source evidence; no new service run or round-trip acceptance was
performed. The bounded B6 closeout remains evidence for its stated runtime scope, not for unimplemented B7 operations.

## U1 - Normal switch confirmation flow (accepted; recorded 2026-09-19)

Scenario: the operator has reviewed the planned Local return and explicitly confirms it. The accepted synchronization,
integrity, write-fence and new-epoch gates remain mandatory in either option.

The owner selected one explicit confirmation: the background operation completes the guarded switch once all checks
pass, without another confirmation after preparation. A blocking condition stops the operation with actionable status;
it never becomes emergency takeover. Emergency takeover retains its separate explicit confirmation.

This settles the confirmation flow only. Replication, preservation, Bank identity and all required checks remain
unchanged. It does not authorize a real switch or mark implementation or manual acceptance complete.

## Interposed audit delivered (2026-09-16)

The [audit overview](../09-14-hindsight-integration-completeness-audit/research/README.md),
[54-entry matrix](../09-14-hindsight-integration-completeness-audit/research/completeness-matrix.md), and
[closure order/acceptance cases](../09-14-hindsight-integration-completeness-audit/research/closure-plan.md) are recorded.
They expose actual backend/operation gaps as well as UI and validation work, with original ownership and explicit
deferrals. Use these findings before resuming this grill. U1 has no owner answer and R1 remains withdrawn.

## Accepted plan review and leader direction (2026-09-18)

The owner accepted the [Astra plan review](../09-14-hindsight-integration-completeness-audit/research/plan-review-2026-09-18.md)
and instructed the leader to record it, read HANDOFF/development/leader guidance, then organize, advance and dispatch
the existing work. Carry PR01-PR05 and the three clarifications into slice planning: a common native/Core recovery
point, an independent administration path, first-activation conversation-source custody, explicit transition-queue
admission/results, and Local-only onboarding. Preserve stage-specific acceptance and the separate emergency backup rule.

U1 remains unanswered; accepting this review does not select a normal-switch confirmation option. The leader proceeds
through the applicable design/readiness gates and preserves the existing product scope and manual-acceptance boundary.
