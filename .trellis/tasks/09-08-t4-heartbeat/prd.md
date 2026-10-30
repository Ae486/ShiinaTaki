# T4 Heartbeat and Companion initiative

## Goal

Let Taki notice meaningful changes, make bounded Character-consistent judgments without a user message, and choose silence, expression or useful speech through the existing Core runtime. Heartbeat should be explainable, affordable, privacy-aware and capable of later evolution without rewriting the Character Persona.

## Planning authority and status

The owner approved closing the accepted UI/UX work and entering T4 Heartbeat on 2026-09-08, then requested the leader's task understanding. This authorizes this planning entry. Production implementation has not started; the first delivery boundaries, design and implementation plan still need review before `task.py start`.

Work stays in `H:/TakiAgent-worktrees/t4` on `task/t4-skills-mcp-productization`. The current UI baseline includes continuity code commit `d6ddf2e`. This is a downstream product task, separate from the earlier Harness architecture and Skills/MCP tasks.

Implementation handoff (2026-09-11): the owner requested a new development task. [Unified Companion initiative](../09-11-companion-initiative-implementation/prd.md) now consolidates the effective requirements, technical design, source decisions and four ordered implementation children. This parent preserves the discovery/grill record; use the linked child plan for implementation sequencing and current engineering contracts.

## Requirements

1. Heartbeat is a no-user-message Agent judgment opportunity. Approximate cadence and meaningful typed Signals share one deterministic eligibility path. Empty, stale, duplicate, disallowed, busy or budget-exhausted opportunities are rejected before a model call.
2. Eligible work uses the existing Core-owned Run/Attempt/Event/Effect lifecycle and the same Main Model configuration as other Companion reasoning. Context selection is independent of model selection; the Utility Slot remains maintenance-only.
3. Context is thin and Character-specific: stable Persona, relevant user/relationship memory, permitted scrubbed observations, current time, due intentions and matched Interaction Patterns. Memory access stays provider-neutral through bounded Memory Blocks/index and explicit pull, with no authority switch, full relationship-window replay, automatic retrieved block or broad graph dump. Pending information remains explicitly unconfirmed; its pending status alone neither wakes nor suppresses Heartbeat.
4. Outcomes are structural `silent | express | speak`, with a dedicated terminal response/stop contract. Silence and avatar-only outcomes create no fake user message or empty relationship turn. Actual speech uses ordinary Timeline delivery and appears as a complete proactive utterance in Pet.
5. Heartbeat is Class B. Its model eligibility, delivered-utterance budgets, minimum gaps, quiet hours, busy deferral, stale-output expiry and ignore-backoff remain distinct. User-expected Scheduled Task Class A work keeps its own policy.
6. Privacy Pause closes Sampling-derived sources, invalidates their observation generation and discards unconsumed sampling wake reasons; resuming requires fresh observations instead of replaying a backlog. Clock-, memory- and known-completion sources keep their independent eligibility under normal delivery policy: Privacy Pause is not a global mute. Current Host authority and permission constraints apply before work proceeds. Heartbeat v1 performs no exec or external side effects and does not acquire new sensor data outside the existing Sampling eligibility path. An unattended ask skips with a truthful reason and no surprise dialog.
7. A Core-owned typed Interaction Pattern captures conditions, interaction purpose, context references, outcome choices, cadence/cooldown/expiry, optional chance, provenance/evidence, revision and lifecycle. Seed, user-authored and Agent-proposed patterns share one store/API and panel projection. Patterns carry no fixed dialogue and create no permission. Optional chance can suppress eligible work but cannot override deterministic policy.
8. Stable Soul/Persona and safety policy remain stable. Bounded Companion State, user/relationship summaries, one-shot intentions and later feedback-driven pattern evolution retain explicit seams. Long-lived Agent proposals are reviewable candidates; a first batch is not the final Companion design.
9. Internal Run history records every admitted Heartbeat, including silent/error outcomes. Matched signals/patterns, eligibility/skip reasons, selected outcomes, usage and delivery disposition come from real producers and feed existing projections. Background reasoning does not trigger conversational auto-memory or advance primary-turn watermarks.
10. Restart, reconnect, duplicate signals, concurrent primary activity, old results, revoked authority and delivery expiry settle through existing identity/recovery rules. Old side effects or stale utterances are not blindly replayed.
11. The first delivery includes user-initiated conversational Pattern authoring and management of existing Patterns. A user can describe an interaction, resolve ambiguous or unsupported conditions with the Agent, inspect a candidate, confirm activation, and later revise, pause, resume and roll back through conversation or the panel. Autonomous discovery from long-term feedback and automatic activation/evolution remain later bounded stages.
12. Pattern candidate and revision cards may reuse the existing permission-approval card presentation, with domain-appropriate actions and useful parameter disclosure. Before activation, the user can understand what is proposed, why, the observation basis, conditions and thresholds, interaction purpose and allowed outcomes, effective cadence/limits/time range/expiry, current state and relevant changes. Use clear Chinese and readable names/units. Meaningless hashes, opaque IDs, internal revision/generation values and metadata dumps must not appear in user-facing card content, expanded details, tooltips, accessible descriptions or copied explanations. Internal identity and concurrency data remain intact. Pattern confirmation activates a Pattern under existing policy; it grants no Capability permission.
13. The Companion may automatically form source-backed, one-shot follow-up Intentions without per-intention review cards. Every Intention has a finite validity window. Once expired, it leaves active trigger eligibility and cannot be caught up or replayed on restart/reconnect. Expiration must not itself erase the underlying user-reported matter or mark its outcome resolved; related conversation/Memory remains governed by normal retention, privacy and correction rules. Relevant remembered matters may inform normal conversation or a new, independently eligible Heartbeat, including a spontaneous follow-up before the user speaks. This is part of Companion initiative: the new interaction applies current context and policy while the old Intention remains expired.
14. Taki may reduce Class B frequency after repeated non-engagement, using real message-presentation evidence and fresh User Presence during the relevant opportunity to respond. User absence, unconfirmed presence or unconfirmed presentation must not be counted as the user ignoring a message. A lack of reply remains weak evidence; hard delivery limits stay independent. Character-specific outward responses to prolonged non-response are owner-deferred under D79 as later Heartbeat behavior variants; the earlier emotional interpretation creates no current implementation or acceptance requirement.
15. Core needs an evidence-backed, time-bounded User Presence projection across authenticated clients. Core uptime, socket connectivity, UI visibility, User Presence, per-message presentation, Host Availability and readiness for a specific action remain distinct. Missing or stale evidence is explicit unknown; the Agent must not infer that a user is present merely because the VPS or a desktop/phone connection remains online. Presence must inform interaction eligibility, feedback interpretation and whether a user-dependent step can be handled, while permitted Core-only work remains independent.
16. Reserve multi-device and future phone-frontend support in the Shared/Core presence contract and Desktop source integration. Fresh reports must remain attributable to their authenticated client/device lifecycle, expire, and aggregate without one stale or disconnected device overriding fresh evidence from another. A phone is a presentation/operator frontend of the same Core; background connectivity or push reachability alone does not prove user attention, and phone presence does not make desktop capabilities available. All acquisition, permission and Privacy Pause boundaries remain in force.

## Owner-confirmed first-delivery boundary - 2026-09-08

The owner agreed to the complete conversational authoring loop, with explicit emphasis on meaningful parameters/descriptions and readable cards that may reuse the permission-approval presentation. The six authoring acceptance checks below are required together. This settles the first authoring stage; it does not activate production implementation or bring D78 into scope.

Autonomous discovery/proposals based on accumulated interaction feedback and automatic adjustment/activation retain their existing roadmap seams and require later delivery planning. Their absence from this first stage does not turn seed behavior into the final Companion design.

The owner also approved automatic one-shot Intentions with mandatory time limits. A missed, expired opportunity must not fire when the Agent returns online, while the related matter may still support a later natural question. The owner explicitly confirmed that this later question can be initiated by Taki during a new eligible interaction, without waiting for the user to speak, and identified it as part of Agent initiative. No separate archival feature or guaranteed automatic context inclusion has been selected merely by using the word "archive" during discussion.

The owner accepted autonomous frequency reduction and added User Presence as an important input, especially for a VPS-hosted Core and a later phone frontend. The first Heartbeat design must include presence/presentation facts needed for honest non-engagement decisions and a bounded Desktop integration plan, with mobile and cross-device extension points. On 2026-09-11 the owner clarified that Persona-specific responses to prolonged non-response belong to later Heartbeat work (D79), not this first delivery. A phone implementation, a separate emotion subsystem, D78 permission-system redesign and D79 behavior variants are not silently added to this delivery.

## Existing calibration baseline

The owner-ratified starting values are configurable development defaults: deterministic eligibility check around 60 seconds; model opportunities around 15 minutes with jitter and at most four per hour; Class B delivery at most two utterances per hour and eight per day; at least ten minutes between delivered utterances; quiet hours 23:00-08:00 in the configured User Timezone; busy deferral at most 90 seconds; utterance TTL ten minutes. These counters are separate and are not final product constants.

## Acceptance Criteria

- [ ] Ineligible cadence/events produce explicit bounded skip evidence and zero model requests.
- [ ] Eligible cadence and event wakes use one Run path with correct Character, initiator, immutable context and deduplication identity.
- [ ] Structural silence, avatar-only and spoken outcomes terminate correctly; only real speech enters the relationship Timeline.
- [ ] Class B rate/gap/quiet-hours/busy/expiry rules work independently of Scheduled Class A delivery.
- [ ] Sampling restrictions, Privacy Pause, unavailable Hosts and ask/deny permissions produce truthful bounded outcomes without widening authority. Pause/resume invalidates old sampling wake reasons while permitted non-sampling sources remain independent.
- [ ] Concurrent primary turns, duplicate wakes and late/restarted work preserve ordering and prevent stale or duplicate delivery.
- [ ] Initial patterns are data, with the required provenance, revision and lifecycle; Agent and panel operations share the same authority, and Agent proposals do not silently become permanent active rules.
- [ ] User/relationship/Companion-state context and pattern feedback seams are documented, including later bounded evolution work.
- [ ] Existing observability can explain wake, skip, reasoning outcome and delivery using real source facts and explicit unknown values.
- [ ] Relevant automated, real-runtime and UI acceptance passes for the agreed implementation slices, with owner-only checks reported separately.
- [ ] Automatically formed follow-up Intentions retain their source and a finite validity window. Expired Intentions cannot admit a Run or release a stale held utterance; offline/restart recovery does not catch them up.
- [ ] Expiry of a follow-up Intention does not erase or falsely resolve the user-reported matter. Recalling an expired Intention as text cannot restore its wake eligibility or silently renew its deadline.
- [ ] After an Intention expires, a relevant remembered matter can support spontaneous follow-up in a new eligible Heartbeat without a preceding user message, under current limits and context. The old trigger and any stale generated utterance are not replayed; silence remains a valid fresh judgment.
- [ ] A persistent VPS Core or connected-but-unattended client cannot establish User Presence or an ignored-message count. Missing/stale presentation or presence evidence remains unknown and does not cause non-engagement backoff.
- [ ] A fresh phone-client interaction can establish user presence while an offline desktop remains unavailable for desktop-owned capabilities; user-dependent and Host-dependent readiness stay separate.
- [ ] Multi-client reports expire and settle against their actual lifecycles. One device leaving cannot erase another device's fresh presence, and one message shown on multiple clients is not counted as multiple ignored utterances.
- [ ] Presence changes may inform a meaningful, deduplicated Signal under Wake Policy; transport reconnect alone never admits Heartbeat or replays expired Intentions, stale utterances or a backlog of missed prompts.
- [ ] Required user input or approval remains truthfully waiting, skipped or expired under its existing interaction/Run contract while the user is absent. Independent policy-permitted Core work can continue without inventing user-environment facts.

### Conversational authoring and candidate review

- [ ] A user-described interaction produces a typed candidate Pattern over supported conditions and sources.
- [ ] Ambiguous conditions are clarified; unavailable observation data is explained without inventing a sensor, threshold, capability or evidence.
- [ ] The candidate/revision card exposes the readable intent, source/basis, conditions, parameters, effective limits and relevant change summary needed to decide. Its visible, expanded, accessible and copyable content contains no meaningless internal identifiers or metadata dumps.
- [ ] A candidate becomes active only after user confirmation of the concrete proposal; Agent and panel see the same current Pattern state.
- [ ] An active Pattern actually participates in the shared Heartbeat eligibility path. Matching conditions can admit judgment under current policy, while silence remains a valid result; unsupported, disabled or disallowed conditions cannot fabricate eligibility.
- [ ] Conversation and panel support revision, pause/resume, readable change history and rollback over the same Pattern authority.

## Scope decisions to settle before implementation

- Map the first concrete Signal Providers and seed Interaction Patterns onto current reliable data sources.
- Detail the owner-confirmed conversational authoring and review-card behavior in design and the execution plan. Preserve the settled first-delivery boundary above rather than reopening it.
- Design bounded related-memory retrieval for the confirmed post-expiry initiative behavior; do not reopen whether Taki may initiate that later follow-up.
- Specify the real Desktop presence/presentation producers, freshness and observation windows, cross-device aggregation and mobile report seams needed for the confirmed feedback rule. Select conservative configurable timing defaults as engineering policy; preserve unknown states instead of inventing user activity or reading.
- Reconcile incoming Memory contracts, including factual confirmation versus derived freshness, before selecting integration edits. As of 2026-09-11 main `3c63a80` provides an additive migration 036 for the two migration-035 histories plus later cutover convergence. Verify these incoming migrations and runner changes against fresh, T4-applied and main-applied lineages before integration; do not design a duplicate bridge or rewrite applied history. See the dated update in `research/current-readiness.md`.
- Detail delivery, busy/quiet/expiry and restart persistence against existing Scheduled/Run/Timeline behavior.
- Keep T4 D78 permission-system UX and D79 Character-specific non-response behavior explicitly deferred. Surface a dependency if the selected acceptance requires one; do not expand scope implicitly. Reconcile the different meanings of D77/D78 in the current T4 and main ledgers during integration instead of matching by number alone.

## Definition of Done

Reviewed PRD, technical design, execution plan and scoped context precede implementation. Delivery requires source-backed behavior, meaningful regression/real-runtime checks, synchronized specs, clear rollback and honest acceptance evidence.

## Out of Scope

- Another Agent loop, permission store, memory authority, relationship session list or proactive-only message protocol.
- WebSocket liveness as an Agent Heartbeat, arbitrary no-reason speech, or hard-coded dialogue templates.
- Unreviewed self-modification of Persona/safety/runtime code, speculative metrics, or automatic replay of uncertain effects.
- Automatically absorbing D69/D75/D76/D77/D78, Avatar Lab or OpenBiliClaw into the first Heartbeat delivery.
- Implementing the future phone app, adding unapproved device sampling, or building a separate emotional scoring subsystem under the presence/feedback requirement.
- Delivering D79's Character-specific non-response behavior, including attention-seeking window activation or additional foreground/process inspection. Reserve it as reuse of the Heartbeat path rather than a new feature engine.

## Sources

- `docs/T4-HANDOFF.md` sections 3 and 5: current frozen product contracts and dependency order.
- `.trellis/workspace/pleia/t4-second-grill-prep.md`: superseding decisions and obsolete-premise corrections.
- `.trellis/workspace/pleia/t4-decisions.md`: R1-R12, interpreted through the later handoff/Grill rulings.
- `.trellis/workspace/pleia/t4-heartbeat-engine.md`: cadence/event convergence and Companion evolution baseline.
- `docs/ARCHITECTURE-ROADMAP.md`, `CONTEXT.md`, ADR 0008/0009/0010: one runtime, context/Memory and separate execution history.
- `docs/deferred-decisions.md` D78: permission-state/authorization/recovery follow-up remains owner-deferred.
- `docs/deferred-decisions.md` D79 and the 2026-09-11 grill correction: Character-specific non-response behavior is a deferred Heartbeat extension; current frequency reduction does not require an emotional display.
- `docs/TECH-STACK.md` Mobile/deployment topologies, `CONTEXT.md` Node/Host Availability/User Presence, and the Skills/MCP PRD's Offline Execution Host Semantics: one Core authority, phone frontend and independent Host availability.
