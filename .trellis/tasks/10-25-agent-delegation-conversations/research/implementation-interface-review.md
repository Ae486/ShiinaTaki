# S0 implementation interface review

Date: 2026-10-25. Independent architecture/interface challenge of the current [PRD](../prd.md),
[design](../design.md), [implementation plan](../implement.md), saved architecture review and foreground boundary.
The current PRD authorizes implementation; historical planning-only statements do not restrict this review's handoff.
This review owns this document only. No production code, database, dependency or Git operation was changed.

## Decision

The proposed ownership is implementable with the current Runtime, SQLite and SDK seams. No verified contradiction
in the original requirements requires renewed owner clarification. S1 may implement storage and schemas using the
contracts below. Consumer activation must wait for the linked Runtime, routing and recovery tests.

The following are implementation-blocking invariants, not findings that the unimplemented feature is already broken:

1. A pending input request is not a Run state, and accepting its event is not equivalent to releasing execution.
   A reply arriving between completed-step acceptance and terminal settlement must never reopen a resolved wait.
2. A claim, actual model intent, local action acceptance and public speech need different evidence. No timeout may
   return an event with an actual model intent to the pool as fresh work.
3. Primary inbox processing needs an actual private consumer association. Whole-message filtering, fake child
   executions, and retry decisions based only on the remaining public projection violate existing contracts.
4. Generic task age and genuine source/publication validity cannot share a nullable timestamp without an explicit
   discriminator. Restoring routing metadata cannot restore a lost executable source binding or speech grant.
5. SDK rollover cannot be implemented as Run retry, a fixed total step cap, or a call to the existing final callback.
   Raw-input inclusion and summary coverage need separate actual-intent witnesses.

## Verified implementation seams

Paths below are relative to the repository root. Line references describe the dirty worktree read during S0;
subsequent implementation can move them.

| Seam | Current evidence | Implementation consequence |
| --- | --- | --- |
| Atomic terminal owner | `packages/core/src/db/run-terminal-transition.ts:37-62` updates Attempt/Run/receipt, invokes `onTerminalTx`, appends lifecycle events and schedules only after-commit notifications in one transaction. | Extend this participant. Never use only a post-commit listener to create the canonical terminal inbox event. |
| Existing private terminal | `packages/core/src/db/subagent-terminal.ts:15-55` appends the staged tail, derives the canonical result and releases the exact active pointer. | Add event/order references and request activation to the same transaction; rollback must include every participant. |
| Actual dispatch receipt | `packages/core/src/db/effect-repo.ts:68-72` invokes the synchronous intent callback before inserting the model Effect in the same transaction. `packages/core/src/agents/model-effect-middleware.ts:79-95` calls this before provider dispatch. | The consumer delivery receipt uses this seam with a deferred Effect foreign key, just as current child input receipts do. Rendering is not delivery. |
| Existing input correctness | `packages/core/src/db/run-message-repo.ts:25-45` checks exact input scope/order and the complete pending batch through the token watermark; `:65-85` preserves immutable first consumption separately. | Keep these checks while adding a distinct summary witness. Do not weaken completeness to achieve paging or compaction. |
| Existing input/stop CAS | `packages/core/src/db/subagent-input-repo.ts:23-45,56-65` performs idempotency before target validation and only user continuation clears a user stop. | Answer acceptance extends the same transaction and target, with an exact request event ID. Preserve idempotent readback after later control changes. |
| Collector witness | `packages/core/src/agents/subagent-result-tool.ts:22-45,50-54` proposes in execute and commits only after a matching completed result; `packages/core/src/agents/run-message-store.ts:70-74` persists completed messages before the callback. | Reuse the witness pattern for `interact_parent`; atomically join event/request acceptance to its completed private batch. |
| Primary private admission gap | `packages/core/src/db/run-message-repo.ts:141-147,173-196` only admits child/parent-continuation associations and stores terminal staging on that execution row. | Add a real consumer-owned association and staging branch for primary Runs. Do not spoof `subagent_executions`. |
| Mixed native messages | `packages/core/src/agents/turn-mapping.ts:40-74` handles mixed assistant text/tool calls and tool results. `packages/core/src/agents/chat-agent.ts:368-375` currently captures the complete native batch. | Partition tool call/result parts by trusted invocation identity while preserving every surviving public item and the full current SDK history. |
| Primary retry/retraction | `packages/core/src/agents/chat-agent.ts:257-270,287-300` uses yielded text/step completion for clean retry and recorded output for retraction. | Private delivery/actions must independently fence unsafe replay and preserve the original user witness even if public projection is empty. |
| Live private gap | `packages/core/src/agents/chat-agent.ts:403-406` observes all stream parts; `packages/core/src/agents/chat-activity.ts:82-87,155-197` receives observer phases and native calls independently. | Route both observer callbacks and public stream call parts before main/Pet activity, including failures from a known private binding. |
| Queue reuse | `packages/core/src/agents/turn-queue.ts:52-66` reserves primary priority and refuses background acquisition when held or reserved. | One inbox coordinator can offer the same eligible batch at primary preparation and idle admission; cooperative yield retains existing lane ownership. |
| Existing task age coupling | `packages/core/src/harness/subagent-execution.ts:33-35,73-79`, `subagent-state.ts:78-84`, `subagent-service.ts:210-214`, and `packages/core/src/db/subagent-execution-repo.ts:145-149` use work age as timer, Run deadline, currentness and admission. | Remove generic task-age authority at all these sites, retaining source-owned finite checks and per-request timeouts. |
| Publication coupling | `packages/shared/src/prepared-publication-schema.ts:19-30`; `packages/core/src/harness/prepared-publication-authorization.ts:18-43`; `packages/core/src/delivery/prepared-publication-source.ts:83-95` compare finite accepted-source and candidate dates. | Change accepted-source validity explicitly across all consumers. Candidate/delivery freshness stays finite; WeakMap identity stays authoritative. |
| SDK/context handoff | `packages/core/src/agents/work-context.ts:11-29`, `chat-agent.ts:329-375,399-415` expose preparation, actual intent, completed step and outer finish seams. | Make private preparation awaitable and add a typed segment checkpoint result without moving tool execution outside the SDK. |
| Unbounded project caches | `packages/core/src/agents/run-message-store.ts:34-63,90-97` accumulates carried/prepared inputs and rescans work; `packages/core/src/harness/subagent-tool-materials.ts:28-29,35-68` caches by Attempt/call ID. | Use durable frontiers/paged pending reads, current preparation and bounded replay tail. Material identity must include task step or actual model Effect to survive repeated provider call IDs. |
| Disclosure | `packages/core/src/agents/tool-disclosure.ts:50-66` reconstructs visibility from SDK-local completed steps. | Retain a bounded activated-name set for the same captured generation across segments; do not replay loader effects. |

## Minimal persistent records and owners

These are semantic interfaces; exact TypeScript identifiers may follow package conventions. Public/read/tool shapes
belong in Shared. Transaction-only functions and executable bindings remain Core-only and are never decoded from RPC JSON.

| Record | Owner and required identity | Mutability |
| --- | --- | --- |
| `AgentEvent` | Delegation repository: event ID, Character FIFO sequence, child/work, kind, producer Run/Attempt/task-step/call witness or canonical terminal receipt, source/body reference and digest, acceptance time, notification eligibility/reason. | Accepted body/provenance/identity/eligibility immutable. Use stable producer uniqueness; bridge legacy terminal identity once. |
| `WorkDisposition` / request | Private work owner: work ID, version, pending request event ID; request status and optional addressed answer input ID. At most one unresolved request per work. | CAS state; retain immutable transition/answer evidence. It is independent of Run terminal state and conversation user-stop. |
| `InboxConsumer` and batch members | Delegation inbox owner: consumer ID, Character, real Run/Attempt, foreground or idle mode, immutable exact event membership/digests and bounded rendered projection identity. | Claim can be released only with proven pre-intent state. A new Attempt requires an explicit new binding, not mutation of old evidence. |
| Actual inclusion | Inbox owner joined to model Effect: consumer, event, actual Effect/input digest, request task-step and supplied projection digest. | Append-only; one actual Effect cannot claim a different batch. Repeated inclusion in the same ongoing consumer remains same work, not a fresh dispatch. |
| `EventAction` / disposition | Inbox action owner: event ID, stable operation/action identity, consumer/Run/Attempt/invocation/Effect, input digest, accepted result and optional accepted child input/publication reference. | Idempotent and immutable once accepted. Conflicting replay refuses. A recorded disposition establishes handled, never public delivery. |
| Private consumer transcript | Existing `run_messages`, guarded by the real consumer association, plus consumer-owned terminal staging. | Existing complete-pair validation, append identity and immutable rows remain. No Timeline mirror. |
| Summary and intent witness | Private transcript owner: child/work scope, revision, exact covered canonical references/frontier and digest, summary text; actual Effect joins summary revision separately from raw input IDs. | Atomic CAS revision/coverage under current owner; raw messages, materials and original first-consumption receipts stay immutable. |
| Conversation order references | Private history owner: child sequence, work ID, canonical source type/key, optional whole-batch identity, historical-order marker. | Insert transactionally with canonical source; unique source reference avoids input/report duplication. No duplicate content or execution state. |

The action owner must preserve full accepted private payload/result evidence before `toModelOutput` pruning. Existing
`prepareRunMessageBatch` removes tool inputs; a names-only call plus a compact result is not sufficient to reconstruct
an accepted child answer or internal note. The action row/body owner supplies that evidence; the native pair references it.

## Execution interface handoff

```ts
// Trusted runtime ports, intentionally schematic rather than new public executors.
acceptChildInteractionTx({ producer, token, completedBatch, kind, body }): AcceptedEvent;
acceptAddressedAnswerTx({ operationKey, target, replyToEventId, sender, direction, materials }): AcceptedInput;
claimInboxBatch({ characterId, consumerRun, maxEvents, maxRenderedBytes }): PreparedInboxBatch | Empty;
commitInboxIntentTx({ preparedBatch, actualModelEffect }): void;
applyInboxActionTx({ actualInvocation, eventId, operationKey, action }): ActionReceipt;
releaseUnsentClaimTx({ consumerId, expectedVersion }): void;
settleInboxConsumerTx(canonicalRunTerminalFact): void;
```

Recommended intrinsic tool surface is `interact_parent` (`message` / `needs_input`) and existing `complete_subagent`
for children; `read_agent_inbox` and `handle_agent_event` for the main consumer. Mandatory child self-history retrieval
is separate from inherited external tool allow-lists. Names are binding registry constants, not privacy fields in model
arguments. Feature-controlled `record_only` collectors remain feature-controlled.

`handle_agent_event` checks actual delivered membership, Character, work, current target and action digest. An
`answered_child` action commits the addressed input and its action/disposition receipt together. On an unknown response,
read back the same operation identity; never send a new answer speculatively. `speech_proposed` stores only a proposal;
the delivery owner or real committed primary text supplies publication evidence.

At preparation, claim only a bounded oldest-eligible batch and build its exact attributed envelope. At actual intent,
revalidate its identity and commit inclusion through the existing Effect transaction. Claim/intent/currentness failure
must never remove the primary user's request or label an omitted event delivered. An event with prior model intent and
no disposition remains reconciliation-needed. A later explicit continuation reconstructs that consumer with its prior
receipts; it does not create fresh automatic event processing.

Blocked oldest events retain a visible reason while eligible later events advance. Use commit sequence, not random Run
ID, for FIFO. The initial 8-event / 16-KiB envelope and 1.5-KiB previews remain projection limits. Missing speech authority
does not block private handling. Successful opportunities advance finite eligible backlog; provider outage cannot promise
a wall-clock completion bound.

## Input-wait, terminal and Stop races

- `message` commits with its completed private batch and does not stop execution. `needs_input` reserves a mutually
  exclusive terminal intent against `complete_subagent`, including parallel calls in one SDK response. Refuse a second
  conflicting proposal before effects outside the chosen action can be mistaken for accepted work.
- A collector execute response acknowledges a proposal; the event's durable `accepted` state begins only when its
  completed-result witness and event transaction commit. Name/document this distinction in the new tool result. A
  proposal that loses its SDK result must not be shown as an accepted event merely because its execute closure returned.
- The matching completed result makes the request/event durable and stops dependent inference. The existing Run terminal
  transaction releases the active pointer and makes the work quiescent; a `completed` Run with an accepted input request
  is an execution boundary, not task success. The task disposition says `needs_input`; no success final event is fabricated.
- Input acceptance can race that boundary. Persist an answer only with the exact `replyToEventId`, matching child/work,
  current control target and operation identity. Its input insert and request-resolution CAS are one transaction. If it
  arrives before pointer release, retain it pending; terminal settlement must not replace `answered` with `open`. Schedule
  a new execution after release under fresh authority when safe. Ordinary messages may queue but cannot clear the request.
- If new unconsumed direction already supersedes a proposed wait/final, do not claim a current accepted terminal proposal.
  Preserve the completed tool/raw evidence and pending direction. The collector needs an explicit stale/refused outcome;
  it must not set its committed-stop flag for a rejected proposal.
- User Stop's durable origin determines suppression of only the resulting terminal/cancellation notification. Copy that
  determination into immutable event eligibility while settling; later Continue must not retroactively notify an old Stop.
  Earlier accepted messages remain history. Parent input cannot clear the user latch. New user continuation changes future
  reporting eligibility without replacing the original counterpart.
- Restart first settles orphan Runs using existing canonical recovery. Restore inert generic routing/request metadata;
  do not restore live closures or automatically replay interrupted child actions. Source-owned work still requires its
  source owner. Unknown non-model Effects retain reconciliation requirements before new dependent execution.

## Foreground private routing contract

Create a trusted registry of private tool bindings per consumer before model dispatch. Record invocation identity with
the actual model Effect/task-step/call ID; validate arguments separately. A known private binding's invalid arguments,
denial or exception still use the private route. A model-written private flag on an ordinary tool changes nothing.

At a completed step, project complete private call/result pairs into private Run evidence and complete public pairs plus
ordinary text into primary recording. Preserve original identities and relative order; recompute surviving presentation
references. Keep full combined messages in the active SDK loop. Do not use the compact persistent public projection as
the next in-flight model history.

Apply the same classification before both observer activity phases and native stream tool-call observations. Private
payloads and invocation names/phases never enter main/Pet activity, exposure targets or primary Memory witnesses. Public
text remains actual public speech; private notes/answers use structured actions. Supply event references/digests as
program-owned source context for affected public assistant rows without embedding private bodies or changing the user row.
Current Memory filtering remains; add no replacement ingestion service.

`hasProducedPublic`, `hasPrivateAcceptedAction`, `hasCompletedNativeStep` and `hasInboxModelIntent` are different facts.
Keep retry fencing from full native execution/effect evidence. For an inbox consumer, any actual model intent forbids
fresh automatic event handling even if a later provider error is classified as clean context overflow. An ordinary primary
turn without a delivered inbox retains its established clean-overflow behavior. Retraction must not discard the user
witness after an accepted private action. Exceptions retain true public partial text and durable private receipts without
inventing missing tool results; unmatched/unknown invocation evidence stays in its action/Effect owner.

## No task expiry and publication

Use explicit validity such as `{ kind: "until_cancelled" }` versus `{ kind: "expires_at", expiresAt }`. Generic work is
the former. Feature-owned finite work/source checks remain the latter. A finite per-model-request timeout is not a task
deadline. Generic admission must omit the old task-derived Run deadline and timer; execution/source guards remain active.

For schema migration, preserve existing input/result JSON, request/result digests, consumed receipts, old deadlines and
terminal outcomes as historical evidence. Prefer an explicit validity field plus nullable legacy `work_expires_at` for
new no-expiry rows; rebuilding the constrained table must copy old values byte-for-byte and reinstall immutability/index
contracts. Do not encode no expiry as a far-future sentinel. Old generic work can continue explicitly under new authority,
but migration does not restart it or revive expired/withheld/admitted historical events and lost publication grants.

Accepted-source authorization gains the same explicit finite/until-cancelled comparison; candidate and delivery expiry
remain finite. For a finite source, candidate expiry cannot exceed it; an until-cancelled source still needs current
source identity and the live WeakMap handle. Original-request final-answer rights close on their relevant final publication
or explicit cancellation, not on silent interaction, input questions or unrelated `no_action` handling.

The read T4 migration registry ends at 057. The coordinator independently checked main through 059 and reported existing
049-057 lineage divergence. Reserve 060+ for new T4 work to avoid another numeric collision, after the implementation
owner rechecks the registry. This does not establish T4/main migration convergence or old-binary compatibility.

## S4 context ports that S1 must support

- Extend `PreparedWorkStep` with an exact raw input set, captured pending watermark and optional committed summary
  witness. Make private preparation awaitable. A summary Utility request must not invoke task-input consumption.
- Summary CAS covers complete already durable action rounds and only inputs with first consumption. Its digest includes
  source/sender identity. All pending input through the request watermark must be present before task intent; later input
  stays pending. Summary-only historical inputs get no raw-inclusion receipt on the new Effect.
- At measured provider or retained-material pressure, finish the SDK call only at a durable complete frontier. A typed
  `context_rollover` leaves Run/Attempt/lane/signal/captured authority alive. The next segment uses monotonic task-step
  ordinals and fresh model Effects; it does not call `onRetry`, settle Run, invoke final callbacks or emit parent events.
- Preserve activated tool names for the same captured generation and release SDK/project raw caches only after their
  canonical evidence and summary checkpoint are durable. Exact material identity cannot be merely Attempt/toolCallId.
- Refuse unsafe rollover with pending approval/deferred/provider tool pairs or unknown external outcomes. A giant current
  round uses an explicit bounded body projection with exact retrieval or a truthful context failure. Failed/non-shrinking
  summaries retain raw history and prior revision and have bounded attempts per unchanged range.

## Error and recovery matrix

| Condition | Durable result | Allowed next action |
| --- | --- | --- |
| Same producer/operation and same digest | Return original event/input/action receipt. | Readback; no second effect. |
| Same identity, changed digest | Explicit idempotency conflict; no mutation. | Caller corrects identity or inspects prior result. |
| Wrong Character/child/work/consumer | Scope refusal; no acceptance/receipt. | No fallback target and no fabricated empty success. |
| Stale control target or answered older request | Conflict/refusal; newer wait and accepted inputs unchanged. | Refetch exact target; explicit answer to current request. |
| Parent answer while user-stopped | Answer may be accepted as queued context if otherwise valid; user latch remains. | Only explicit user Continue permits execution. |
| Event claim prepared, admission/intent transaction fails | Accepted event remains undelivered; release only if no actual intent exists. | Retry at meaningful new opportunity with fresh authority. |
| Model intent exists, no output/disposition or remote outcome unknown | Delivered, not handled; reconciliation-needed with consumer evidence. | Explicit continuation of same consumer; no automatic fresh replay. |
| Child answer/action commits but SDK stream/result is lost | Action/input receipt retained; Effect outcome reported truthfully; no fabricated native pair. | Read operation receipt and continue without sending again. |
| Terminal participant fails | Roll back Run/Attempt/receipt/tail/event/order/pointer together. | Surface storage failure and recover canonical transaction. |
| User Stop races accepted terminal proposal | Canonical cancellation overrides task-success assertion; Stop-derived event is ineligible. | Inspection and explicit user Continue only. |
| Generic old task age exceeded | Historical deadline/outcome retained; new work validity is no-age-expiry. | Explicit continuation of same work with current authority. |
| Real source retired/expired or executable binding unavailable | Source refusal/deferred reason; no inferred permission or publication. | Source owner restores valid binding; generic private handling remains independent where authorized. |
| Missing/lost speech grant | Private disposition may commit; publication is separately refused/unavailable. | Do not consume an unrelated final-answer grant. |
| Summary CAS/quality failure or input envelope unfit | Old summary/raw/pending evidence unchanged; bounded explicit context failure/degradation. | Retry only changed input/range/authority or explicit continuation as appropriate. |
| Read cursor mismatch, unavailable source or DB read failure | Distinct invalid/unavailable/failed result, never empty-success. | Bounded scope-correct recovery; all retained body pages remain reachable. |

## Verification status

This was source/interface review. It does not claim implementation, a passing new SQLite fixture, a live SDK integration,
Memory end-to-end acceptance, rendered UI behavior, paid provider execution or human acceptance. The coordinator owns
fresh baseline tests; historical test reports were not promoted to current results here.

Required gates remain the implementation plan's real SQLite atomicity/idempotency/restart fixtures, mixed primary/private
native flow including both Memory witness paths and private retry fencing, exact reply-before-terminal race, legacy
no-replay migration, finite-source regressions, and actual shared ChatAgent segmentation with bounded retained references.
Installed-SDK feasibility from prior offline probes is useful evidence, not completion of those application gates.
