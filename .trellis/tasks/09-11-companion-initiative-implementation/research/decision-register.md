# Decision and source register

## Purpose and evidence scope

This register consolidates effective decisions from the T4 planning history and the owner discussion through 2026-09-11. It separates required product behavior, current implementation evidence, engineering choices, and deferred work. Repository paths below are relative to the T4 root unless they are links.

The current conversation is native session `01a074f6-ff11-71b3-832a-e35578901417`. Relevant discussion was rechecked against the parent PRD/grill and current source; this is not an implementation or live-service acceptance report. The source baseline is T4 `a35d273` and local main `3c63a80`, verified from the T4 worktree. No external service or user database was exercised.

## Precedence

1. Latest explicit owner decisions, including the 2026-09-11 D79 correction and same-runtime/same-Monitor clarification.
2. The confirmed parent PRD/grill, frozen T4 handoff decisions, domain glossary and applicable ADRs.
3. Current executable specifications and source for actual behavior and integration constraints.
4. This task's design for new implementation choices, clearly marked as engineering decisions.
5. Historical surveys and third-party references as evidence and design examples.

Current code can prove that a desired feature is absent; absence does not cancel a confirmed requirement. An older implementation snapshot cannot override newer Memory or Runtime behavior. Reference implementations do not grant permission to import their product defaults.

## Effective decisions

| Decision | Effective rule | Primary source and task mapping |
| --- | --- | --- |
| Broad initiative, distinct triggers | The owner uses Heartbeat broadly in discussion for non-direct-user-triggered Agent work. Keep `heartbeat`, `scheduled` and maintenance semantics distinct while sharing execution. | Owner discussion 2026-09-11; `docs/ARCHITECTURE-ROADMAP.md` sections 2/4/6; R01/R10. |
| One runtime | Reuse RunService, ChatAgent, Run/Attempt/Event/Effect, governance, recovery and Timeline. New behavior is normally Pattern data, context or a provider/capability adapter. | Owner 2026-09-11; `docs/T4-HANDOFF.md` sections 5.1/5.4; R01-R03. |
| Same monitoring | Existing model/tool/lifecycle observations must follow reused execution automatically. New business facts need real producers, typed fields/events and existing projections. No second Heartbeat monitor. | Owner 2026-09-11; `.trellis/spec/backend/observability-projection.md`; R15. |
| Meaningful eligibility | Cadence is a check opportunity; a supported due condition or meaningful fresh Signal is still needed. Raw updates, connection restoration and resume do not directly invoke the model. | `docs/T4-HANDOFF.md:393-410`; `.trellis/workspace/pleia/t4-heartbeat-engine.md:787-869`; R02. |
| Typed Pattern authority | The earlier Core-owned checklist evolves into one Pattern authority, with conditions, purpose, provenance, revisions and lifecycle. No fixed dialogue, code-generating policy or parallel task-archetype system. | `.trellis/workspace/pleia/t4-second-grill-prep.md` G2-01/G2-07; later engine section 11; R03. |
| Complete first authoring loop | First delivery includes user-initiated conversational creation, necessary clarification, concrete candidate review/confirmation, real eligibility participation, revision, pause/resume, history and rollback. | Parent `research/grill-decisions-2026-09-08.md`, first authoring delivery; R04. |
| Useful candidate cards | Permission-card presentation may be reused, but Pattern confirmation is a distinct domain action and grants no permission. Parameters and changes must be understandable; internal hashes/IDs are not content. | Owner 2026-09-08; parent grill, candidate-card section; R05. |
| Automatic finite Intentions | One-shot follow-up plans may form automatically without per-plan review. They have a finite window and do not catch up once expired. | Owner 2026-09-08; parent PRD requirement 13 and grill; R06. |
| Expire the plan, preserve the matter | Missed timing does not erase or resolve the underlying reported event. Later fresh initiative may ask naturally from relevant Memory, without waiting for a user message. Old triggers/text remain expired. | Owner interview example and explicit follow-up approval 2026-09-08; parent grill; R07. |
| No archival product implied | A minimal terminal Intention disposition can support deduplication/audit. Do not create an archive UI/store merely because the owner considered the word archive. Memory retention stays with Memory. | Parent grill, automatic Intentions and source evidence; R06-R07. |
| Stable Persona and common model | Persona/Soul and safety rules remain stable. Main Model configuration is global across Companion reasoning; context selection is independent. Utility stays maintenance-only. | T4 second grill G2-09; handoff 5.4; R08. |
| Provider-neutral Memory | Local/Hindsight share the T4-facing contract, with one active authority and explicit pending/derived truth. No legacy Markdown dependency, outage promotion or broad automatic graph injection. | ADR 0009; handoff 5.6; parent readiness dated main refresh; R07-R08/R16. |
| Structural silence | `silent`, `express`, `speak` are interaction decisions, separate from execution success and delivery. Only actual speech enters the relationship Timeline; no private stream or empty turn is published. | ADR 0010; handoff 5.1/5.4/5.8; R09. |
| Class A versus B | Scheduled Task fires remain user-expected Class A, using an Agent Run. Class B has its own model eligibility, utterance quota, gap, quiet hours, busy/expiry and feedback policy. | Second grill G2-02/G2-06/G2-10; handoff 5.2/5.3; R10. |
| Sampling pause | Pause withdraws Sampling eligibility, not all Core activity or all scheduled work. Old observations/wake reasons cannot become eligible simply because pause ends. | Second grill G2-04; parent PRD requirement 6; R12. |
| V1 authority | Heartbeat uses narrow Core reads, relevant Skills and Companion presentation; no exec, extra sensor acquisition or external effects. Unattended ask skips quietly. | Second grill G2-07; handoff 5.4/5.7; R12. |
| Presence across deployment topologies | Core uptime, client connection, user presence, message presentation and Host readiness are independent. Phone is a future frontend of the same Core. Unknown evidence remains unknown. | Owner 2026-09-08; parent PRD requirements 15-16; `docs/TECH-STACK.md` deployment/presence clarification; R13. |
| Weak, evidence-based backoff | Repeated non-engagement may reduce frequency only with actual presentation and a real opportunity to respond. Absence/unknown never count as ignored; no false real-world resolution follows from a reply or timeout. | Owner 2026-09-08; parent feedback/presence clarification; R14. |
| D79 correction | Persona-specific reactions to prolonged non-response are a later Heartbeat behavior extension. The earlier disappointed/angry interpretation is not a first-delivery emotion requirement. | Owner 2026-09-11; `docs/deferred-decisions.md` D79; parent grill correction. |
| Task preparation | The owner requested a new task consolidating current/prior discussion and effective existing documents; reopen grill only for an actual unresolved product tradeoff. | Owner 2026-09-11; current task and parent linkage. |

## Engineering decisions to make explicit in the implementation design

These resolve implementation detail within the accepted scope. They must not be presented as separately ratified product features.

- Keep one explicit initiative Character target for the current single-Character frontend; imported assets are not an automatic list of active speakers. Preserve Character-scoped data and Core/user-level aggregate safety budgets.
- Add a typed autonomous context selection and actual source manifest at the existing Replay View/Run snapshot seam.
- Extend the existing Character coordinator with atomic background reservation, primary priority and bounded deferral. Never interrupt primary work merely because 90 seconds elapsed.
- Separate pure Timeline projection from executable delivery continuations. Tool/Host/presentation work cannot be dispatched against an already terminal Run/Attempt.
- Give Pattern proposals immutable revisions and compare-and-swap confirmation. Keep user-facing cards semantic and permission-independent.
- Retain actual nullable idle evidence and dispatch Host/generation metadata. Do not derive presence from the lossy existing activity boolean or infer operator/Node co-location.
- Require same-attributable-device presentation/presence overlap for negative feedback. Live leases retire across disconnect/restart; durable observed intervals do not grow while offline.
- Bound candidate lists, context retrieval, diagnostics, storage retention and per-source event rates; expose calibration rather than silently choosing new permanent constants.
- Extend versioned RunEvent contracts and existing Monitor projections. Before-Run diagnostics remain bounded provider policy facts; no synthetic Run per timer tick.

## Current implementation facts and gaps

| Existing source | What it proves | What remains for this task |
| --- | --- | --- |
| `packages/shared/src/harness-schema.ts:17-53` | Heartbeat, Class B and autonomous context are typed in common requests. | A type value does not implement a provider or policy. |
| `packages/core/src/harness/run-service.ts:63-111` | Admission/idempotency, captured contexts, start/retry/settlement/cancel and shutdown sealing exist. | Add the bounded coordination/continuation contracts required by initiative. |
| `packages/core/src/scheduler/scheduled-run-adapter.ts:25-35` | Scheduled work uses the shared RunService/Character queue/ChatAgent. | Text deltas are deliberately discarded at line 34; public delivery is not already complete. |
| `packages/core/src/agents/chat-agent.ts:256-277,390-426` | All Run kinds can use the same loop and telemetry; non-primary control stays ephemeral. | Ordinary history is still projected; thin autonomous selection and semantic terminal output are absent. |
| `packages/core/src/harness/run-snapshot-capture.ts:74-78` | Snapshot has extensible context/replay/source slots. | Some fields remain unknown/not-captured/empty; populate real selected inputs, not invented metrics. |
| `packages/core/src/agents/run-observability-telemetry.ts:24-72` | Model and tool observers use Run/Attempt identity, independent of initiator. | Heartbeat business decisions/delivery require explicit producer facts. |
| `packages/core/src/observability/observability-query-service.ts:95-107` | Monitor reads all authorized Character Runs. | Extend semantic projection fields; retain bounded pagination/subscriptions. |
| `packages/core/src/activity/activity-state.ts:84` | Unknown `idleSeconds` is currently projected as `idle=false`. | Preserve separate three-state evidence before this lossy projection for presence. |
| `packages/core/src/server/connection-registry.ts`; Desktop `device-identity.ts`; Rust `node.rs` | Operator windows and Nodes have different authenticated identities/lifecycles. | Same machine is not established by similar names or connection order. |
| `packages/core/src/db/scheduled-task-repo.ts:31`; migration `029-scheduled-tasks.ts:20-24` | Scheduled consumes an existing User Timezone singleton initialized to UTC. | Fixed/follow-primary-device update/report and Desktop settings remain required; do not assume complete timezone wiring. |
| `packages/core/src/memory/assembler.ts:109`; `canonical-local-runtime.ts:41-53` | Legacy disclosure selection differs from canonical assembly. | Build an Intention domain authority and bounded provider-neutral related-memory access. |

## Superseded or misleading material

| Historical premise | Effective correction |
| --- | --- |
| `HEARTBEAT.md` as mutable authority, or a free-form checklist | Core-owned typed Pattern data, shared by tools and panel. |
| A cadence tick by itself causes a model call | Require a meaningful supported due condition/Signal and common eligibility. |
| Every autonomous turn appends a fake user row or conversational memory | Existing non-primary support already avoids this; preserve it. |
| Every non-primary turn is already thin-context | Current ChatAgent still reads the relationship Replay View; extend the seam. |
| Utility model is the default Heartbeat thinker | One global Main Model for Companion reasoning. |
| Pending Memory is a universal wake/suppression flag | Pending/derived truth belongs to Memory authority; pending alone does neither. |
| Memory retention/archive implements active Intention expiry | Intention eligibility is separate; canonical mode does not install the old picker/retention path. |
| Privacy Pause mutes all initiative, Class A or Core work | It closes Sampling-derived eligibility; other sources retain their own policy. |
| Every output called completed was shown to the user | Execution, publication, presentation and response are independent facts. |
| Connected/visible/non-idle means the user had a chance to respond | Require the actual authenticated source and per-message opportunity evidence. |
| Persona-specific sadness/anger is required now | The owner corrected this; D79 behavior is deferred. |
| Main still ends at `dd2e15b`, so a new 035 bridge must be invented | Main `3c63a80` already includes additive 036 and later 040 convergence; verify and integrate those. |
| Historical task path `.trellis/tasks/08-25-scheduled-task-provider` remains active | Its source documents are under `.trellis/tasks/archive/2026-08/08-25-scheduled-task-provider/`. |
| Matching D77/D78 numbers on two branches mean the same work | Their meanings differ across T4/main. Match full requirement text and provenance during integration. |

Root metadata/docs may retain historical implementation descriptions, including old Memory/Config summaries. Use ADR 0009, actual runtime selection and current executable specs for the implementation; do not reactivate retired storage based on those summaries.

## Canonical reading set

1. Current `prd.md`, `design.md`, `implement.md` and the assigned child artifacts.
2. Parent `.trellis/tasks/09-08-t4-heartbeat/prd.md` and its two research files for owner decisions and dated readiness.
3. `CONTEXT.md`; `docs/T4-HANDOFF.md` section 5; `docs/ARCHITECTURE-ROADMAP.md` sections 2-6.
4. `docs/adr/0008-replay-view-context-seam.md`, `0009-single-memory-authority-with-local-replica.md`, `0010-separate-autonomous-run-history-from-relationship-timeline.md`.
5. `.trellis/workspace/pleia/t4-second-grill-prep.md`, especially sections 5 and 9; `t4-heartbeat-engine.md` section 11; `t4-decisions.md` only through later corrections.
6. Current backend/frontend specs listed in the curated context manifests.
7. Archived Scheduled provider design/implementation, current Harness architecture task and D68 observability task as implementation references.
8. `reference-designs.md` for the bounded third-party comparison; follow its pinned/source-version references when deeper detail is needed.

## Grill result and reopening conditions

No unresolved product decision currently requires another grill question. The single-target rollout and additional timing bounds are conservative engineering choices for the existing surface, recorded for review rather than hidden assumptions.

Reopen a focused, one-question-at-a-time grill only if work would require new sensor/permission authority, simultaneous unsolicited speakers, a different delivery/expiry promise, automatic long-lived Pattern activation, dropping an accepted first-delivery feature, or an incompatible Memory-authority decision. Routine API names, state/CAS mechanics, event fields and testable calibration are engineering work.
