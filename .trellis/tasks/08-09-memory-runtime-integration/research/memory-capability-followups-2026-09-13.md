# Memory Capability Follow-ups and B7 Sequencing

## Owner direction

On 2026-09-13 the owner directed the project to finish the already scoped memory tasks, including B7, before expanding
long-term memory maintenance capabilities. Record the gaps explicitly instead of turning each finding into a new B7
prerequisite. This is a sequencing decision, not evidence that an unrun acceptance case passed.

The central entries are [D79-D83](../../../../docs/deferred-decisions.md). No new implementation task is created here.
The existing B6 task remains `in_progress`; B7 remains `planning` with its existing PRD and required design/grill step.
Original-data activation, publication and task archival keep their separate authorization boundaries.
The subsequently approved [bounded B6 closeout](b6-closeout-validation-2026-09-13.md) is now verified; owner/manual
acceptance and complete eventual model assessment are not inferred from that result.

## What already works, and what is not equivalent

| Boundary | Current evidence and limitation |
| --- | --- |
| Stored policy interoperability | D77 preserves layer, importance, visibility, retention, original bodies, metadata, provenance and Blocks as provider-hosted application artifacts. Actual original-field comparison and provider-only reconstruction passed. These fields are not merely retained in an old Local database. |
| Hindsight-backed Taki prompt admission | Core still assembles the fixed Blocks, pinned records, query-triggered intentions and automatic Recall. It uses the same Taki layer/visibility/retention rules over verified Hindsight projections. A configured backend does not replace this Core policy. |
| Ordinary addressed-record visibility | A hidden or expired record is excluded by Taki consumer admission. An application-policy change does not automatically invalidate the corresponding native fact or rebuild every derived observation. |
| Complete authority switching | Data reconstruction is not a completed authority switch. Healthy return to Local, re-entry and emergency takeover remain in the existing B7 workflow with their own final-sync, reconciliation, pending, fence and epoch gates. |

`hidden` means a visibility policy change, for example `retrieved -> hidden`. Retention changes include choosing an
expiry/rolling rule, changing its deadline, or simply reaching an already stored expiry time. These are different from
native factual invalidation or deletion. The same propagation gap can occur while staying on Hindsight continuously;
it does not require a Local/Hindsight conversion and is not proof that conversion dropped a policy field.

## Deferred capability inventory

| ID | Present behavior | Deferred capability | Revisit condition |
| --- | --- | --- | --- |
| D79 | Local model tidy runs after the configured change threshold or an operator request; rule retention runs at boot and every six hours. Taki's Hindsight curator runs through the maintenance chain. Neither is a completed daily full-library model review in current main. | Connect the existing scheduling surface to a bounded per-provider daily review, including missed-run recovery and no-overlap behavior. | After B7, when daily autonomous review is taken into scope. Reuse the T5 decision that clock triggering belongs to the later scheduler integration. |
| D80 | Hindsight-backed Taki reads enforce expiry, but no equivalent Taki-policy retention executor is installed. Native Hindsight invalidation/archive exists; native log/task retention is not a substitute for Taki memory lifetime rules. | Execute due Taki retention policy through authority-owned native lifecycle operations, with durable progress, retry and replica reconciliation. | After B7, or when accumulated expired records measurably impair normal operation. Preserve recoverability and existing deletion limits. |
| D81 | Native edit/delete/invalidate can remove linked observations and reconsolidate surviving sources. Taki hidden/expiry changes do not drive that complete chain. The actual hidden-nickname scenario exposed a visible derived observation containing hidden source information. | Propagate policy/lifecycle changes to affected derived content and rebuild it from permitted inputs; define the completeness and timing guarantees of dependency evidence. Cover declared-source gaps, in-flight generation and Mental Model freshness boundaries deliberately. | After B7, before promising that hiding information excludes all its derived forms, or earlier if stale/hidden summaries affect normal use. |
| D82 | Local tidy can reclassify, replace/archive and deliberately promote memory. The Hindsight curator handles due/changed/retry policy work and listed Blocks; it cannot rewrite native observations or automatically create a new pin. | Design periodic reconsideration of mature memories and any desired promotion/demotion parity. Keep native semantic maintenance under Hindsight and make any curator authority expansion explicit. | After B7, when long-running usage establishes the required review/promotion behavior. This is a deliberate scope difference, not a missing transported field. |
| D83 | Timing evidence separates native Recall requests from Core sync/hydration overhead and shows repeated native policy validation. It does not yet prove a particular optimization's benefit. | Optimize only reproducible, measured local/adapter/native overhead while preserving admission and cancellation. | After B7 or when measured overhead materially harms use. Upstream model latency alone is not a reason to start an optimization project or shorten the required wait. |

Ordinary native Recall still retrieves candidates before Core policy hydration; it does not acquire guarded Reflect's
pre-reranker policy guarantee. No claim of complete propagation or strict information erasure follows from addressed-
record filtering. The actual failed attempts remain failures with their original evidence. Broader embedding/model
benchmarking is optional future work, not another missing core feature or an automatic B7 prerequisite.

## Existing work that remains on the main path

1. Bounded B6 closeout is verified: the temporary observation experiment is removed, retained final source/configuration
   passed the recorded automated and real-model checks, and successful original field/recovery evidence remains intact.
2. Existing curator continuation is verified under its bounded-pass/retry contract: four original journal attempts
   reached terminal outcomes and eight new assessments were actually applied across two passes/reopen. The original
   three policies remain failed/retryable; eventual assessment and whole-library completion are unproven. No FIFO,
   deadline, failure receipt or stored retry time was rewritten. This is existing behavior, not D82 expansion.
3. Proceed through B7's existing design/grill and implementation: setup/operations UI, producer-backed status, sync,
   reconcile/retry/backup/upgrade, healthy switch-back/re-entry and guarded emergency takeover. Do not relabel B7 as
   implemented or skip its authority/data-integrity gates because policy follow-ups were deferred.
4. Schedule D79-D83 after that scope. Owner/manual semantic quality and original-environment activation remain explicit;
   no ungraded answer or unperformed live operation is marked accepted by this note.

## Temporary observation containment

The exploratory blanket observation guard was removed in the owner-approved B6 closeout. It is not the release default.
Ordinary observation Recall, replica fallback, pinned/intentions projection, curator input and native guarded Reflect
now follow the observation's own policy. The earlier reranker/lifetime/Reflect-budget corrections remain intact.

The final actual-data run again observed derived nickname content while correctly excluding the hidden original. D81
remains unresolved; neither removal of the experiment nor the six scoped closeout checks turns that failure into a pass.
No original-data activation, failure-evidence deletion, task archival or publication follows from closeout.

## Sources

- [Final bounded B6 closeout](b6-closeout-validation-2026-09-13.md).
- [Actual original-field preservation and reconstruction](d77-owner-acceptance-validation-2026-09-12.md).
- [Current API/Recall/Reflect results](d77-siliconflow-validation-2026-09-13.md).
- [Derived-input failure and experimental containment](d77-derived-input-admission-2026-09-13.md).
- [Local runtime contract](../../../spec/backend/canonical-local-memory-runtime.md).
- [Hindsight application runtime contract](../../../spec/backend/hindsight-application-runtime.md).
- [T5 clock-trigger ruling](../../archive/2026-08/07-28-memory-context/notes.md).
- [B7 PRD](../../08-09-memory-operations-ui/prd.md).
