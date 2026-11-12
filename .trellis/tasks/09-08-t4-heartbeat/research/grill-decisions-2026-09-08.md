# Heartbeat product-boundary grill - 2026-09-08

Status: planning. This record captures owner decisions and the remaining question queue; it is not production implementation approval.

## Confirmed: first authoring delivery

The owner agreed to the proposed complete user-initiated conversational authoring loop, including management of existing Patterns. Its six acceptance checks are recorded in `../prd.md`: natural-language creation, necessary clarification, useful candidate disclosure, confirmation before activation, actual participation in Heartbeat eligibility, and subsequent revision/pause/resume/history/rollback with Agent/panel parity.

The source request is explicit user intent. Autonomous discovery and proposals from accumulated feedback, and automatic adjustment/activation, remain later bounded evolution work. Keep those stages visible rather than treating the first delivery as the final Companion design.

No part of the accepted scope requires the model to speak whenever a Pattern matches. Matching arms the existing judgment path; deterministic limits still apply and structural silence remains valid.

## Confirmed: readable candidate and revision cards

The owner permits reuse of the existing permission-approval card presentation and requires meaningful parameters/descriptions so the user can tell what is being proposed. Information must be relevant and readable; meaningless hashes and IDs are explicitly excluded.

The card must answer, using current structured proposal data:

- What interaction is being created or changed, and why it was proposed.
- What supported observations and conditions it depends on, including useful thresholds and units.
- What the interaction is intended to accomplish and which outcomes are allowed; do not store fixed dialogue as the Pattern.
- What cadence, cooldown, effective limits, time range and expiry apply.
- Whether the proposal is awaiting review or already active/paused, and which meaningful parameters changed for a revision.

Use readable titles and domain actions such as enabling or adjusting a Pattern. User-facing IDs, hashes, internal revision/generation values, raw schema names and metadata dumps have no place in the main card, expanded details, tooltips, accessible descriptions or copied explanations. This extends the already-ratified D65/G4 information rule to the new surface while preserving internal binding and concurrency data. Business parameters remain visible when they help the user decide.

## Verified presentation reuse boundary

Source inspection in the T4 worktree after semantic discovery:

- `apps/desktop/src/components/approval/approval-dialog.tsx:51-59` renders the shared dialog, readable title, summary, details, feedback and actions.
- `apps/desktop/src/components/approval/approval-dialog.tsx:89-100` renders titled sections of labelled values, a useful presentation reference for Pattern parameters.
- `apps/desktop/src/components/approval/approval-dialog.tsx:14-28` currently accepts `CanonicalApprovalRequest` and permission-specific choices such as one-time/session/always allow.
- `apps/desktop/src/components/approval/approval-dialog-controller.ts:26-38` owns `approvalRespond`, Approval notifications and permission choices; it is not a generic Pattern controller.

Reuse the presentation as appropriate during implementation, while keeping Pattern lifecycle operations on the Core Pattern authority. A Pattern confirmation must not masquerade as a permission grant or silently route through permission-specific approval choices. Any reusable view extraction must preserve the existing Approval disclosure and authority behavior.

`CONTEXT.md:51-56` already defines Interaction Pattern and its no-permission boundary. The owner did not change a domain term here, so no glossary expansion or ADR is needed for this presentation/scope decision.

The semantic index reported revision `82e0a4a`; the cited files were then read directly from the working tree at `a35d273`. This is source-backed planning evidence, not UI implementation or runtime acceptance.

## Confirmed: automatic Intentions and expiry

The owner accepted automatic formation of one-shot follow-up Intentions without per-intention review. Every Intention must have a time limit and disappear from active eligibility when it expires. If the Agent was offline and the window passed, the missed trigger must not execute when it returns.

The owner also clarified that expiry must not mean absolute forgetting: a previously mentioned interview can still be a subject of a later natural question. The statement that the user planned an interview, the Agent's plan to ask during a particular window, and a generated utterance are distinct. Expiring the plan or an undelivered utterance does not establish whether the interview happened or what its outcome was. Ordinary Memory retention, user deletion/correction and privacy rules continue to apply.

`CONTEXT.md` now defines Intention at the domain level: a one-shot plan with finite validity, separate from the user-reported matter and a recurring Pattern. This does not add a storage schema or an archival subsystem.

### Source evidence and proposed handling

The following are verified implementation facts, not proof that the proposed Heartbeat lifecycle is already built:

- `packages/core/src/memory/retention-sweeper.ts:23,89-95` and `retention-sweeper.test.ts:89-98` preserve an expired legacy intention's Markdown file while archiving it out of active use. This is a legacy Memory mechanism, not the new provider-neutral Heartbeat contract.
- `packages/core/src/memory/runtime-composition.ts:37-43` selects legacy or canonical Memory before composing the runtime. `canonical-local-runtime.ts:21,36` makes legacy retention inert after canonical selection.
- `packages/core/src/memory/canonical-local-runtime.ts:41-53` assembles Persona, bounded Memory Blocks and pinned records; it does not automatically place every relevant past matter into context. `local-memory-provider.ts:87-101` exposes bounded explicit recall.
- `packages/core/src/memory/local-memory-provider.ts:200-204` projects an expiring Memory retention policy, but `packages/core/src/db/canonical-memory-sparse-repo.ts:33` alone does not enforce a Heartbeat validity window. Memory text or a retention attribute cannot substitute for an execution eligibility check.
- `.trellis/tasks/08-09-memory-runtime-integration/prd.md` plans bounded automatic foreground recall; this task is still in planning. Do not claim that it guarantees current context coverage or revive an obsolete assembler to provide it.
- The glossary's existing Visibility Ladder uses "archived" for a Memory item outside all indexes. Reusing that meaning would not itself make the user's interview matter naturally recallable.

Recommended implementation direction under the confirmed behavior: maintain a minimal non-runnable expiry/disposition record as part of the Intention lifecycle; retain/refer to the user-reported source through normal conversation/Memory authority; let bounded relevance-based recall support a fresh judgment in an appropriate later context. Avoid a new user-facing archive queue and avoid automatically copying every expired Agent plan into factual Memory. Expiry must be checked before admission and before delivery, without relying on a periodic cleanup pass. No old timer, queued wake or stale generated text is replayed. Merely re-reading the same source cannot silently regenerate the expired Intention with a later deadline.

This recommendation concerns logical responsibilities, not a decision to add two stores or a new Memory layer. The concrete representation, retention window and provider-neutral query seam remain design work.

## Confirmed: subsequent spontaneous follow-up

After clarification using the missed-interview example, the owner explicitly accepted that Taki can later initiate a natural follow-up without waiting for a user message, and described this as part of Agent initiative.

The expired timing opportunity remains closed. A new independently eligible Heartbeat can use relevant remembered matters and current context to decide whether to ask, express or remain silent. Related memory may shape the subject of this fresh interaction; the old Intention is not itself revived as the wake reason and an old generated utterance is not released. A user conversation remains another valid context, but is not a prerequisite for later follow-up.

This confirms behavior, not guaranteed recall in the current runtime. Bounded Memory retrieval, current-source eligibility, topic continuity and evidence for the fresh decision remain implementation design and acceptance work. Preserve the unknown outcome of the user-reported event until actual user/effect evidence resolves it.

## Confirmed: adaptive frequency and presence-aware feedback

The owner accepted autonomous frequency reduction after non-engagement and added that user absence must not be mistaken for ignored messages. The neglected/disappointed/annoyed illustration was an explanatory interpretation, not a requested outward-emotion feature. The 2026-09-11 correction below supersedes the earlier wording that could imply such an acceptance requirement. Preserve ordinary Persona consistency without adding these reactions to the current delivery.

Current source inspection after semantic discovery found:

- `packages/core/src/server/timeline-subscriptions.ts:10-15,48-53` fans committed content to sinks. This proves publication, not per-message visual presentation or human reading.
- `packages/shared/src/chat-schema.ts:33-50` accepts a Character, message and attachments and returns an accepted message/Run identity. This path does not associate a user reply with a particular proactive utterance.
- `apps/desktop/src/features/chat-bubble/bubble-visibility.ts:13-23` combines bubble opening and document visibility; this is local UI state, not evidence that a person read the text.
- `apps/desktop/src/features/chat-bubble/bubble-activity-binding.ts:72-84` gates local presentation and publishes to `chat-bubble-store.ts`. These seams do not provide a Core-owned per-message presentation acknowledgement.

Confirmed feedback direction, refined by the User Presence requirement: confirmed lack of presentation, offline delivery, user absence, unknown presentation or unknown user presence must not count as ignored messages. Presentation plus fresh presence creates an opportunity to respond, not proof of human reading. No response is weak non-engagement evidence that may contribute to gradual backoff after repeated instances. Explicit user preferences remain stronger than inferred feedback. Existing hard Class B limits still apply when engagement is unknown.

The implementation needs bounded real presence/presentation producers and explicit unknown states before enabling this counter; it must not infer them from `connected`, a Timeline row or a successful socket notification. Exact Core/client contracts and configurable evidence/observation windows are engineering design work.

## Confirmed: User Presence, VPS Core and future phone frontend

The owner requires Taki to know whether the user is present, especially when Core runs on a VPS and a future phone app is only a frontend. User Presence must help prevent false non-response attribution and attempts to rely on a user who is not available. This is not a decision to stop all autonomous Core work whenever a client disconnects.

Existing source-backed decisions already establish the topology:

- `docs/TECH-STACK.md:77-80` colocates Core and its database, explicitly supports a persistent VPS Core, and identifies the phone as a pure frontend. The earlier mobile paragraph calling the phone a read-only Node was inconsistent with this deployment statement and has been aligned with the owner clarification.
- `packages/shared/src/connect-schema.ts:26-38` already distinguishes an operator client from a capability-providing Node: operators cannot declare capabilities or an Execution Host; Nodes require Host protocol support.
- `.trellis/tasks/08-10-skills-mcp-productization/prd.md:100-116` defines per-Host availability separately from a global user-online flag and permits Core-only work while user Nodes are offline. Sampling-derived work loses eligibility when its source is unavailable.
- `.trellis/spec/backend/host-operation-lifecycle.md:243-269` freezes Host ownership, bounded Class A wait/receipt behavior and explicit resume; Heartbeat does not create an offline Host backlog.
- `packages/core/src/server/connection-registry.ts:8-17,69-85` records authenticated device/role/capability/Host connection facts. It does not establish a human user's presence.
- The existing local bubble visibility evidence described above is a reusable source boundary, not a complete cross-device presence service.

Exact searches for common User Presence/report/activity identifiers in Shared, Core, Desktop and Rust source found no corresponding cross-device User Presence producer. This absence is bounded; the adjacent handshake/connection/presentation code was read directly. The semantic index reported `82e0a4a`; direct reads used the working tree at `a35d273`. No live presence, phone behavior or UI acceptance is claimed.

### Design reservations

1. Core owns the aggregate User Presence projection; authenticated clients provide bounded source facts. Reserve recent explicit interaction and application/surface state, evidence freshness, expiry, lifecycle retirement and unknown states. Do not introduce new ambient sampling outside existing permissions or Privacy Pause rules.
2. Device reports remain distinct before aggregation. A desktop becoming unavailable cannot erase fresh phone activity; a stale background connection cannot keep the user present indefinitely. Presence, interruptibility, per-message presentation and execution capability are separate axes.
3. A future phone app is an operator/presentation frontend of the same Core. A background socket or push route proves reachability only. Optional future native capability providers require their own governed Node contract; they are not assumed in the phone frontend.
4. The Agent receives a bounded, understandable presence/readiness view for the current decision. Unknown presence is not fabricated as online/offline or interpreted as rejection. User-facing projections retain readable status, source meaning and useful freshness rather than raw device IDs or metadata dumps.
5. Presence may feed a meaningful Signal and interaction readiness through existing Wake Policy. Actual fresh user activity is distinct from a socket reconnection; multiple clients/windows must not generate duplicate wakes or feedback counts. No stale message or expired Intention is revived when the user returns.
6. User absence affects user-dependent interaction and feedback. It does not globally stop Core-only work already permitted by policy, imply a Host is available, grant permission, or replace existing wait/skip/expiry/receipt contracts. Successful replies/presentation and missing feedback must have source-backed producers before the Agent reasons about them.

Representative acceptance scenarios: VPS continues with no user client; phone foreground activity while desktop is off; background connected phone with no fresh user evidence; stale reports after reconnect; one of two clients disconnecting; duplicate presentation of one message; user returns after an Intention/message expired; a task needs a particular offline Host even while the user is reachable elsewhere.

## Owner correction and deferred Character behavior - 2026-09-11

The owner corrected the interpretation of the earlier emotional metaphor and proposed a different, explicitly deferred direction: when the user is present but has not replied for a prolonged period, the Character may take a fitting action rather than every Character merely displaying the same disappointment.

Illustrative examples supplied by the owner:

- Taki may make a restrained check-in, such as asking whether the user went to do something else.
- Anon may bring the conversation page to the foreground using an available governed operation, potentially exec or another capability.
- Soyo may inspect permitted foreground/process context before choosing what to say.

These examples describe Character intent and variation, not fixed scripts, engine branches or a new subsystem. The owner explicitly places the work in a deferred item and expects reuse of Heartbeat Signals/Wake Policy, Interaction Patterns, Persona/context, Run execution and existing tool/presentation capabilities. `docs/deferred-decisions.md` D79 records the work as OPEN and not scheduled.

Current acceptance still includes User Presence, truthful feedback and bounded autonomous frequency reduction. It does not require a neglected/angry display, attention-seeking window activation or the additional observations/actions in these examples. When D79 is selected later, permission, Privacy Pause, Host availability and the allowed unattended tool profile must be reviewed normally; a Persona supplies behavior, not execution authority.

## Remaining planning work

The three original product-boundary topics remain resolved at direction level after the 2026-09-11 correction: conversational Pattern authoring, finite automatic Intentions with later initiative, and adaptive frequency with presence-aware feedback. D79 preserves the deferred Character behavior direction without expanding this delivery. No additional mandatory product question has emerged from this scope audit. Continue technical design and implementation planning; bring back a concrete product trade-off only if source integration exposes one, not protocol fields or routine timing constants.

The fixed runtime, Main Model, source-driven Privacy Pause, permission, delivery-class and configurable-default decisions are not reopened. Migration lineage, queue admission, context composition and tool isolation remain engineering review work.
