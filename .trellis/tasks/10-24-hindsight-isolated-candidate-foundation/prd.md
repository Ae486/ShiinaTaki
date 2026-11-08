# Hindsight isolated candidate foundation (Stage 5D D1)

## Goal

Provide an isolated, same-version Hindsight candidate that preserves the complete paired memory state and can be inspected and recovered by its original identity. This is the foundation for populated model changes (C4) and guarded candidate publication (D2); model upgrades remain a required Stage 5 capability for a formal memory store.

## Owner direction and current phase

On 2026-10-24 the owner requested preparation of three coordinated tracks:

1. Continue the existing C2b task to deliver the real API producer and trusted managed-deployment receipt path.
2. Prepare and advance D1 in parallel where actual source and ownership boundaries permit it.
3. Start Stage 6 after C2b lands, run the machine-verifiable complete journeys first, and present D89's genuinely owner-only items in one acceptance package.

The owner explicitly approved creating this D1 child and entering planning. Preparation and independent review passed. The owner subsequently requested entry into development and authorized deletion of verified regenerable project build output if disk capacity is insufficient. This task is now `in_progress`: D1-A is the first admitted source slice, alongside C2b's actual image-inventory prerequisite. Later shared integration and runtime slices retain their reviewed gates. C2b stays in `10-14-hindsight-managed-deployment`; Stage 6 stays under the existing parent `08-09-memory-operations-ui`.

## Requirements

1. Prepare a candidate from a verified Core/Native backup pair into physically isolated, explicitly owned resources while preserving the selected source authority.
2. Preserve required Native data, application/control records, source bodies and identities, invalidated/history state, Pending obligations, template versions, user overlays, and their evidence. Omitted data or unavailable evidence must produce an explicit refusal, never an empty-success substitute.
3. Prove the exact original version, schema, build and backup identity before any future transformation. D1 must not weaken the existing Stage 3 restore contract to admit software or model upgrades.
4. Keep restored schedulers, Native workers, queued jobs, webhooks and model work fenced. Candidate inspection must not start ordinary Core lifecycle work or execute restored jobs.
5. Persist sufficient candidate ownership and progress to observe the original resource after interruption. Unknown effects remain unknown; retries must not create replacements or adopt foreign resources.
6. Expose truthful preparation, refusal, verification and recovery state. A verified isolated candidate is not a promoted authority or a ready managed deployment.
7. Make D1's source contracts and deterministic verification independently reviewable alongside C2b. Actual Host/API/configuration dependencies must remain explicit acceptance gates rather than fabricated fixtures counted as production proof.
8. Preserve a concrete handoff to C4 and D2. Same-dimensional model changes are still semantic migrations unless equivalence is proven; D1 alone must never be reported as complete model-upgrade support.

## Acceptance Criteria

- [ ] A supported, complete same-version pair restores into isolated candidate storage and passes exact baseline verification with source authority unchanged.
- [ ] Missing/tampered archives, omitted required data, wrong lineage/Bank/schema/build/Host/resource identities and shared or foreign storage refuse before eligibility or unintended effects.
- [ ] Application/control/Pending/template/user-overlay inventories reconcile without losing historical truth or executing restored work.
- [ ] Candidate inspection uses an isolated reader and proves zero ordinary scheduler, model, webhook or source-authority effects.
- [ ] Restart, lost replies and interrupted preparation recover the original request/resource or preserve an explicit unknown/refused state without replacement or blind replay.
- [ ] Candidate identity, baseline proof and transformation handoff are durable, bounded and free of credentials or caller-attested readiness.
- [ ] Deterministic and actual isolated runtime evidence are reported separately; accepted C2b/C3 producers are required wherever the concrete candidate runtime depends on them.
- [ ] Independent design/source review and applicable checks pass, with failed evidence and owned resource disposition retained.
- [ ] No source promotion, live Core replacement, re-embedding or software migration is claimed by this D1 result; C4/D2 remain visible required follow-ups.

## Scope boundaries

- This task does not perform C4 re-embedding, D2 publication, or Stage 6 owner acceptance. Those capabilities remain in the parent delivery scope.
- Existing C1 service/platform and C2a fault-matrix evidence limits remain visible; this child does not reopen accepted checks or silently close their remaining criteria.
- Original business data/credentials, paid model calls, unrelated environments, repository cleanup, commit/push and task archival are outside this preparation assignment.

## Sources

- Parent requirements: `../08-09-memory-operations-ui/prd.md` and `design.md`.
- Existing dependency study: `../10-07-hindsight-template-lifecycle/research/stage5d-candidate-dependencies.md`.
- Existing C2b plan: `../10-14-hindsight-managed-deployment/research/c2b-plan.md` and its accepted R2 review.
- [Current-source study](research/source-readiness-2026-10-24.md), [technical design](design.md) and [execution slices](implement.md).
- [Independent preparation review](../08-09-memory-operations-ui/research/preparation-advisor-2026-10-24.md) and [Stage 6 journey plan](../08-09-memory-operations-ui/research/s6-acceptance-plan-2026-10-24.md). Preparation is accepted; product/runtime criteria above remain unexecuted.
