# Initiative Runtime and Delivery

## Scope and owning path

Use this contract when changing autonomous Run admission, selected context, the structural response tool,
held presentation, Class B accounting or Scheduled public-result delivery. The foundation is an inert trusted
adapter, not a wake-source implementation. The common WakeEngine supplies Pattern/Intention eligibility using
Presence and actual Desktop reporting. `TAKI_INITIATIVE_ENABLED` is opt-in and cannot create an opportunity by itself.

The owning path is `InitiativeRuntime -> TurnQueue -> RunService -> ChatAgent/ToolLoopAgent -> RunDeliveryRepo
-> DeliveryCoordinator -> ordinary Timeline/Avatar`. There is one Run/Attempt ledger and one Character lane.

## Admission, context and tools

- Primary `chat.send` reserves its Character intent before awaited snapshot admission. Failure/disconnect releases
  the reservation. FIFO applies within priority; Characters remain independent. Background admission uses the
  atomic `tryAcquireBackground`, including unready primary reservations, before creating a Run.
- Background refusal writes only bounded policy diagnostics. It creates no synthetic Run or model Effect.
- Heartbeat admission requires `InitiativeSelectedContext`: bounded instructions/control, candidate IDs, explicit
  read-tool names and the `initiative-context.v1` source manifest. Capture clones/freezes it; retry retains it.
  The manifest records source trust/revisions, policy/primary/timezone fences, capture/expiry and accounting quality.
- Selected requests pass through ordinary request preparation and the Main Model, with empty relationship replay.
  Control input remains ephemeral; no fake user row, ordinary Memory assembly/automatic recall, costume notice,
  primary pressure snapshot or conversational auto-memory is produced by the initiative path.
- Advertised and executable tools are intersected with the fixed read registry plus `heartbeat_respond`; governance
  still wraps execution. Runtime restrictions never grant permission or infer safety from a name/annotation.
- Deterministic `prepareInput` receives the original captured closures with this execution's Run/Attempt/Effect and
  abort metadata, before the normal ChatAgent tool-binding phase. The evidence result is appended to the actual
  Agent turn; the preparation callback's input object is not the final model input. See the captured unattended-tool
  contract in `permission-authorization.md` for durable-only Core/MCP grants and unchanged Host ask boundaries.
- A retained authority check must cover the captured policy, Memory mode/epoch/provider and retired runtime.
  Hindsight additionally compares the original endpoint/credential fingerprint and exact captured Global/Character
  Bank routes through existing local authority checks. A held Run must never adopt a replacement connection or Bank.
  Preserve provider-specific admission refusals before adding the outer held-reference currentness fence.
- Related-memory follow-up uses one Run-retained `createInitiativeMemoryRecall` wrapper: query and selected Banks
  are captured, model input chooses only an allowed scope, and one attempted read per Bank counts even on failure.
  Exact original Source/unit/policy receipts and selected Persona/Blocks/index remain part of currentness after
  awaits and through held publication. Unavailable or unsupported evidence cannot be upgraded by recapturing a Bank.

## Structural decision and public output

- Advertise `HeartbeatDecisionToolInputSchema` as one strict object-root function parameter schema with all fields
  required; unused outcome fields are explicitly null. The tool validates outcome-specific combinations and maps
  them to the unchanged `HeartbeatDecisionSchema` domain union before staging. Never expose that root union directly
  as provider function parameters: the installed SDK renders no root object type and DeepSeek rejects the request.
  Assert the installed SDK's `asSchema(...).jsonSchema` shape, not only Zod parsing. This verifies the configured
  compatible non-strict endpoint; it does not establish every provider's token-level strict-mode compatibility.
- `heartbeat_respond` accepts exactly one strict `silent | express | speak` decision. Offered candidate membership,
  current Attempt and dynamic captured Avatar vocabulary are checked. Exact duplicates are idempotent; conflicting
  valid decisions latch a failure. Invalid/failed calls do not satisfy the accepted-decision stop condition.
- The tool only stages an in-memory decision. The owner commits it after stream settlement, authoritative observer
  health and cancellation/currentness checks. Missing/invalid/conflicting decisions fail; they do not become silence.
- Silent creates no Timeline row or presentation. Express invokes only the staged governed presentation. Speak
  stores the complete structural utterance; free-form model deltas stay private.
- Scheduled Class A preserves its normal non-primary reasoning, but consumes `TurnContext.onSettledText` only after
  the actual SDK stream passes settlement. Installed AI SDK 7 `StreamTextResult.text` is the final step's text.
  Concatenating intermediate tool-step deltas into public delivery is forbidden. Primary streaming stays unchanged.

## Continuations and recovery

- Pure text may finish its Run before ordinary Timeline projection. Executable presentation keeps the same active
  Attempt; guarded hold/resume CAS changes `running -> waiting -> running`, never weakens `guardDispatch`, and refuses
  a terminal Run, stale version/deadline or unfinished Effect. Holding releases the Character lane.
- Resume reacquires the existing background lane and rechecks original bindings/primary/source/timezone/TTL.
  It invokes only the staged presentation, without a model request or a new Run/Attempt.
- Class B busy wait has an independent configured ceiling (default 90 seconds). Its timer is cleared before resumed
  executable dispatch; a wait timeout must not preempt an executing tool/Effect. Cancellation remains Run-owned.
- `DeliveryCoordinator.retireRun(runId)` is a trusted internal exact-Run operation, not source authorization or
  automatic parent cancellation. It durably expires only pending `staged`/`held` output before forgetting the retained
  timer/binding. Late callbacks read canonical delivery state and cannot restore a retired hold or execute its
  presentation. A persistence refusal preserves the retained binding for the caller's explicit retry/recovery.
- Retirement of held terminal text preserves the completed Run/Attempt/Receipt. Retirement of a matching active
  presentation requests Run cancellation and aborts only that Run's retained/registered controller; its existing
  Effect remains authoritative. Keep the executing continuation until its actual settlement, including unknown,
  rather than fabricating a terminal result from the cancel request. Unrelated tasks/foreground turns and already
  committed `dispatch_committed`/`sent`/`unknown`/`no_target` output are unchanged. This API does not implement the
  accepted-work source owner or generic root waiting contract.
- Boot recovery checks required decisions/continuations before terminal-Effect heuristics. A missing decision is
  failed, unfinished/dispatched work remains unknown, and lost executable bindings expire/refuse without replay.
- Recovery also examines pending delivery rows belonging to **already terminal Runs**. Unpublished text expires
  when its retained context is lost; `dispatch_committed` becomes `unknown`. Do not reopen a terminal Run, rewrite
  its Attempt/Receipt, resend, delete canonical Timeline or refund a committed charge. Already recorded `sent`,
  `unknown` and `no_target` outcomes are not retry queues. Repeated boot is idempotent.

## Atomic publication and accounting

- One durable delivery identity belongs to one Run/Attempt and immutable decision. Stage rejects conflicting reuse.
  Required state/evidence commits in short synchronous SQLite transactions; no transaction spans a transport await.
- Model-opportunity and utterance counts are independent. Migration 050 adds model reservations without rewriting
  migration 049. Reserve Core-wide capacity before async Run admission; link its Run; charge once inside the first
  model Effect intent transaction. A failed intent rolls back charge. Retry/provider failure retains one consumed
  opportunity; only unused reservations are released. Offset expiry input is canonicalized to UTC for SQL windows.
- Default Class B limits are four model opportunities/hour, two utterances/hour, eight/day and a ten-minute gap.
  ConfigSource supplies the whole validated effective policy; hour/day settings must remain coherent. Class A has
  independent behavior and does not consume Class B limits.
- Timeline append, delivery linkage, utterance charge and required `delivery.dispatch_committed` event are one
  transaction. A failed row/event write rolls them all back. Fan-out begins only after commit.
- The same publication transaction rechecks the staged delivery's active Attempt, Character and delivery class
  against the canonical Run. A completed replacement Attempt cannot authorize an earlier staged decision, and a
  mismatched retained class cannot bypass Class B accounting. Refusal precedes Timeline append or any charge.
- `DeliveryCoordinator` also passes its retained source/currentness and ready gate into that same synchronous
  transaction through `RunDeliveryRepo.commitPublication({ ..., isCurrent })`. The optional prepared-content
  predicate rechecks exact approved text and candidate identity there. Every predicate must return exactly `true`;
  throwing, Promise or other truthy values refuse before Timeline/charge. These callbacks perform pure synchronous
  reads only, with no Host/file/network IO or await. This final recheck also covers existing Scheduled/Class A and
  initiative/Class B deliveries; their policy and tool admission remain unchanged.
- Known cancellation/policy refusal before publication leaves no charge. After publication commits, refused,
  absent or uncertain transport never refunds or creates a second Timeline identity. A charge is a conservative
  control fact, not proof that a recipient rendered or read the text.
- User Timezone day boundaries come from the existing timezone service. On zone changes, retain recent charges
  from former zones and the full original civil day when DST makes it longer than 24 hours. Target/zone changes
  cannot mint new allowance. Do not replace civil-day calculation with a presumed fixed offset/day duration.
- `TimelineSubscriptions.publishObserved` accepts only authenticated operator targets. A real WebSocket send
  callback can establish transport acceptance; fallback void sinks, throws/close/timeout remain unknown. Native
  presentation is a separate producer and is never inferred from a successful transport callback.
- Publication refusal reasons are closed and factual: budget, gap, expiry or stale Run. Unexpected persistence
  errors propagate to the owner/recovery boundary; they must not be mislabeled as quota refusal.

## Monitor compatibility and privacy

- Preserve the strict v1 decoder and producers. New decision/delivery writers use strict `run-event.v2` facts.
  The mixed reader retains one contiguous per-Run sequence across versions, including forward/tail/before pages.
- Existing client trajectory/Inspector schemas remain valid: business facts project as semantic lifecycle rows,
  retain original row/sequence identity, and omit unsupported optional closed `eventKind` correlation values.
  No canonical business event is silently dropped to advance compatibility cursors.
- Facts contain bounded identity/state/count/reason fields, never prompts, raw Memory, utterance bodies, secrets or
  sensor content. Observer/Monitor failure does not change committed execution truth. Pre-admission diagnostics
  retain at most 100 recent dispositions per Character; they are not another execution ledger.

## Required verification

1. Real isolated Core/SDK: thin request, primary preservation, strict tool bag, all outcomes, invalid/conflicting/
   missing decisions, duplicate identity, primary reservation and source retirement.
2. Owning-service/SQLite: exact duplicate terminal calls, stale collector, observer settlement refusal, same-Attempt
   hold/resume, terminal/no-dispatch, quota independence, concurrent consumers, event rollback, no refund after unknown,
   DST/zone carry, replaced-Attempt/Character/class publication refusal, exact-Run retirement of terminal held text,
   independent same-Character task/foreground preservation, actual active presentation settlement after cancellation,
   retirement-write rollback, final source/content predicate false/throw/non-boolean refusal, and every
   pre/post-publication crash cut.
3. Existing Monitor: actual v1/v2 decode, legacy-valid forward/backward projection, cursor completeness, reconstruction
   and real process reopen. Additional business events must not inflate model/tool counts.
4. Supported migration lineage retains populated Memory/Timeline state and unsupported history refuses atomically.
   Reopen an applied 049 database through 050; never edit an already applied version for a new table.
5. Shared/Core/Desktop/CLI/E2E typechecks, root lint, proportional tests/build and task validation. Native rendering,
   external-provider behavior and owner/manual acceptance require their own evidence; automated protocol stubs do
   not establish them.

See [User Timezone Authority](./user-timezone.md), [Run Observability](./observability-projection.md),
[Database Guidelines](./database-guidelines.md) and the child task's formal review for concrete evidence.
