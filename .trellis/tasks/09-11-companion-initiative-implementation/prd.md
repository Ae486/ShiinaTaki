# Unified Companion initiative implementation

## Goal

Deliver the confirmed first stage of Companion initiative through TakiAgent's existing execution and monitoring architecture. Taki can notice meaningful conditions, form bounded Character-consistent judgments, follow up on relevant matters, and choose silence, expression or useful speech without a new user message. New behaviors normally change Pattern data and purpose descriptions; they do not introduce another Agent loop.

## Authority, baseline and task ownership

The owner requested this new Trellis task on 2026-09-11 after confirming two boundaries: missing proactive capabilities belong in the current implementation, and the reused Run/Agent/Effect pipeline must feed the existing DSH-style Monitor. The parent task [T4 Heartbeat](../09-08-t4-heartbeat/prd.md) retains the earlier discovery and grill record. This task owns the consolidated requirements, technical design, child-task sequence and integration acceptance.

The owner approved development and the T4-local baseline snapshot integration. The current entry contract is `research/baseline-snapshot-contract-2026-09-19.md`; first verify the combined main/T4 baseline, then implement the children in order. Prepared artifacts do not claim completed implementation, runtime acceptance or a passed quality gate. Commit, push and finish/archive remain separate actions.

- Workspace: `H:/TakiAgent-worktrees/t4`.
- Branch: `task/t4-skills-mcp-productization`.
- Verified planning baseline: T4 `a35d273`; incoming local main `3c63a80`.
- The native session task pointer is authoritative. The unrelated Avatar Lab/global breadcrumb must not redirect this work.
- User-facing communication is Simplified Chinese; engineering artifacts are English.

## Scope and terminology

"Companion initiative" is the broad product scope used in the discussion. Existing protocol meanings remain separate: `heartbeat` is Class B autonomous judgment; `scheduled` is user-expected Class A work; maintenance uses its existing internal policy. This task delivers the first Heartbeat product loop and shared adaptations needed for it, while preserving the existing Scheduled provider.

Included behavior sources are supported time conditions, authorized activity transitions/dwell, fresh user-interaction opportunities, finite follow-up Intentions and attributable existing Run completions. The implementation must publish the supported vocabulary; unavailable observations cannot be invented by a Pattern or prompt.

## Requirements

### Shared execution and behavior definition

- **R01 — One execution and monitoring path.** Reuse Core Run/Attempt/Event/Effect identity, admission, the existing ChatAgent/Main Model loop, governance, recovery, Timeline delivery and Monitor/Trajectory. Add missing public contracts within those owners. A Heartbeat is inspectable through ordinary Run queries; no independent Heartbeat transcript, model loop, execution ledger or monitoring pipeline is introduced.
- **R02 — Unified eligibility.** Approximate cadence and meaningful typed Signals pass one deterministic policy before model execution: source permission, freshness, dwell where applicable, deduplication/coalescing, active Pattern or valid Intention, cooldown, quiet hours, busy state and budget. A raw activity change, connection recovery, bare elapsed tick or Privacy Pause release is insufficient by itself. Optional chance can only suppress eligible work.
- **R03 — Data-defined Patterns.** One Character-scoped Core authority owns seed, user-authored and Agent-proposed Interaction Patterns. A Pattern records supported conditions, interaction purpose, bounded context references, allowed outcomes, cadence/cooldown/expiry, optional chance, provenance, evidence, revision and lifecycle. It stores no fixed dialogue and grants no permission. New signal sources and new governed capabilities may require adapters; ordinary new behavior should reuse existing mechanisms.
- **R04 — Complete conversational authoring.** A user describes an interaction; the Companion clarifies ambiguous or unavailable conditions, creates a reviewable candidate, presents its effective parameters, obtains concrete confirmation, and activates that exact candidate. Conversation and panel share revision, pause/resume, readable history and rollback. Autonomous discovery and automatic long-term activation are outside this delivery.
- **R05 — Readable candidate review.** Candidate/revision cards may reuse permission-card presentation, with Pattern-specific actions. They explain purpose, reason/source, conditions/observation basis, thresholds and units, outcomes, cadence/limits/time range/expiry, state and meaningful changes. Opaque IDs, hashes, internal revisions/generations and metadata dumps are absent from visible, expanded, accessible, tooltip and copyable content. Internal concurrency identity remains intact. Confirmation activates a Pattern, never a Capability permission.

### Intentions, context and output

- **R06 — Finite automatic Intentions.** The Companion may form a source-backed one-shot follow-up Intention without an individual review card. Every Intention has a finite window and Character/source identity. Expired Intentions leave eligibility immediately and cannot catch up after offline time, restart or reconnect. Re-reading an old source cannot silently renew the same expired trigger.
- **R07 — Preserve the matter, expire the arrangement.** Intention expiry neither deletes the underlying user-reported matter nor marks its outcome resolved. Normal Memory retention, deletion, correction and authority rules apply. Bounded related-memory access can support a spontaneous question in a new independently eligible interaction, including before the user speaks. Old generated text is not replayed. No new user-facing archival feature is required.
- **R08 — Bounded Character context.** Use stable Persona, relevant user/relationship Memory, already-permitted scrubbed observations, User Timezone, selected Signals/Patterns and valid Intentions. Preserve provider-neutral Memory Blocks/index and explicit pull. Do not replay the whole relationship window, dump a graph, create a second memory authority, invoke conversational auto-memory or advance primary pressure/flush watermarks. The same global Main Model handles Companion judgment; Utility remains maintenance-only. Missing Companion State or Memory evidence stays absent/unknown.
- **R09 — Structural outcome and separate delivery.** Each admitted Heartbeat terminates through a typed `silent | express | speak` decision. Silence and avatar-only results produce no fake user message or empty relationship turn. Only actual speech enters the ordinary Timeline, and Pet displays it as one complete proactive utterance. Execution completion, selected outcome, publication, presentation and user response remain different facts. Invalid/non-terminal model output fails quietly with a recorded reason.

### Policy, privacy and lifecycle

- **R10 — Independent budgets and clocks.** Model eligibility, delivered-utterance limits, delivery gap, quiet hours, busy deferral, output TTL and non-engagement backoff are separate. Class A work is not charged to Class B. Use the persisted IANA User Timezone, not VPS process time. All calibration values are visible configuration rather than permanent product constants.
- **R11 — Bounded concurrency and recovery.** Primary interaction wins admission over background work. A busy deadline never authorizes interrupting an active user/tool chain. Duplicate candidates, late results, cancelled/revoked work and restarted deliveries preserve one Run and one relevant effect/output identity. Holding an output must not hold the Character execution slot. Uncertain effects are not replayed; stale speech/animation is discarded.
- **R12 — Effective privacy and authority.** Privacy Pause closes Sampling-derived sources, invalidates their observation generation and discards unconsumed Sampling wake reasons. Resume requires fresh permitted evidence. Clock, Memory and known-completion sources retain independent eligibility. Heartbeat v1 uses narrow Core reads, relevant Skills and Companion presentation; it performs no exec, external side effects or extra sensor acquisition. Unattended ask/deny/unavailable paths report truthful bounded reasons without surprising dialogs. Pattern controls cannot change consent or grants.

### Presence, feedback and observability

- **R13 — Evidence-backed presence.** Core aggregates fresh evidence from authenticated clients/devices while keeping connectivity, User Presence, specific-action readiness, Host availability and message presentation separate. Missing/stale evidence is unknown. A persistent VPS or background phone connection is not proof that the user can respond. Reserve phone-frontend support in Shared/Core; implement Desktop producers only.
- **R14 — Honest response opportunity.** Repeated non-engagement may gradually reduce Class B frequency only when the specific utterance has real presentation evidence and a valid opportunity to respond. Presence elsewhere alone does not prove that a message shown on another device was available to the user. One utterance shown in multiple windows/devices counts once. Absence, unknown presentation/presence or unavailable evidence cannot be treated as being ignored. Explicit preferences and actual replies override weaker inferred feedback. No emotional-display requirement is added.
- **R15 — Existing Monitor coverage.** All admitted Heartbeats use the existing execution ledger, query service, subscriptions, Monitor and Trajectory. Real producers add bounded typed facts for selected candidates, context decisions, structural outcomes, delivery and feedback where existing events are insufficient. Existing model/tool/usage/governance/recovery observations are reused. Pre-admission skips have bounded policy diagnostics and zero fabricated Runs. Replay after restart agrees with live projection; unknown values are not synthesized as zero or success.
- **R16 — Shared management and compatible integration.** Core-owned settings and Pattern/Intention state feed disposable reactive UI projections. Incoming Memory changes, the two migration-035 histories and their existing convergence migrations must be reconciled before relevant integration. Preserve primary chat, Scheduled Class A, privacy, Host generation and current Monitor contracts. Existing waiting/skip behavior remains truthful while a user/device is absent; permitted independent Core work may continue.

## Calibration baseline

The following are already accepted development starting values: deterministic check around 60 seconds; model opportunities around 15 minutes with jitter and at most four per hour; at most two Class B utterances per hour and eight per day; at least ten minutes between delivered utterances; quiet hours 23:00-08:00 in User Timezone; busy deferral at most 90 seconds; stale utterance TTL ten minutes. Backoff starts from the documented bounded `1x -> 2x -> 4x -> daily ceiling` recommendation and resets on a real reply or operator reset.

Additional implementation bounds and presence/feedback timing are explicitly labelled engineering calibration in `design.md`. Reference-project constants are not owner decisions. Development rollout keeps new autonomous dispatch opt-in until its required checks pass; this does not settle a future release's default enablement.

## Acceptance criteria

- [ ] **AC01 / R01:** A real Heartbeat admission uses the existing Run/Attempt/Effect pipeline and appears in the existing Monitor with correct Character, initiator, provenance, class and immutable context; no competing runtime/ledger is introduced.
- [ ] **AC02 / R02:** Cadence and event sources converge. Empty, stale, duplicate, unsupported, disallowed, cooling-down, quiet, busy or budget-exhausted inputs cause zero model requests and an accurate bounded disposition.
- [ ] **AC03 / R02-R03:** Multiple eligible candidates are deterministically bounded/coalesced before one judgment; adding a second behavior over the same supported conditions needs Pattern data rather than another loop.
- [ ] **AC04 / R03:** Seed, user and Agent candidates share ownership, revision/CAS, supported-condition validation and lifecycle; stale confirmation cannot activate a changed candidate.
- [ ] **AC05 / R04-R05:** Natural-language authoring, needed clarification, useful candidate review, concrete confirmation, actual eligibility participation and subsequent revision/pause/resume/history/rollback all work through the same Core authority.
- [ ] **AC06 / R05:** Pattern cards and Monitor fields are readable Chinese and expose meaningful settings/differences without internal identifiers in any presentation surface; existing permission decisions remain unchanged.
- [ ] **AC07 / R06:** Automatically created Intentions retain source identity and finite validity. Expiry is enforced at admission and delivery; no reconnect/restart catch-up or source-replay renewal occurs.
- [ ] **AC08 / R07:** After expiry, the underlying matter remains subject to normal Memory policy and may support a fresh spontaneous follow-up under a new eligible opportunity. No stale utterance or false factual resolution is produced.
- [ ] **AC09 / R08:** Autonomous requests use the intended thin context, one Main Model and authority-captured Memory/tool bindings; retries preserve selected inputs. No primary Timeline replay pollution, auto-memory or pressure-watermark advance occurs.
- [ ] **AC10 / R09:** Silent, expressive and spoken decisions terminate correctly. Only actual speech creates one ordinary assistant Timeline message and one whole Pet utterance; malformed results never leak intermediate prose.
- [ ] **AC11 / R09-R11:** Held text and presentation work release the execution slot, obey TTL and priority, resume without another model call, and never dispatch a tool/Host effect against a terminal Run/Attempt.
- [ ] **AC12 / R10:** Model budgets, delivered-utterance budgets, gap, quiet hours, busy expiry and backoff are independent and restart-safe. Scheduled Class A behavior is not charged or silently suppressed by Class B settings.
- [ ] **AC13 / R11:** Duplicate admission/output/acknowledgement, primary concurrency, cancellation, revoked authority, stale generations and crash windows preserve identity, ordering and non-replay of uncertain effects.
- [ ] **AC14 / R12:** Privacy Pause fences queued/in-flight Sampling evidence and output. Resume, a bare tick or connection recovery alone cannot replay a backlog. Unattended ask/deny and unavailable Hosts never widen authority or open surprise approval UI.
- [ ] **AC15 / R13:** Desktop reports establish presence only from eligible evidence; null idle time, visible-but-unattended windows, VPS uptime and phone background connectivity remain insufficient. Old lifecycle reports expire and cannot override fresh reports from another client.
- [ ] **AC16 / R13-R14:** A phone-contract test proves user interaction can coexist with desktop unavailability; actual displayed-message/device association is required for negative feedback. Cross-window/device duplicate presentation counts once, absence/unknown never count as ignored, and real reply/reset clears the proper backoff.
- [ ] **AC17 / R15:** Existing execution observations plus new business events produce equivalent live and replayed Monitor projections. Pre-admission diagnostics do not inflate Run/model counts; monitor disable/overflow cannot affect execution correctness.
- [ ] **AC18 / R16:** Supported fresh, T4-applied and main-applied migration lineages reach the compatible registry without rewritten history, lost Timeline presentation, lost Memory state or an unintended authority switch; unsupported/unmappable history refuses atomically with a useful diagnosis.
- [ ] **AC19 / R16:** Core/Shared/Desktop checks, real isolated Core execution, existing Monitor replay/reconnect, actual UI flows and required owner trials have separate evidence; no fixture or automated check is labelled owner acceptance.

## Out of scope and preserved follow-ups

- D79 persona-specific non-response behavior such as window activation or new foreground/process inspection; it remains a later consumer of this same initiative path.
- D78's separate permission-system UX/recovery redesign, D69's broader avatar investigation, and unrelated D75/D76/D77 work.
- Full phone application, new sensors, another transport liveness system, production deployment or paid external trials without their existing authorization.
- Autonomous long-term Pattern discovery/activation/evolution, full Companion State/self-model learning, Procedural Knowledge and Experience Review implementation. Preserve the seams and existing completion triggers.
- A separate Heartbeat model slot, runtime, history authority, permission store, archive product, generic workflow DSL or per-behavior hard-coded dialogue.
- Avatar Lab/OpenBiliClaw implementation or changes in other worktrees.

## Development artifacts and source precedence

- [Technical design](design.md) — ownership, contracts, policy, persistence, compatibility and failure handling.
- [Implementation plan](implement.md) — ordered child tasks, acceptance mapping, validation and rollout/rollback.
- [Decision and source register](research/decision-register.md) — effective prior decisions, superseded premises and evidence scope.
- [Reference designs](research/reference-designs.md) — bounded Hermes/OpenClaw mapping; reusable mechanisms and Taki-specific gaps.
- [Runtime and observability research](research/runtime-and-observability.md).
- [Domain and presence research](research/domain-and-presence.md).
- [Design review](research/design-review.md) and [planning validation](research/planning-validation.md) — reviewed contracts, artifact checks and the explicit boundary before implementation evidence.

Latest explicit owner decisions take precedence over older proposals. Live source is authoritative about what exists; it does not silently overrule an accepted desired behavior. ADRs and current executable specs constrain integration. Historical reports and reference implementations supply evidence, not additional product requirements. See the decision register for known stale wording.

## Definition of done

Every child passes its scoped implementation/check gate and the parent acceptance matrix is closed with evidence. Source and corresponding specs remain synchronized. Migration compatibility, restart/cancellation, privacy/authority and same-Monitor proof are mandatory. Unperformed owner checks remain pending. This planning task's preparation does not mark those implementation acceptance boxes passed.
