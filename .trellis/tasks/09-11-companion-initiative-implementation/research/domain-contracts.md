# Research: Companion initiative domain contracts

- Query: Define typed Pattern and finite Intention lifecycles, supported Signal conditions, Memory boundaries, and privacy-generation constraints.
- Scope: Internal source and existing planning records; no new external survey.
- Date: 2026-09-11
- Status: Development-design input. Product decisions are ratified only where attributed to the parent PRD/grill; schema names and timing values marked recommendations are engineering proposals.
- Work boundary: `H:/TakiAgent-worktrees/t4`; this report is one of the three owned research files listed in [the index](domain-and-presence.md). No production files or task pointers were changed.
- Companion part: [Presence contracts](presence-contracts.md) contains sections 8-12, the full validation matrix, related specs, external-reference note, and integration caveats. Load both parts for implementation.

## Findings

### 1. Readiness and source precedence

There is no newly discovered product question that must block development planning. The complete conversational authoring loop, finite automatic Intentions, later spontaneous memory-backed follow-up, evidence-backed presence, and cautious frequency reduction are already confirmed. The remaining work is engineering design and implementation, with source-fidelity and Memory integration gates.

Use the new task PRD together with the full parent `09-08-t4-heartbeat/prd.md` and `research/grill-decisions-2026-09-08.md`. The dated 2026-09-11 correction supersedes earlier emotional interpretations. `CONTEXT.md:30-33` defines Companion Initiative; `CONTEXT.md:56-65` defines Pattern and Intention; `CONTEXT.md:225-227` defines User Presence. `docs/T4-HANDOFF.md:393-439` freezes the shared wake/runtime/Pattern direction and `:449-479` freezes Memory, privacy, permission, and ordinary Timeline delivery.

| Ratified behavior | Engineering consequence; not a new product decision |
| --- | --- |
| Patterns are Core-owned, versioned, Character-scoped data and never grant permission. | One domain service and revision history serve tools, candidate cards, and the panel. |
| A long-lived candidate activates only after review of the concrete proposal. | Bind confirmation to the actual immutable candidate and current base revision; do not let an Agent tool fabricate an operator confirmation. |
| Automatic one-shot Intentions require no per-Intention card and must expire. | A Core lifecycle record owns wake eligibility separately from source facts and generated speech. |
| Expired plans cannot catch up, but the related matter can inform a fresh proactive interaction. | Keep normal Memory/source retention and perform bounded relevance reads during a genuinely new eligible opportunity. |
| Presence, presentation, capability availability, and connectivity differ. | Preserve distinct evidence axes and explicit unknown; never infer reading or rejection from a socket or Timeline row. |
| Repeated real non-engagement may reduce Class B frequency. | Require bounded source-backed opportunities to respond, deduplicate per message, and use weak feedback without emotional scoring. |
| D79, D78, phone implementation, and autonomous long-term Pattern evolution are deferred. | Reserve extension contracts; do not add exec, window activation, new sensor acquisition, permission pages, or automatic permanent rule edits. |

### 2. Verified files and concrete seams

| File / reference | Verified responsibility and implication |
| --- | --- |
| `packages/core/src/perception/perception-layer.ts:114-145` | Sole composition of Privacy Pause, foreground activity, screen context, and source-change hooks. Attach accepted evidence here rather than add an independent sampler. |
| `packages/core/src/activity/activity-layer.ts:10-24` | Existing 30-second sampling, two-sample dwell, 180-second idle threshold, two-hour rolling activity, and 240-entry bound. These describe current sensing, not final initiative defaults. |
| `packages/core/src/activity/activity-sampler.ts:144-172` | Checks pause/Host before the routed request, validates output, seals sensitive samples, scrubs titles, then publishes accepted activity. A pause-generation check after asynchronous work is absent. |
| `packages/core/src/activity/activity-state.ts:23-29,79-109` | Bounded coalesced activity; **`idleSeconds: null` becomes `idle: false`**. This legacy display boolean cannot establish human presence. |
| `packages/core/src/activity/activity-state.test.ts:116-121` | Existing test intentionally treats unknown idle as active. Add a separate truthful presence contract; do not infer it from this behavior. |
| `packages/shared/src/capability-outputs.ts:71-78` | The wire source still preserves nullable `idleSeconds`, so unknown can be retained before the lossy activity projection. |
| `apps/desktop/src-tauri/src/capabilities_impl/foreground_window.rs:40-52,91-114` | Authorized foreground sampling already returns session idle from `GetLastInputInfo`; it may return idle even without an available foreground window. This is not a hardware-only-input guarantee. |
| `packages/core/src/capabilities/route-capability.ts:35-38,55-91` | Route success currently exposes only `output` to consumers, although routing knows Host/connection/catalog generations. Sampling provenance must preserve the actual dispatch identity; it cannot guess a Host afterward. |
| `packages/core/src/perception/privacy-pause.ts:44-73` | Absolute pause deadline, durable-write-before-live-state, lazy expiry on read, operator-owned mutators. Preserve the single writer. |
| `packages/core/src/perception/ambient-screenshot-sampler.ts:165-181,232-256` | Accepted VLM descriptions publish after asynchronous work. Existing output is text, not structured evidence of fatigue, emotion, or a business event. |
| `packages/core/src/perception/screen-context.ts:20-42` | Single in-memory observation with read-time staleness. Age alone does not provide a consent-generation fence. |
| `packages/core/src/memory/assembler.ts:60-74,108-114` | Legacy `pickIntention` selects one mood-gated Memory row by matching the current user message's disclosure hint. It is neither a due-plan store nor autonomous admission. |
| `packages/core/src/memory/runtime-composition.ts:37-43`; `canonical-local-runtime.ts:21-53` | Runtime selects legacy/canonical authority; canonical mode retires legacy maintenance and assembles Persona, Memory Blocks, and pinned records. It does not install the legacy Intention picker. |
| `packages/core/src/memory/memory-provider.ts:8-12`; `packages/shared/src/memory-provider-operation-schema.ts:64-69` | Existing provider-neutral call context and bounded recall request are the right Memory read seam. Root must reconcile them with incoming main before implementation. |
| `packages/shared/src/memory-provider-domain-schema.ts:60-72,95-115` | Source identity, provenance, lifecycle, and expiring retention exist as canonical Memory concepts. Memory retention is not execution eligibility. |
| `packages/core/src/server/connection-registry.ts:8-17,69-99` | Authenticated device/role facts, per-Host generations, current-Host checks, and removal listeners. Operators have distinct simultaneous socket lifecycles, without a Core operator-presence producer today. |
| `packages/shared/src/connect-schema.ts:26-43` | Operators cannot declare an Execution Host or capabilities; Nodes must negotiate Host support. Phone presentation does not confer desktop capability availability. |
| `apps/desktop/src/lib/device-identity.ts:22-35`; `operator-auth.ts:23-35` | Pet/Home/Chat use the same origin's persisted operator device identity and authenticate it normally. This identity is not the Rust Node's separately persisted Host identity (`apps/desktop/src-tauri/src/node.rs:139-171`). |
| `apps/desktop/src/windows/home/use-home-connection.ts:1-21`; `apps/desktop/src/windows/home/pages/chat/use-chat-connection.ts:1-24`; `apps/desktop/src/windows/pet/use-core-connection.ts:13-25` | Independent Home, Chat, and Pet connection owners. A device-level last-write-wins presence map would lose concurrent-window truth. |
| `apps/desktop/src/lib/active-character.ts:1-8`; `packages/shared/src/character-schema.ts:10-15`; `packages/core/src/server/methods/chat-send.ts:61-76` | Desktop currently fixes the active Character to `taki`; Core import/list/costume APIs do not define a selected-Character authority, and chat admission takes the explicit request's Character. |
| `apps/desktop/src/lib/connection-generation-controller.ts:30-33,154-174,242-260` | Disposable candidate generations and `isCurrent()` checks are suitable reporter lifetimes; reconnect never replays caller mutations. |
| `packages/core/src/server/timeline-subscriptions.ts:10-15,48-65` | Fan-out proves publication only, not actual message display or reading. |
| `apps/desktop/src/windows/home/pages/chat/restore-chat-timeline.ts:50-65`; `apps/desktop/src/windows/home/pages/chat/timeline-view.tsx:73-112` | Existing guarded committed-message restoration and stable DOM row/scroll identity; extend at actual rendered message visibility, not at network receipt. |
| `apps/desktop/src/features/chat-bubble/bubble-visibility.ts:13-23`; `bubble-activity-binding.ts:67-94` | Bubble-open/document visibility and guarded presentation are reusable local gates. A store update does not prove successful text rendering or user attention. |
| `apps/desktop/src/components/approval/approval-dialog.tsx:14-28,51-100`; `approval-dialog-controller.ts:26-38` | Reusable dialog/labelled-section presentation exists, but the current props/controller are explicitly permission-specific. Pattern review must not call `approvalRespond`. |

### 3. Recommended domain ownership and schemas

These are sketches for the task's `design.md`, not new public type declarations or instructions to create every listed table. Use the existing Core database and transaction patterns; keep runtime execution in the existing Run/Attempt/Effect ledger.

| Domain record | Minimum fields / ownership |
| --- | --- |
| Pattern identity | Core-issued ID, Character, lifecycle `proposed`, `active`, `paused` or `retired`, current version/CAS token, effective accepted revision, optional pending candidate revision. |
| Immutable Pattern revision | Base revision, title, purpose, bounded typed conditions, eligible context references, allowed outcomes, policy knobs, optional activation/expiry range, origin, source/evidence refs, readable change summary, creation/review provenance. |
| Intention | Core-issued ID, Character, trusted source anchor/key, bounded purpose, finite `notBefore`/`expiresAt`, time basis, state, originating Run/user input, optional assigned Run, terminal disposition. |
| Normalized Signal | Closed kind, provider/source identity, source event key, Character scope where applicable, observed/received time, expiry, source generation, bounded fact payload, cause/origin references. |
| Presence source | Core-authenticated connection identity plus one source/surface instance, monotonic sequence, accepted receipt time, bounded evidence age, evidence kind, effective expiry, independently reported surface state. |
| Message presentation | Existing committed message/utterance identity plus Character, authenticated presenting connection/surface, bounded actual exposure interval and current lifecycle. No copied transcript or delivery queue. |
| Feedback disposition | One Character/message record linking presentation, eligible response-opportunity duration, user engagement, deadline, and settled result. Derived counts never become a second execution history. |

Shared owns closed wire validation and useful labels. Core owns validation, state transitions, source binding, durable policy state, and read projections. Desktop owns temporary drafts and real client/source reports. Memory remains the authority for factual/relationship content. A Pattern or Intention references Memory; it does not become a replacement Memory provider.

Recommended initial condition grammar: an `all` list of at most eight closed conditions; individual conditions may allow a bounded set of alternatives such as approved application names. Avoid arbitrary scripts, SQL, regular-expression programs, deep boolean DSLs, or model-written evaluators. Unknown/missing source facts make that condition ineligible and produce a truthful reason.

Effective policy is the intersection of current hard Class B limits, user preferences, source permissions/freshness, and the Pattern's tighter parameters. A chance setting only suppresses a deterministically eligible candidate. Silence always remains allowed, even when a user requested a speaking-oriented Pattern. Store interaction purpose rather than fixed dialogue.

### 4. Pattern lifecycle and conversational review

Recommended transition rules:

1. `propose` creates a non-runnable candidate using supported conditions. Core binds its source to the actual foreground user request/tool invocation. The Agent may not forge an operator reviewer.
2. Confirmation of the displayed concrete candidate atomically makes its revision effective and moves a new Pattern to `active`. The request carries the internal candidate identity and expected base/version; the UI never exposes those values as content.
3. Revising an active/paused Pattern creates a separate pending revision while the current effective revision keeps its existing status. Merely drafting a revision does not pause or replace an active rule.
4. Confirming a revision installs exactly that revision. If either the base or candidate changed since display, return a conflict with the new readable proposal; do not accept an old confirmation against new content.
5. Pause immediately blocks future admission. Revalidate an already admitted Pattern-dependent run/result before any new user-facing effect. An already committed utterance remains ordinary history and cannot be described as undone.
6. Resume re-enables a previously accepted revision only through an explicit user action, after rechecking current validity and policy. It does not recover expired opportunities or create a catch-up queue.
7. Rollback copies a selected previously accepted definition into a new revision under current CAS and policy, with a readable comparison. It does not rewind version counters, delete history, restore revoked permissions, or replay prior interactions.
8. Retire removes the Pattern from future consideration; history remains subject to normal retention. Restart restores accepted active/paused state and leaves unconfirmed candidates inactive.

The conversational loop is: user description -> necessary clarification of unsupported/ambiguous conditions -> Core-validated candidate -> readable confirmation card in conversation -> explicit user confirmation -> actual shared-wake eligibility -> later management through conversation or panel. Tools can list/read/propose/revise and perform permitted explicit-user management; autonomous runs cannot self-confirm long-lived rules.

The required confirmation can be a domain action on the card presented inside conversation; this already satisfies the confirmed conversational review requirement without treating free text as a permission grant. If typed confirmations are added, accept them only when bound to one concrete current candidate and an actual foreground user input; multiple pending or changed proposals require renewed disambiguation. Do not add a heuristic that treats arbitrary “yes” as durable approval of whatever the Agent names.

Reuse the existing Dialog, feedback, labelled fields, focus handling, and action presentation where useful. Keep a Pattern-specific controller/service. Do not send permission choices such as `allow_once`/`allow_always`, write Approval records, or modify capability grants. The candidate record is Pattern domain history, not another permission store.

Cards must explain intent, reason/source, supported conditions and thresholds with units, outcomes, effective limits, time range/expiry, current state, and meaningful changes. Include unavailable sources honestly. Keep IDs, digests, internal revisions/generations and schema dumps out of visible content, expanded sections, tooltips, accessible names, and copied explanations. Loading, conflict, rejected, stale, and success states retain the actual draft and concrete reviewed target. Closing a card or losing a connection never activates a candidate.

Seed definitions use this same authority and stable seed identity. Updating bundled seed data must not overwrite a user revision, pause, or enablement decision. Whether initial seeds are enabled is an explicit rollout/configuration choice; this report does not invent an owner-approved default.

### 5. Finite Intentions and normal Memory

#### Automatic formation and source binding

Use a narrow Core domain operation from an existing Agent turn to form a one-shot plan; no second background model pass is required. The caller supplies bounded plan purpose and a finite proposed validity window. Core supplies the actual Character, Run/Attempt, and validated conversation/Memory source identity from the captured context. Prefer a new actual user message or a newly confirmed source revision over an unrestricted “read any old memory and schedule it” tool.

Source bindings should distinguish a Timeline anchor from a canonical Memory reference. A Memory reference includes the applicable authority epoch, Bank, logical identity and revision/confirmation state; a source's pending state remains explicit. Do not treat Memory provider synchronization, pending-outbox status, or automatic recall as a new wake by themselves. Incoming main Memory behavior must be integrated before deciding the concrete read/write adapter.

Core owns a stable source-opportunity key, independent of generated wording. At minimum deduplicate the same Character + trusted source anchor + one-shot purpose/occurrence. Replaying the same tool invocation or reading the same source again cannot extend the deadline or recreate a terminal Intention. Meaningfully new user evidence can form a new plan with its own provenance; the old record remains terminal.

The Intention's timing is a plan, not a claimed event fact. Keep reported event timing and policy-derived follow-up timing distinguishable. A vague statement cannot justify inventing an interview start/end or outcome. When automatic formation cannot establish a useful bounded window, abstain or clarify in the ordinary conversation. A finite policy-derived plan deadline can be selected without presenting it as something the user reported.

The seven-day recommendation bounds the default active window (`expiresAt - notBefore`), not creation-to-expiry. A source-backed future event may have a later finite window. It remains an automatic Intention; only explicit reminder/task intent selects Scheduled Task.

#### Recommended transition sketch

| State / event | Result |
| --- | --- |
| Formed, valid but not due | `active`; no wake until `notBefore`, subject to current source/policy. |
| Due but busy, quiet, unauthorized or otherwise ineligible | Remain bounded by the original expiry; do not slide the window. Pre-admission checks do not create a Run. |
| Atomically assigned to an admitted Run | `claimed(runId)`; duplicate Signals join/refuse the same assignment rather than create another run. |
| Judgment settles, including intentional silence | Close as consumed with the actual disposition and Run link. One-shot means one admitted opportunity, not guaranteed speech. |
| Failure/retry | Existing Run/Attempt policy may retry within the same original deadline. Exhausted, cancelled or uncertain work closes with its real disposition; it is not independently rearmed. |
| `now >= expiresAt` before admission or delivery | Expired/ineligible immediately, even if no cleanup pass ran. Drop a linked stale held utterance. |
| Source deleted, corrected so the plan is invalid, or Character scope removed | Cancel/invalidate the plan under the domain's normal source/retention rules; never mark the original matter “resolved” without evidence. |
| Restart/reconnect | Reconcile a known assigned Run if required, expire old active rows, and never catch up missed windows or replay uncertain effects. |

The exact enum can be a discriminated union of active/claimed/terminal-with-disposition rather than many independent booleans. Preserve the terminal source key while that source could otherwise be rediscovered. Store only the minimal audit/dedup data needed; do not create a user-facing expired-thought inbox.

“Consumed” means the plan's opportunity ended. It does not assert that the real-world interview occurred, succeeded, or was answered. No Intention expiry/consumption writer should delete or resolve its normal source facts.

#### Why the legacy helper is not the authority

`assembler.pickIntention` only injects a legacy mood-gated row when a current user message matches its disclosure hint (`assembler.ts:108-114`). Canonical assembly does not call it (`canonical-local-runtime.ts:41-53`), and canonical selection makes legacy retention inert (`:21,36`). Restoring this helper would create a Local-only behavior and still fail autonomous due-time, idempotency, claim, delivery-expiry and cross-provider requirements.

Likewise, `layer-registry.ts`'s legacy `intentions` Memory layer and canonical `retention: { kind: "expiring" }` are not executable wake policy. Do not query the old Markdown/MemoryRepo directly or silently promote old unstructured intention rows into active Heartbeat triggers. They may remain ordinary legacy content under migration policy until a deliberate, validated domain migration is selected.

#### Later spontaneous follow-up

A fresh Signal plus an active Pattern/current condition can independently admit judgment. Its thin context may expose bounded relevant Global and current-Character Memory through the existing provider-neutral read seam; the Agent can explicitly pull details when useful. The fresh evidence, selected topic, source refs and outcome belong to this new Run. The expired Intention is not its wake reason.

Recommended read budget: at most one small recall per applicable Bank for a candidate-derived topic (for example up to four records and 512 tokens per Bank), with normal scope, freshness, provenance and provider-result checks. This is a bounded tool/context projection, not an always-injected retrieved block, all-expired-plan scan, full relationship window, or new Memory authority. Missing/unavailable retrieval remains explicit and may yield silence. Root must reconcile this with incoming canonical recall/context integration.

Interview acceptance example: the original plan to ask Friday evening expires while offline. On Monday, a newly confirmed relevant Pattern/time window and fresh presence admit a new judgment; bounded recall may recover “the user planned an interview.” Taki may ask how it went, or stay silent. The Friday plan remains expired, its old utterance is never released, and the outcome remains unknown until actual evidence arrives.

### 6. Minimal supported Signal and condition vocabulary

All entries below are recommendations mapped to real source seams, not permission to enable additional sensors. Use closed typed facts and explicit current-source eligibility. A condition being supported does not mean its source is currently authorized or available.

| Source / candidate kind | First supported facts and conditions | Required guards and limits |
| --- | --- | --- |
| Existing foreground activity | Scrubbed reported application name, coalesced dwell, meaningful application transition, separately preserved known idle duration/state. A user can select an exact supported application set and a duration. | Existing sanctioned sampling only; current Host/source generation, age, dwell, sensitive refusal, and pause apply. Unknown idle cannot satisfy an active-user condition. Friendly process names are not guaranteed executable filenames. |
| Valid Intention due | Intention identity, purpose/source, `notBefore <= now < expiresAt`, current lifecycle. | One source-opportunity key; assignment and expiry rechecked transactionally. No renewed deadline or catch-up. |
| Pattern clock window | Opening of a concrete configured local-time window/occurrence for an active Pattern with a meaningful purpose. | Existing User Timezone authority; one current occurrence key; no replay of missed windows, no VPS-local timezone inference. Bare elapsed cadence is insufficient. |
| Known background completion | Actual terminal existing Run/effect completion identity and bounded result reference. | Explicit source binding, known outcome, one consumption. Exclude the Heartbeat's own generic completion cascade and results already satisfied by Class A delivery. Do not interpret arbitrary log text as completion. |
| Fresh user presence transition | A real new explicit interaction, or a fresh permitted source transition from known absence/inactivity to present. | No wake from transport reconnect, visibility/focus alone, report renewal alone, stale cached input, or an unobserved gap. Coalesce per Character/device and apply a meaningful Pattern/condition. |
| Existing ambient description | Already permitted, scrubbed, fenced and fresh screen description as optional context. | Context only in the initial vocabulary; no text-parsed “tired,” “working,” “sad,” or “interview finished” deterministic source. No extra screenshot request from the wake provider. |

Useful condition atoms include `local_time_window`, `application_in_set`, `activity_dwell_at_least`, `known_idle_state`, `presence_present`, `intention_due`, and `completion_of`. Presence and time windows can be guards as well as sources when a real transition/occurrence exists. Bounded application sets and numeric thresholds are visible business parameters on the candidate card.

Example data definitions for a first validation batch:

- A sustained-activity check-in: a configured permitted application set has sustained eligible activity for 45 minutes, with fresh known activity and no current primary turn. Purpose: consider a brief break check-in; silence/express/speak are allowed. Do not claim that application duration proves work or fatigue.
- A one-shot follow-up: a live Intention reaches its valid window, with current source/presence/delivery checks. Purpose derives from its conversation source; the utterance is generated anew.
- A selected reflection window: the user confirms an evening Pattern with relevant relationship context and a finite local-time window. The current window boundary can be meaningful; a periodic heartbeat by itself cannot.
- A completion follow-up: a specifically referenced known background result that has not already been delivered becomes eligible. Do not emit another unsolicited utterance for every scheduled Run that already has Class A delivery.

These examples are seed/candidate data, not per-behavior engine branches. A user asking “when I am stressed” must be told that no reliable stress source exists; clarify a supported proxy the user actually wants rather than fabricate the sensor or semantic threshold.

### 7. Privacy generation and source identity are required additions

Current sample age, UI invalidation revision and Host generation are different facts. `PerceptionChanges.revision` is a projection invalidation cursor, not a consent epoch. A Heartbeat source must retain enough identity to reject obsolete observations rather than reuse a UI revision as authorization.

Recommended minimal addition: the Perception owner exposes a current observation generation and an accepted-evidence envelope. The generation changes when Sampling consent/source validity is retired; restart begins with no live observation evidence. A sampling request captures its generation and actual dispatched Host/connection/catalog identity before awaiting work, and publication checks them again. A late foreground or VLM result cannot publish current evidence after pause, source retirement or replacement.

On Privacy Pause, discard unconsumed Sampling-derived Signals/candidates, seal current sampling-dependent eligibility, and prevent already captured sampling context from authorizing a later user-facing effect. Preserve source dependencies through admitted Run/outcome validation. Resumption, including automatic deadline expiry through the existing pause read, requires a newly accepted observation; it never reuses a pre-pause dwell interval, description, or queued reason. Clock, normal Memory and known-completion sources remain independently eligible under their ordinary policy.

Keep the operator-only pause writer and durable-write-before-notification rule. A failed pause/resume persistence operation cannot publish a contradictory generation. Do not turn the interested-operator pause timer into a consent writer or sampling loop. Avoid retaining titles/screens in privacy invalidation or skip logs.

The existing source code checks pause before asynchronous requests (`activity-sampler.ts:146-158`, `ambient-screenshot-sampler.ts:232-256`) but later publishes without a generation fence (`activity-sampler.ts:172`, `ambient-screenshot-sampler.ts:181`). This is a real integration seam for the task. It does not justify claiming that the separate foreground-to-screenshot non-atomic gap D48 is solved.

## Related specs and caveats

The source map above records the domain, Perception, Memory and UI seams. The complete related-spec list, external-reference note, validation matrix and caveats are retained in [presence-contracts.md](presence-contracts.md#related-specs). This is source-backed planning research; no tests, builds, live databases or production implementation were performed.
