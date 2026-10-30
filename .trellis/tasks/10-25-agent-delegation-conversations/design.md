# Interactive delegation design

Status: implementation authorized, 2026-10-25. The [PRD](prd.md) owns requirements and latest authorization;
[context recovery](research/context-recovery.md) owns the recovered authorization and baseline boundaries.
Current production specs continue describing the delivered baseline until this follow-up is implemented.

## Decision and alternatives

Extend the existing Core Runtime, SQLite repositories, `ChatAgent`/AI SDK and Chat presentation. Add only the missing
private event, summary and read-projection contracts. Keep package versions and the existing single execution authority.

| Direction | Assessment |
| --- | --- |
| Extend only terminal completion rows and idle dispatch | Insufficient: cannot carry nonterminal interaction or batches, restore routing, or avoid starvation during continuous foreground chat. |
| Extend current owners with a durable inbox, private context checkpoints and shared presentation | Selected proposal. Meets continuity and source/authority boundaries; requires the explicit changes below. |
| New agent framework, external mailbox broker, or copied Chat page | No demonstrated need; adds execution/recovery or UI ownership and maintenance cost. |

Evidence and alternatives: [Runtime](research/runtime-lifecycle.md), [SDK/context](research/worker-context-sdk.md),
[UI](research/conversation-ui.md). These reports contain current source locations and experimental limits.

## Ownership and persistent facts

| Concern | Owner and proposed change |
| --- | --- |
| Conversation, accepted input, native output and terminal Run evidence | Existing `subagent_*`, `run_messages` and Run/Attempt/Effect repositories; remain canonical. |
| Child-to-main event | New immutable event rows in the existing delegation repository boundary: event ID/sequence, Character/child/work, producer Run/Attempt/tool witness, kind, source/body reference, accepted time and notification eligibility. |
| Input dependency | Minimal work disposition/request record, referencing the exact accepted `needs_input` event. Separate from Run terminal state and the user-stop latch. |
| Delivery and handling | Per-event consumer association with actual Run/Attempt/model Effect and an explicit durable disposition. Exact batch membership and event/action identity support races, duplicate input and recovery. |
| Private summary | Revisioned summary and complete coverage/frontier/digest in the private transcript owner; raw history remains authoritative. |
| Continuous private history order | A narrow conversation commit-order reference index, written transactionally with existing input/output/control/report owners. Stores source references, not duplicate content or execution state. |
| Live private activity | Disposable selected-child projection of real SDK/tool observations, keyed by child/Run/Attempt. Completed/partial evidence stays in existing durable stores. |

Character scope and trusted origin come from actual admission/authenticated entry points. Model-written origin fields
grant nothing. All new public shapes belong in `@taki/shared`; private events never become user Timeline rows, automatic
Memory evidence or presence-exposure targets. One transaction must commit a canonical terminal outcome and its event,
pointer release and ordering references, or commit none of them.

## Child reporting and control

Use a small internal `interact_parent` action with explicit `message` and `needs_input` variants, plus the existing
`complete_subagent` final collector. Names are an implementation proposal; the semantic separation is required.
Ordinary messages commit asynchronously and let independent work continue. A committed `needs_input` ends the current
execution at a complete action boundary, releases the lane and retains the same conversation/work plus pending question.
An addressed answer resolves that exact question and can start a new Run under fresh captured authority. Stale answers
cannot clear newer waits. Final and input-wait proposals are mutually exclusive within an execution; acceptance requires
the matching completed SDK tool-result witness. Runtime failure/interruption comes from actual execution evidence.

Natural SDK completion without a committed final report remains unstructured/partial. Neither a completed Run nor text
saying “done” closes the conversation. Permanent closure is not added.

User Stop records the real cancellation and suppresses only Stop-derived automatic main notifications, including failure
and restart paths caused by that Stop. Already accepted earlier events retain their history and are rechecked against
current state before action. Inspection remains available. Parent input cannot clear the user latch; explicit user
Continue restores normal future reporting without changing the counterpart. Parent cancellation leaves child work alone.

New ordinary Companion delegation defaults to interactive main reporting. Existing captured policies remain unchanged.
Feature-owned `record_only` work retains its validation, result callbacks, source validity and zero automatic parent
inference. Internal history/reporting capabilities are explicit Runtime capabilities, separate from inherited tool
allow-lists; they do not widen OS/Memory/source permissions. Feature-owned collectors remain feature-controlled.

## One inbox, foreground and idle consumption

Persist before signalling. The existing delegation coordinator offers one oldest-eligible batch at two opportunities:

1. At a safe next primary model request, attach attributed private work evidence alongside the current user request.
   This covers continued foreground chat without aborting a reply or waiting for a child.
2. When the Character lane has no primary owner/reservation, admit one internal main-Agent handler through the existing
   background lane. It may answer a child, retain results or propose authorized speech. A later primary reservation
   requests cooperative yield; it never steals a lane or repeats an already executed tool.

Both paths share exact batch claim and actual-intent receipt logic. Preparation/rendering alone consumes nothing.
Claims proven not to have reached intent are releasable; after an actual intent, retain that consumer's evidence rather
than passing the same event to a competing handler as fresh work. Start with at most 8 events / 16 KiB rendered per
request and 1.5 KiB body previews, with explicit detail references. These are tunable projection bounds, not task limits.
Oversized events still get a bounded readable envelope. FIFO applies within a Character; a blocked event remains visible
with its reason while eligible later events advance. Report real backlog count/age and reconciliation state.

`accepted` means stored; `delivered` means exact inclusion at an actual model Effect intent, not proven remote receipt;
`handled` requires a committed explicit per-event disposition (`retained`, `answered_child`, `no_action`,
`needs_user_input`, or `speech_proposed`). A bounded internal handling action validates membership in the delivered set.
Speech is a separate publication outcome. Natural end does not silently acknowledge every delivered event.

Retry automatically only when evidence proves failure before model/tool intent, using meaningful retry triggers and
fresh authority. Missing handling disposition, unknown execution or a handler failure after effects remains inspectable
as reconciliation-needed. Explicit continuation carries the same event and previous action receipts. Event/action
idempotency prevents duplicate answers/publication; no exactly-once external-model guarantee is claimed. For finite
eligible backlog and successful handling opportunities, bounded FIFO delivery prevents starvation behind ordinary chat.
Provider outage or unresolved authority cannot support a wall-clock success guarantee.

On restart, existing recovery first settles orphan executions. Restore trusted generic routing/policy metadata for
already accepted events and waits, then capture authority anew for each new execution. Do not auto-resume interrupted
child actions. A source-owned binding must be supplied by its source owner; copied JSON cannot recreate executable
closures, source checks or publication handles. Missing speech authority must not strand internal event handling.

### Foreground private action and public speech boundary

Use the intrinsic inbox read/handling actions as private capabilities bound by Core to the actual delivered batch
and primary Run/Attempt. Route by registered binding and actual invocation identity, not model-written privacy or
sender fields. These actions call the existing child/action owners; they do not create a separate executor. Extend
the existing Run transcript guard/staged terminal boundary with that validated inbox-consumer association instead
of inventing a child execution for the primary Run.

At each completed SDK step, split private call/result pairs from the native message parts while preserving public
text and unrelated public tool pairs in order. Keep the full combined messages available to the current SDK loop.
Private pairs, internal notes, dispositions and invocation activity stay under private Run/event evidence; no hidden
Timeline rows, main/Pet activity, exposure targets or primary Memory witnesses are created for them. Apply routing
before live activity as well as durable recording, including known-private validation failures. Recompute primary
presentation references after filtering without changing surviving item identities.

Ordinary primary text remains actual public Companion speech under the current primary request. Private child
answers/notes use the structured action channel; there is no implicit private prose channel or semantic classifier.
An intentional public answer using a child result remains public. Its program-owned source sidecar identifies the
events actually supplied to the request, without embedding their private bodies or claiming the user authored them.
The original user row and ordinary primary tools remain intact. Pass only real committed primary rows to existing
Memory callbacks and preserve their current text/tool filtering. This is a routing guarantee, not a guarantee that
model instructions can prevent every inappropriate choice of public wording.

Completed private effects still fence automatic whole-request retry. On failure/Stop, preserve committed private
action evidence and actual public partial text independently; never fabricate a complete private tool result or
handled receipt. Later primary replay uses public history; resumed private handling reconstructs only bounded
event/action evidence under the same consumer identity. A foreground speech outcome needs the actual committed
primary text witness, not just a `speech_proposed` assertion. See [verified boundary](research/foreground-private-boundary.md)
for current protections, alternatives and mixed-step/Memory/partial/stream validation gates.

## No task expiry; separate publication validity

Remove generic `lifetimeMinutes`/active `workExpiresAt` from model/API, admission, timers, scheduling, Continue and
completion decisions. No sentinel date, renewed hidden lifetime or fixed total execution/turn count replaces them.
Individual request deadlines, genuine source/permission validity, cancellation and unknown-effect reconciliation remain.

Use a forward T4 migration: permit new generic work without active expiry, preserve old timestamp/digest/receipt bytes
as historical evidence, and stop using old generic task timestamps to block a new explicit continuation. Keep historical
expired/cancelled/unknown Runs terminal. Migration itself emits no wake and replays no effect. Bridge only eligible
legacy pending/deferred `request_parent` results with stable event identities; admitted/handled/withheld outcomes and
`record_only` are not reissued as fresh notifications.

Removing task expiry also touches original-request speech authorization. Introduce an explicit accepted-source validity
union: existing finite feature-source validity, or until-cancelled validity selected only by the trusted original-request
adapter after validating the actual primary user-row witness. Finite candidate/delivery freshness is captured when speech
is proposed. It may refuse that publication without expiring the task or inbox. Never rely on absent timestamps and
unchecked date parsing. Ordinary interaction/silent handling does not consume the final delayed-answer right.

Old expired/closed acceptance and process-lost handles cannot be extended or resurrected by migration. Their events may
still be retained or answered internally; expose `publication_unavailable`. A later genuine primary turn has its own
normal speech authority. This preserves the existing explicit publication trust boundary, at the cost of not promising
automatic delayed speech after loss of its authorization. Finite Co-Watching/source publication is unchanged.

Before selecting a migration version, inspect the live T4 registry and known main divergence. Preserve applied scripts.
Validate fresh/current/legacy T4 data with isolated fixtures; T4/main convergence stays a separate release gate.

## Private task context and bounded SDK calls

Only actual child scope loses the project step-count stop; main and parent-continuation policy stay unchanged.
Explicit SDK natural/collector conditions avoid the installed SDK fallback cap. Reuse current measurement and paired
action-round helpers, with an awaitable private preparation/checkpoint port. Price instructions, disclosed tools,
summary, current input and history together. Start from the existing measured pressure policy; retain the newest complete
round and as many recent complete rounds as the target budget allows. Do not slice arbitrary database rows.

Summary contains task/constraints, findings/decisions, completed actions, outstanding work and essential references,
preserving sender, source and negation. It has no Character voice or relationship/Memory processing. Commit summary and
coverage together with a digest/revision/current-owner CAS after completed raw messages/materials are durable. Concurrent
new input stays outside that frontier and is consumed only by its later actual model intent. Failed/stale/non-shrinking
summaries keep prior summary/raw evidence. Bound retries per unchanged range; continue only if remeasured input fits,
otherwise surface a truthful context failure and unfinished work. Giant current tool bodies need bounded projections
with exact retrieval; unresolved tool pairs and oversized immutable instructions cannot be silently dropped.

The SDK probe demonstrates that `prepareStep` alone does not release accumulated responses. At measured retained-material
pressure, finish the SDK call at a complete durably checkpointed frontier and open another SDK call inside the same live
Run/Attempt/lane/cancellation scope. This internal rollover is not task completion, retry or a second tool executor.
Map SDK-local step numbers to a monotonic Attempt ordinal; every real model dispatch still gets its own existing governed
Effect. Preserve disclosure state for the same captured Skill/MCP generation without replaying loader tools. Release
already durable SDK/preparation/recording/material caches; older data resolves through canonical private repositories.
Summary calls use the governed Utility path and must not consume task inputs or reuse task-request Effects.

Keep first consumption, exact per-request inclusion and summary coverage separate. Replace the accumulating
`carried` set and repeated full-work input scans with durable first-consumption facts, paged pending input reads and
the bounded exact tail selected for this request. At the actual model intent, record exact input IDs only for raw
addressed inputs present in that request; record summary revision/coverage/digest as a distinct projection witness.
An old input represented only by summary gets no new raw-input receipt. The immutable first-consumption receipt
remains unchanged. Newly accepted input cannot be summarized away before its first task-model dispatch.

Capture the request's work watermark and require every pending input through it in the actual prepared payload;
later arrivals remain pending for the next request. Paging is a read strategy, never permission to skip pending
corrections or silently advance the watermark. If that complete pending batch cannot fit after safe projections,
surface an explicit context failure without consuming it. Summary/coverage CAS and intent validation recheck the
same stop, owner and source facts. Release covered input/preparation references only after their raw evidence and
summary witness are durable. Test many addressed corrections across rollovers, not only long tool output.

Before relying on this direction, production tests must prove finish-callback suppression, unique receipt/material keys,
unresolved/provider tool handling, cancellation between segments, disclosure continuity and bounded retained references.
The offline 25-request rollover probe establishes SDK feasibility only; it does not establish these application properties.

Expose mandatory intrinsic self-history retrieval in the child's actual executable/disclosed tool set, including when
inherited external tools are empty. Bind the child identity, allow only its own requested messages/inputs/results and
bounded body pages, and validate cursors. Parent inspection exposes one category/page including worker-list cursors.
All retained evidence must be reachable; omitted, absent, unavailable and failed are distinct. Compact model output using
`toModelOutput` while retaining full required raw result/source evidence before pruning. Exact action target/version and
useful material references survive; human formatting is separate.

## Shared Chat surface and private read model

Extract a narrow shared conversation frame, sender-aware rows, scrolling and composer shell from current Chat.
Main Chat and private children keep their own controllers, data adapters, policies and subscriptions. Do not mount
`ChatPage`/`useChatTimeline` in children or copy their implementation. Share styling, Markdown/tool cards, IME handling,
prepend anchors and new-content behavior without primary Timeline, presence, Memory or Companion adjuncts.

The Core continuous-history projection joins canonical source records by stable conversation ordering references and
returns work identity on every entry. Accepted inputs render once, with inclusion receipts as status; reports render once
with linked tool acceptance/details. New entries use actual commit order. Legacy entries use deterministic historical
ordering explicitly marked as such, without inventing a precise time order from random Run IDs. Provide newest, older
and gap-recovery cursors plus current control target. Tool pairs and full-body pages remain coherent across page edges.

Install a private real activity sink on child execution. Reuse pure shared activity mechanics, not the Character-only
main/Pet projection instance. Snapshot/subscribe watermarks, child/Run/Attempt/client generation checks and complete-batch
commit handoff preserve visible output until its full durable replacement exists. Bound live state and selected-child
subscriptions; gaps/overflow trigger explicit stale state and bounded recovery. Hidden views preserve lightweight read
obligations and drafts, retire heavy observation, and reconcile on return. No frontend polling or invented progress.

Keep draft revision, exact addressed work, paging and scroll state per child in existing disposable application state.
A running child accepts asynchronous input while Stop remains available. A quiescent user-stopped child offers `Continue`
or explicit `Send and continue` using the existing single authoritative Continue operation; optional Send-only retains
its literal queue-without-resume behavior. Reconnect/timeout preserves content and displays unknown outcome, refetches
truth and never replays a mutation. Historical work focus must not silently retarget a draft. Keep currently supported
input capabilities; sharing the composer does not introduce an unimplemented image-upload path.

## Review and implementation boundary

The [execution plan](implement.md) maps all PRD criteria to slices and tests. Final architecture review must challenge
inbox/primary Memory exclusion, publication validity, historical migration, SDK rollover and live/durable UI handoff.
Production implementation and deterministic verification are authorized. Paid external calls, real-user database
changes, human acceptance and Git delivery remain separate boundaries. Earlier research records describe their
planning-time evidence and do not override the latest PRD authorization.
