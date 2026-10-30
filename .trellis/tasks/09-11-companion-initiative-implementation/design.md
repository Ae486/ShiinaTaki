# Unified Companion initiative — technical design

## 1. Status and design basis

This is the development design for the requirements in `prd.md`, prepared against T4 `a35d273` and incoming local main `3c63a80`. The four child tasks implement it in order. Proposed module/API/field names below describe new contracts; they are not claims that those interfaces already exist. A name may be refined during implementation while preserving ownership, behavior and compatibility, with the change recorded here.

Those hashes describe the original design review. The owner-approved [September 19 source snapshot](research/baseline-snapshot-contract-2026-09-19.md) pins incoming main `516e151`, including committed B6 and durable Memory operations through 048, for integration with current T4 and its Avatar outcome work. The combined-baseline evidence and current executable specifications govern existing interfaces; historical missing-feature claims are not instructions to rebuild capabilities now provided by that baseline.

Normative inputs are `research/decision-register.md`, the parent Heartbeat PRD/grill, ADR 0008/0009/0010 and the current layer specs. `research/runtime-and-observability.md` and `research/domain-and-presence.md` provide verified code seams. `research/reference-designs.md` supplies bounded design references, not a replacement runtime.

The chosen approach is a focused Core initiative module over existing services. A universal workflow DSL is unnecessary; per-behavior loops would duplicate execution and policy. Preserve separate Scheduled definitions, recurring Patterns and one-shot Intentions, and adapt their work into the common execution request.

## 2. Responsibilities and reused path

```text
Clock / accepted Perception / client presence / valid Intention / known completion
  -> typed, bounded Signal and condition adapters
  -> Pattern matching, candidate coalescing and deterministic Wake Policy
  -> existing Character coordinator, extended with background reservation
  -> existing RunService + immutable selected context
  -> existing ChatAgent / ToolLoopAgent / governed Effects / Main Model
  -> one structural decision
  -> shared delivery state linked to that same Run
  -> ordinary Timeline and existing governed avatar presentation

Existing Run/Effect/model/tool facts + new decision/delivery facts
  -> existing run_events / live bus / ObservabilityQueryService / Monitor
Pre-admission policy facts
  -> bounded policy projection in the same Monitor, outside the Run list
```

| Owner | Responsibility | Boundary |
| --- | --- | --- |
| `packages/core/src/initiative/` (new) | Pattern/Intention services, Signal adaptation, candidate selection, eligibility, feedback policy and trigger adapter | No Agent/model loop, independent Character mutex, permission store or execution ledger |
| Existing Harness/Agent | Admission, selected input, Run/Attempt state, retry/cancel, Effects, model execution and recovery | Initiative is a caller and policy profile |
| `packages/core/src/delivery/` (new shared module) | Immutable output staging, bounded holding, publication accounting and presentation continuation | Subordinate to existing Run and Timeline authorities; no delivery Agent Run |
| Existing Perception | Authorized acquisition, scrub/fence, nullable activity evidence and observation generation | No extra sampler or analysis of raw screen prose into hard conditions |
| Core presence service (new) | Authenticated source leases, evidence projection and message response opportunity | No inference that connection, Host activity and frontend location are equivalent |
| Existing Memory runtime | Authority, factual content, provider-neutral context/recall and mutations | Intentions reference facts; they do not become another Memory layer |
| Shared | Strict schemas, bounded values, versions and semantic labels | UI and Rust use shared contracts; add Rust mirrors only for actual consumers |
| Desktop | Real own-surface reports, candidate/management UI, complete speech presentation and Monitor projection | Disposable clients; no DB writes, policy decisions or mutation replay |

The integration owner serializes changes to `main.ts`, Shared exports, migrations and registry entries. New source files stay responsibility-scoped and update their directory `index.md`; no broad catch-all service is introduced.

## 3. Character, policy and timezone authority

### 3.1 Initiative target and aggregate bounds

Current Desktop has a compile-time `ACTIVE_CHARACTER_ID = "taki"`; Core has no selected-Character authority. First delivery therefore uses one explicit Core initiative target aligned with that surface. It never enumerates every imported Character as an active speaker. Store Pattern/Intention ownership by Character and validate the configured target against actual Character/runtime readiness.

An absent or invalid target is ineligible. Do not infer it from connection order, latest arbitrary chat, asset order or avatar reports. Changing the target invalidates old target-dependent candidates and held output; it neither rewrites the old Run's Character nor resets total counters. Inactive Characters' Intentions still expire by absolute time.

Apply the accepted Class B model-opportunity and utterance caps at Core/user scope; Character/Pattern settings may tighten them. This is an engineering safety bound for the current single-target product, not a decision to implement simultaneous autonomous Characters. Model opportunities count Heartbeat judgments, not every model Effect within a ToolLoopAgent turn.

### 3.2 Settings and control scope

Use the existing Core config registry/store and its env > stored > default precedence for initiative scalar settings. Mark a setting live only when the production consumer re-reads it correctly; validate related limits as one effective policy. Do not create a second settings file or store defaults as user choices.

| Control | Effect on existing/new work |
| --- | --- |
| Initiative enabled | Controls Class B admission and outward delivery. Disabling discards candidates/undispatched output and cancels or safely suppresses affected work; it does not pause Scheduled Class A or maintenance. |
| Periodic eligibility enabled/cadence | Controls periodic reevaluation only. Enabled event sources still use the same policy and budgets. The UI must make that scope explicit. |
| Pattern pause/retire | Blocks new use of that Pattern and revalidates its dependent held output; committed history is not undone. |
| Privacy Pause | Retires Sampling evidence and Sampling-dependent candidates/output. Non-Sampling sources retain their own eligibility. |
| Run cancellation | Cancels that execution/continuation under the existing lifecycle; no blanket future-definition change. |

New dispatch remains opt-in during development setup. Seed activation is a concrete operator/setup choice; a bundled update cannot reset user changes. This is a rollout safeguard, not an unreviewed final product default.

### 3.3 User Timezone is a required integration

Current `user_timezone` is a persisted singleton initialized to UTC; Scheduled readers consume it through an injected resolver. Fixed/follow-primary-device controls and the authority-device report are not implemented in that baseline.

Extend that existing authority with validated IANA zone, mode, designated operator device, revision and source/confirmation metadata. Provide operator read/update methods and a bounded report from the designated authenticated frontend. A different or stale connection cannot overwrite it. When its authority device is offline, retain the last confirmed zone; never fall back to VPS process-local time. An unconfirmed UTC bootstrap value remains visible as such during setup.

Fixed mode ignores device reports. Follow-primary-device accepts current reports only from the explicitly selected operator device; do not auto-select the newest connection or assume its Node identity. Desktop reports its own zone through existing client lifecycle; phone support is a later producer of the same contract.

Use the shared `core/time` rendering seam for the captured user-time context. Zone changes recompute future user-zone schedule times and Pattern clock windows; absolute instants and explicitly pinned schedule zones remain unchanged. Invalidate old clock candidates/held contextual output rather than catch up missed windows. Carry already consumed budget history across a zone/target change so changing settings does not mint new capacity. Timezone remains one domain authority, not a duplicate generic-config value.

## 4. Domain records and supported condition vocabulary

All durable state remains in the existing Core database. Repositories validate bounded rows and use short synchronous transactions; no transaction spans an await. Table names below are proposed responsibilities, not mandatory one-table-per-type design.

| Record | Minimum contract |
| --- | --- |
| Pattern and revision | Core ID, Character, lifecycle, current accepted revision, pending revision, expected base/version, readable title/purpose, closed conditions, context selectors, allowed outcomes, timing/chance, origin/evidence and review provenance |
| Intention | Core ID, Character, trusted source-opportunity key, purpose, source reference, `notBefore`, `expiresAt`, state, originating Run/input, claimed Run and terminal disposition |
| Eligible opportunity | Stable source/occurrence key, target/policy version, selected candidate references, observed/expiry times, source/consent generations, bounded facts and known cause references |
| Policy state | Actual model-opportunity/utterance reservations and charges, gap/cooldown/backoff state, bounded pending candidate and bounded evaluation diagnostics |
| Delivery | One logical output identity per committed decision, Run/Attempt reference, immutable class, selected outcome, intended speech/presentation, validity/source fences, publication state and optional executable continuation |
| Presence / feedback | Live connection-source leases are process-local; bounded actual presentation/response intervals and one feedback disposition per utterance are durable when needed |

Pattern lifecycle is `proposed | active | paused | retired`. Immutable revisions preserve accepted history; rollback creates a new revision from an accepted version and revalidates current policy. Drafting a revision does not replace an active rule. Confirmation compares the exact displayed candidate and expected current revision; stale/conflicting confirmation returns the current readable proposal. Same confirmation is idempotent. Restart never activates an unconfirmed candidate.

First condition grammar is a bounded `all` list, maximum eight atoms, with bounded literal alternative sets where useful. Support `local_time_window`, `application_in_set`, `activity_dwell_at_least`, `known_idle_state`, `presence_present`, `intention_due` and `completion_of`. Missing facts mean ineligible/unknown. There is no arbitrary expression evaluator, script, SQL, regex program or model-written predicate.

| Source | Eligible fact | Explicit exclusion |
| --- | --- | --- |
| Existing accepted foreground activity | Known app label/set, dwell, meaningful transition and separately preserved nullable idle evidence | Do not infer work, stress or fatigue; app labels are not guaranteed executable paths |
| Clock | Current occurrence/window of an active, purposeful Pattern in User Timezone | Bare cadence is not a reason; missed windows do not accumulate |
| Intention | Current active finite window and validated source | Expired/terminal source keys never revive |
| Existing completion | Attributable actual terminal Run/result, requested by a relevant Pattern/context | No generic Heartbeat-completion cascade or duplicate of already delivered Class A work |
| Presence return | Fresh real interaction/qualified transition with a relevant Pattern | No wake from focus, connection, renewal, unobserved gap or resume alone |
| Ambient screen description | Already accepted, fresh, scrubbed/fenced optional context | No deterministic fatigue/emotion facts parsed from prose; no extra capture |

Seed examples are data: a selected application's sustained activity, a selected reflection window and an attributable completion follow-up. One-shot follow-up is supplied by the Intention source. Seed values are editable engineering examples, not fixed dialogue or hard-coded Character behavior.

## 5. Eligibility, coalescing and admission

1. Validate the producer, current source lifecycle, target and source generation. Normalize accepted facts; retain known origin/cause references and leave unknown causation explicit.
2. Match active accepted Patterns and valid due Intentions. Preserve individual reasons/evidence rather than concatenate anonymous text.
3. Coalesce duplicate occurrence keys and compatible reasons into one bounded candidate set. Compatibility means the same source occurrence or an explicitly shared source/Intention reference, not similar-looking text. Exclude source keys already claimed/consumed by another opportunity before forming the set. Use stable ordering by explicit due time, source priority and stable identity; retain at most four candidates for one judgment. Initial engineering source order is due Intention, explicitly referenced completion, current Pattern time window, activity transition, then presence transition. This order never bypasses policy and does not force the model to speak. Do not start one Agent per Pattern.
4. Apply hard privacy/authority/freshness/quiet/budget gates, then tighter Pattern timing and deterministic chance. Chance is derived from stable opportunity/Pattern revision identity and is not rerolled while the same candidate waits.
5. Attempt atomic background reservation on the existing Character coordinator. Primary intent is registered before its asynchronous admission, so the background probe sees queued/reserved work as well as the active holder.
6. Revalidate fences and atomically claim the eligible opportunity/Intention and budget reservation around canonical Run admission. The Run idempotency key is stable for that opportunity. Reconcile the claim/admit/link crash cuts without producing a second Run.
7. Capture the thin request and start the existing Run/Attempt. Charge a model opportunity once its first model dispatch is committed. Release a reservation only when no model dispatch occurred; recorded/uncertain usage is not erased.

Keep at most one pending Class B candidate and one held output per Character. Coalescing/latest-wins may replace undispatched work; it never interrupts an active tool chain. Re-evaluate on a real release or a bounded next deadline. Ninety seconds is a maximum deferral, not authority to interrupt the user. A primary arrival during background preparation may cancel/revalidate it before model dispatch; an actual already admitted cancellation remains a real Run.

The approximately 15-minute jittered cadence drives periodic opportunities. Meaningful events may request earlier reevaluation, but consume the same global/Pattern/backoff budget; they have no separate allowance. Timer rearming is bounded/unref'd and does not create a backlog on clock jumps, sleep/resume or restart. Privacy/source/target revocation immediately invalidates dependent pending work.

The existing queue retains FIFO within a priority class and parallelism across Characters. Scheduled Class A shares coordination mechanics while retaining its own deadline/catch-up rules. No second mutex or per-behavior scheduler is added.

## 6. Thin context, tool policy and terminal decision

### 6.1 Captured autonomous request

Add an explicit autonomous input profile to existing RunExecutionContext/TurnContext. Initiative requires that profile and fails closed if missing; it must not fall back to `store.project(characterId)` as an accidental complete history. Preserve primary behavior and migrate Scheduled context deliberately rather than changing every non-primary caller implicitly.

The request contains stable Persona, bounded approved Memory Blocks/index, selected Pattern/Intention purposes, relevant source references, already-permitted observations, current user-time context and optional bounded Companion State. Use provider-neutral explicit recall for selected topics; no broad automatically retrieved block, all-expired-plan scan or graph dump.

Capture fragments once per Run and reuse them across the existing in-process overflow retry. Record a versioned source manifest: profile, categories/references, revisions/generations, trust/source classification, policy and primary-admission fences, capture/expiry and actual accounting quality. Protected prompt content remains process-local. A restart cannot reconstruct an old decision by silently reading the newest conversation or switching Memory authority.

Feed the thin outgoing request into the existing request-preparation/reduction/measurement seam. Do not attach unrelated primary replay measurements. Non-primary work can use its own request reduction and Run telemetry, but cannot replace primary pressure snapshots, advance flush watermarks or invoke conversational auto-memory.

### 6.2 Restrictive runtime tool profile

Capture a stricter-only tool profile for initiative v1. Advertise supported Core reads, bounded provider-neutral Memory recall/read, relevant Skill reads and the terminal response control. Filter both schemas and actual dispatch through registered metadata, not tool-name substring heuristics. Current governance remains authoritative and can refuse any operation; the profile creates no grant.

Exclude exec, file writes, recursive scheduling, arbitrary external-effect MCP operations and fresh sensor reads. Primary conversational authoring/Intention tools are separately registered Core domain operations and do not widen Heartbeat reasoning tools. V1 heartbeat reasoning stages presentation instead of executing ordinary immediate avatar tools. Preserve unavailable/ask/deny reasons and current-generation checks.

### 6.3 `heartbeat_respond`

The Run-scoped control accepts one strict structural decision:

- `silent`: no speech or presentation command.
- `express`: bounded presentation validated against the current Character/costume vocabulary.
- `speak`: complete bounded intended user-facing text, optional bounded presentation, and an explicit response-expectation hint when feedback is appropriate.

Silence always remains a valid choice. The response identifies the selected offered candidates using internal Core-issued references; Core validates that each belongs to this Run's admitted set. Keep considered and selected candidates distinct in evidence. Speech/expression requires at least one valid selected reason; silence may select none. An exact repeated decision is idempotent; a conflicting, malformed or stale decision is rejected. The tool stages data and does not publish or settle the Run. Stop the existing SDK loop only after a valid decision is accepted; a failed call with the same tool name is not a terminal success. Missing terminal decision at the step/deadline bound is a recorded failure, not inferred silence.

Commit the decision only after authoritative model/tool settlement succeeds and cancellation/fences are checked. Free-form intermediate deltas never reach Timeline/Pet or become a substitute final result. Keep the existing primary `presentationTailStop` contract unchanged. Register the control through the fixed Core binding path rather than adding a generic governance bypass.

## 7. Delivery, continuations and recovery

### 7.1 Distinguish reasoning completion from executable work

| Committed decision | Execution state | Next permitted work |
| --- | --- | --- |
| Silent | Settle Run and release Character slot | Decision evidence only |
| Speak with text only | Atomically stage immutable speech and complete execution; release slot | Policy-controlled ordinary Timeline projection, without tools or reopening Run |
| Express or speak with executable presentation | Keep the original Attempt active; persist a delivery continuation | Execute now while owning the slot, or CAS `running -> waiting` with delivery reason and release the slot |
| Held presentation ready | Reacquire background slot; validate current continuation version and original identity; CAS `waiting -> running` | Execute only the staged governed presentation on the same Attempt; no model rerun or new delivery Run |
| Held work expired/cancelled/revoked/superseded | Settle pending continuation and the nonterminal Run truthfully | No late effect; pure-text expiry does not reopen or rewrite its already terminal Run |
| Later transport/presentation report | Preserve execution terminal state | Append actual delivery evidence to the original Run |

Add explicit hold/resume CAS methods to RunService/RunRepo. Do not weaken `guardDispatch`, misuse `start`/`retry`, or dispatch a tool while Run state is waiting/terminal. Hold only after reasoning Effects are settled; the Attempt remains nonterminal until executable presentation settles. A newer candidate can replace only undispatched held work.

Continuation validity is the intersection of output TTL, original Intention window where used, Run deadline, bounded busy hold, target/primary fences, source consent/generations, authority and current costume/Host binding. A new primary interaction that can invalidate the captured conversational context suppresses the old output rather than silently regenerating it.

### 7.2 Atomic text publication and separate facts

Extend the existing assistant append/publication seam so the Timeline row, delivery linkage, quota transition and required event commit before fan-out. `ConversationStore` currently invokes its hook immediately; do not publish inside an outer transaction. Reuse ordinary assistant rows/subscriptions and current Pet restoration. Do not create `proactive.*` speech methods or fake foreground ChatActivity.

Reserve one utterance slot/gap capacity per logical speech identity. Before any publish, a known rejection/expiry may release the reservation. At the dispatch boundary, atomically commit the single Timeline row/link and budget charge; then publish. If fan-out may have happened, count at most one charge conservatively and do not refund into a new logical utterance. A charge is a limit-control fact, not proof of confirmed delivery.

Current void publication/`ok:true` cannot prove sent or shown. Add an observable outcome to the existing sender and distinguish no eligible target, refused before dispatch, transport acceptance and uncertain fan-out. Frontend presentation reports are a separate producer. Text, expression dispatch and actual display have separate dispositions; successful text does not turn an unknown expression into success.

Class B checks target readiness, primary/busy, quiet hours, source/policy and validity again before publication without another model call. Expiry after publication suppresses stale live bubble/animation replay; it does not erase ordinary history. Class A uses this common delivery machinery with its existing expected-work/quiet-hour policy and independent counters. Integrate the Scheduled adapter's currently discarded result deliberately; do not copy all private intermediate deltas into its public result.

### 7.3 Crash and shutdown behavior

Recovery must check explicit decision/continuation state before the current heuristic that a last completed Effect implies a completed Run. A terminal model Effect does not complete a pending presentation. An initiative Run missing its required committed decision cannot become silent success through that heuristic.

Known-undispatched presentation can resume only if the exact original binding is provably current; otherwise expire/refuse it. Process-local binding loss is not authorization to capture a new Host/Memory context. Dispatched/uncertain effects remain unknown/reconciliation-required and are not replayed. Pure text may resume its original unsent projection only within all validity fences; uncertain fan-out is not automatically resent under a new identity.

Boot performs migrations and existing Run recovery before enabling sources/dispatch. Reconcile domain claims, staged output and quotas before admission. Shutdown stops source timers/renewals, seals new admission and drains or settles owned work before DB close. No teardown callback can publish into a retired lifecycle.

## 8. User Presence and actual response opportunity

### 8.1 Sources and generation fences

Extend the existing Perception owner with an observation generation and accepted evidence envelope. Capture it and the actual dispatched Host/connection/catalog identity before each await, and verify again before accepting foreground/VLM output. A Host/source generation change seals the previous dwell/context; samples from different sources cannot be stitched into one continuous activity interval. A failed consent write publishes no contradictory generation. Resume starts from fresh eligible observations, not the old dwell interval or screen description.

Preserve nullable idle before ActivityState's legacy `idle=false` projection. Existing Windows session idle is not a physical-HID guarantee. Sensitive/refused/paused samples cannot be repurposed through a separate idle collector. A Perception invalidation cursor is not a consent epoch or user-activity event.

Desktop reports only its own direct interaction and surface state, using a connection-bound source instance, increasing sequence and bounded elapsed age. Core derives authenticated device identity and receipt time. No keys, text, pointer coordinates, raw window titles or screenshots belong in presence reports. Renewal may maintain reachability/exposure but cannot reset the age of old user input. Synthetic dispatch/programmatic focus/connection restoration never becomes fresh input.

Pet/Home/Chat share an operator device ID but have independent sockets. Track source leases separately, then aggregate; retiring one source must not erase another's fresh evidence. Restart clears live leases. Without adequate coverage, lack of evidence is unknown rather than global absence; known inactivity is scoped to its actual source/device.

### 8.2 Device association and message presentation

Node Host identity and frontend operator identity are independent today. Do not associate them by name, IP, arrival order or assumed local topology. Native activity can support qualified global presence, but cannot prove that an utterance on an unrelated frontend was available to the user. First delivery supports negative-feedback evidence from direct client input on the actual presenting operator device; unproved cross-source associations remain unknown.

Attach message reports to actual completed rendering in the existing Chat/Pet surfaces: correct Character and committed message/group, current connection/source, visible native/document surface and viewport exposure. Offscreen rows, lazy skeletons, hidden/collapsed bubbles and store updates are insufficient. End exposure on hide/minimize/remove/Character change/generation retirement. Preserve scroll/focus behavior; never open a window merely to manufacture presentation evidence.

Use a bounded ordinary Timeline presentation-report method, not a proactive speech protocol. Core validates message ownership, linkage and live source before recording exposure. Client/native visibility has known occlusion limits; report presentation opportunity, never guaranteed reading. No screen capture is required for own-surface evidence.

### 8.3 Feedback

Feedback applies to a published Class B utterance with an explicit invitation/response expectation. Silent/express-only, Class A, held/expired text and unspecified/no-reply expectations do not produce ignored-message counts.

Accumulate the union of valid intervals where the actual message is presented and the same attributable device has fresh presence evidence. Overlapping windows/devices count elapsed time once. Do not backfill gaps from a late report or count disconnected/unknown time. Persist bounded observed intervals/disposition when needed for restart, without copying message content or keeping raw activity history.

Settle one utterance at most once as engaged, weak non-engagement, or insufficient/unknown opportunity. A real later user turn for the Character conservatively resets its backoff and closes pending observation as engaged; it does not prove the question was answered or the underlying real-world matter resolved. A reply to another Character is not relabelled as its answer.

Use the established `1x -> 2x -> 4x -> daily ceiling` stages, fully reset by a real reply or explicit operator reset. Stages tighten next eligible Class B judgment/spacing without increasing hard caps. Initial engineering thresholds are three/six/nine qualified weak instances within seven days; the final stage permits at most one eligible Class B judgment in a User Timezone day. Existing publication counts never reset with backoff.

## 9. Intention formation and related-memory follow-up

Register a narrow primary-turn Core Intention operation over the existing trusted input/Run context. It can create a bounded plan from an actual current user input or a newly confirmed source revision; no second extraction model or maintenance-model Companion judgment is added. Core resolves and binds the source rather than trusting an arbitrary model-supplied Character/Bank/Run ID.

Separate reported event time from policy-selected follow-up time. If a useful finite plan cannot be formed without inventing facts, abstain or clarify in ordinary conversation. Deduplicate Character + trusted source opportunity independently of generated wording, and preserve terminal source keys while rediscovery is possible.

| Transition | Meaning |
| --- | --- |
| New valid plan -> active | Wait until `notBefore`, never after `expiresAt` |
| Due but ineligible | Keep the original window; no Run or sliding deadline |
| Accepted opportunity -> claimed | Atomically link one canonical Run; duplicate wake cannot claim again |
| Judgment completes, including silence | Consume this one admitted opportunity with its actual outcome; speech is not guaranteed |
| Retry/cancel/failure | Existing Attempts may retry only within original bounds; terminal work is not re-created as a new Intention |
| Expiry/source withdrawal | Stop eligibility/output immediately, independent of sweeper timing |

Consumed/expired describes the plan, not the real-world matter. Keep minimal disposition/source identity for deduplication; discard unnecessary candidate speech after expiry under retention policy. No user-facing expired-thought inbox or automatic copy of Agent plans into factual Memory is introduced.

During a fresh independently eligible judgment, use current provider-neutral Memory Blocks/index and a bounded explicit recall over relevant Global/current-Character Banks. Initial read bound: one selected-topic read per applicable Bank, up to four records and 512 tokens per Bank, within the Run budget. Preserve source/confirmation/freshness and permitted degraded-replica semantics; unavailable remains unknown. Do not scan expired Intentions as a hidden wake queue.

The missed-interview acceptance remains decisive: the original plan expires while offline; later a new valid window/Signal can admit a new judgment, relevant Memory can inform a new question, and the original trigger/text remains closed. Deleted/corrected facts must not be revived by an old Intention reference.

## 10. Conversational authoring and runtime Skill

Primary conversation may list/read/propose/revise Patterns through a thin tool over the same Core service used by the panel. A candidate card exposes the effective purpose, conditions, evidence, limits, time/expiry and meaningful diff. Operator confirmation activates exactly that revision. Agent code cannot mint its own approval or call permission `approvalRespond` for Pattern activation.

Card actions inside conversation satisfy the review loop. Any typed-text confirmation support must bind one concrete current proposal and actual user input; arbitrary “yes” is not a generic confirmation token. Pause/retire and later revision/rollback retain source attribution, current CAS and clear result/error feedback. Disconnect, close or failed confirmation never activates a candidate.

Reuse the existing Dialog/labelled-section/focus primitives where useful, with a domain-specific controller and vocabulary. Agent/panel queries return the same Core state. Use current reactive invalidations, last-good drafts/selection and readable conflicts rather than a page polling loop or invisible state replacement.

Ship the authoring guidance as a normal runtime Skill source package, proposed at `packages/core/resources/skills/companion-pattern-authoring/SKILL.md`. This is not a developer `.agents` Skill. Package/install it through the existing operator Skill import/lifecycle, which accepts bounded file/ZIP bytes. Explicit setup handles installation and exposes failures; it cannot overwrite, replace or re-enable a user's same-name package without the existing revision-bound replacement action. First authoring acceptance includes fresh-profile import, discovery/load and a real candidate flow.

Core validation remains authoritative if the Skill is absent or user-modified. The Skill teaches supported conditions and concrete proposal review; it cannot edit DB files, Persona, safety policy or grant permission. No new Skill catalog/loader is introduced.

## 11. Same Monitor, new business facts

Existing model/tool/usage/governance/retry/recovery events remain produced by existing middleware and owners. The normal Character Run query already includes Heartbeat. Add only the facts not currently represented: opportunity/context selection, decision, output staging/holding, continuation transitions, publication disposition, presentation and feedback.

Use strict bounded events linked to the original Run. Example new families are `initiative.decision`, `delivery.staged/deferred`, `run.delivery_waiting/resumed`, `delivery.dispatch_committed/sent/unknown`, `delivery.presented/expired/suppressed` and `initiative.feedback`. Names are new schema proposals. Each required state transition commits its business fact in the same transaction; post-commit live publication remains observer-isolated.

The current v1 event envelope has closed kinds/sources and parsers on both read/write. Preserve its decoder and existing producers/history; add reader-first support for a strict v2 business envelope and mixed-version replay before any v2 writer is enabled. Do not rewrite immutable old events or make `run_id` nullable. Existing counts derive from their specific producer kinds, so added diagnostics do not inflate model/tool counts.

Reuse Monitor list/trajectory/Inspector/subscriptions. Prefer existing lifecycle/context rows, delivery phase and semantic Inspector sections. Keep the existing public projection valid for older clients where facts fit those shapes; omit unsupported optional machine correlation rather than emit an unknown closed enum. If new typed response fields are needed, select a compatible projection revision before streaming them and refuse an unsupported view cleanly. Tests must prove actual old-client decoding, cursor progress and mixed-event replay; silently dropping canonical facts is not compatibility.

Pre-admission checks have no Run. Persist bounded reason counters, current/last evaluation and a capped recent-decision window in the same policy authority. Extend the existing observability service with a Character-scoped policy read model beside the Run list, with its own bounded status/cursor. Repeated ticks coalesce; no raw activity content, dummy Run/Attempt, second execution ledger or per-page polling is created.

UI fields describe actual reasons, selected behavior, outcome and delivery. Internal IDs, hashes/revisions/generations remain query/correlation values only. Missing producer evidence stays absent/unknown; charged quota, execution completion, transport acceptance and presentation are never substituted for each other. Monitor disable/overflow cannot affect execution.

## 12. Bounds, calibration and failure handling

Keep the accepted defaults in the PRD unchanged. The following additional bounds are explicit engineering starting points, with tests and manual calibration; they are not imported reference-project defaults.

| Bound | Initial setting / rationale |
| --- | --- |
| Selected candidates / conditions | Four candidates per judgment; eight condition atoms per Pattern; bounded literal sets, no recursive DSL |
| Accepted foreground freshness / known idle | 60 seconds and the existing 180-second idle cutoff; null remains unknown |
| Direct input freshness | 60 seconds; focus/lease renewal cannot refresh the actual input |
| Source/exposure lease and renewal | 30-second lease, at most one source-owned renewal per 15 seconds while relevant; coalesce routine input reports to one per second |
| Meaningful return | Ten-minute gap from known activity plus actual fresh input; reconnect/unknown gaps do not qualify |
| Presentation qualification | At least 50% of the relevant text region for two continuous seconds plus truthful own-window visibility; never interpreted as reading |
| Response opportunity / deadline | 120 seconds of valid accumulated overlap; settle within 60 minutes of publication; insufficient evidence is unknown |
| Automatic Intention active window | Configurable seven-day default maximum for `expiresAt - notBefore`, with tighter source/user validity respected. This is not a scheduling horizon: a source-backed future event can have a later finite window. Do not silently convert an automatic plan into a Scheduled Task; explicit reminder/task intent uses Scheduled semantics. |
| Policy diagnostics | At most 100 recent bounded dispositions per initiative target and seven days of reason counters; no timer-by-timer Run log |
| Pending payload retention | One candidate and one held output per Character; remove expired content while retaining minimal identity/disposition required for deduplication |

Quiet hours, privacy, authority, unsupported data and lack of presence are policy dispositions, not provider errors. Admission/state/revision conflicts are typed domain refusals. Missing terminal output is an execution failure; uncertain external presentation/transport remains unknown. Reuse Shared error vocabulary where semantically correct, add closed domain reason codes when needed, and map useful Chinese messages without raw exception/tool payload exposure. General D77 error-taxonomy work remains separate.

## 13. Integration, migrations and rollout

Before reserving any migration number, integrate/verify the intended Memory baseline and compare all relevant registries. Main already supplies migration 036 for the two applied 035 histories and 040 for recognized cutover branches. Preserve those histories and use the supplied convergence/runner changes; do not invent a second bridge. Unsupported/unmappable state must refuse atomically rather than force a destructive repair.

Use the same DB for additive Pattern/Intention/policy/delivery/feedback state and extensions to existing time/Run metadata. Add indexes for due/active selection, stable source keys, Run/output identity and bounded diagnostic reads. Foreign keys and CAS protect Character/source/run linkage. No arbitrary historical migration number is reserved in this document.

Roll out readers and inert repositories before sources/writers, then one explicitly enabled target and seed set. Validate fresh and supported historical databases with populated Memory/Timeline fixtures. Preserve namespace meanings when reconciling T4/main D77/D78; do not merge by number alone.

Safe rollback is to disable new admission and pending Class B presentation while retaining compatible readers and durable history. Once new event/schema versions exist, downgrading to an old binary or resetting migration rows is unsafe. Restore a separately backed-up isolated/profile database only under the relevant operator authorization; never delete user data to make a check pass.

## 14. Completion boundary and future consumers

The implementation order is in `implement.md`. Every producing slice adds its events and projection tests; monitoring is not postponed until after the facts are lost. Full acceptance includes one existing-Monitor trace from a real isolated Core Run, plus UI/source/recovery tests and the confirmed complete conversational authoring/Intention behavior.

D79 later consumes the same Pattern/Signal/Run/delivery policy and governed capabilities. It must add real effect attribution and interruption policy before enabling window activation or extra inspection; v1 restrictions are not loosened now. Phone implementation, simultaneous autonomous speakers, long-term Pattern evolution and full Companion State learning remain separate product decisions. The current task reserves compatible identities and bounded extension seams without implementing those features.
