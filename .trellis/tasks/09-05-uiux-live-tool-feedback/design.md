# Live tool feedback design

## 1. Reviewed sources and scope

Implement the owner-confirmed G2/G3 behavior after D64 and D68-B. The latest execution delegation
authorizes design choices, implementation, engineering acceptance and scoped local commits without
repeated confirmation. Main activated this task on 2026-09-07 after the checked D68 delivery and
upstream integration commit `258b35b`.

Sources: [current producer/persistence preflight](research/live-feedback-contract-2026-09-06.md),
[D68 exact invocation bridge](../08-28-dsh-observability-expansion/research/d68-query-contract-2026-09-06.md),
[owner grill](../08-22-t4-agent-architecture-observability/research/uiux-grill-2026-09-05.md),
[motion contract](../08-22-t4-agent-architecture-observability/research/uiux-motion-continuity-2026-09-05.md)
and `.trellis/spec/backend/operation-presentation.md`. Read the completed D68 implementation before
coding; reuse its snapshot and outcome seam rather than implementing the research proposal twice.

This child owns foreground Chat/Pet activity, durable presentation metadata, exceptional-ending
fidelity and continuous rendering. It does not change tool authorization, effects, execution/retry
policy, Memory/Hindsight, D63, D75/D76, D77 taxonomy or proactive/heartbeat behavior.

## 2. One truthful ordered activity producer

Use the existing admitted foreground-turn identity (`chat.send` acknowledgement `messageId`) as the
activity lifetime and final batch identity. This differs from a persisted Timeline row's `id`.
Keep actual Run/Attempt IDs when supplied; legacy direct callers may omit them rather than fabricate
a Run. Within one accepted message, sequence numbers are monotonic and do not reset for a retry.

Assign stable segment/invocation item IDs in Core. The public SDK stream determines text/tool order;
each tool-call boundary closes the current language segment. A later language delta starts another
segment. Flush buffered text before publishing the tool receipt. All subsequent phase/result updates
refer to that same invocation. D68's per-request/SDK-object bridge prevents reused call IDs from
merging different invocations and freezes names from the same A2 capture.

Execution callbacks can precede consumption of the public tool-call chunk. Buffer those updates by
invocation until its ordered receipt exists; do not insert a tool before earlier language. States
must reflect actual signals: receipt is waiting, SDK wrapper entry is processing, Approval wait is
waiting for confirmation, and only a confirmed underlying dispatch is executing. If a source cannot
prove a phase, retain the last truthful phase. Tool completion stops the busy indication immediately.
No timers infer state, and no presentation event executes a tool.

Use the shared pure normalization seam for final success/failure, denial, cancellation and unknown
outcome. `ok:false`, MCP `isError:true`, tool-error and known execution-denied results cannot look
successful. Preliminary output never settles. Capture outcomes before MCP/SDK model-output conversion
loses them. Preserve original canonical output and use only safe existing messages/codes for display;
do not broaden D77 or forward raw exceptions/arguments/results in activity events.

## 3. Shared wire, fan-out and bounded restoration

Define schemas in Shared and export named APIs. Use `chat.activity` with a Character/message/optional
Run/Attempt envelope and monotonic `seq`; the closed event union contains turn start, text delta,
tool receipt, tool phase, tool terminal and turn terminal. Receipt carries a stable item ID, order,
canonical tool identity and bounded captured name. Later updates reference the item ID. Terminal
events may contain actual measured duration and a safe message, but no raw input/output envelope.

Broadcast via the existing authorized Character Timeline subscription registry, with a single copy
for the initiating physical connection. Initiator-only `chat()` settlement, draft restore and legacy
chat.complete/error remain separate. A different Character cannot receive or read the activity.
Receiving activity never automatically opens Pet.

Add read-only `chat.activity.read({characterId})`. Its disposable projection is owned alongside the
existing Character Agent lifecycle, with at most the latest started foreground turn per Character.
Return explicit active/terminal/idle/unavailable state, last sequence and complete currently retained
items. Replace the projection when the next queued foreground turn acquires execution and starts,
then release it with the owning runtime. A merely admitted queued request must not replace the
currently running turn's snapshot or suppress its remaining activity/terminal publication;
disposing an observing view releases its subscription only, without cancelling the underlying turn.
Keep the existing initiating request's explicit cancellation and connection-loss contract in
`chat-send.ts`; this child adds no cancellation authority to projection/view disposal and does not
change that established execution policy. A terminal projection may retain the last reply
for reopening an existing Pet bubble, but is not a durable history or a replay source.

Main selects a recovery-snapshot budget of 512 items and 1 MiB UTF-8 display text, counted incrementally.
These are explicit adapter resource bounds, not claims about model capacity. On overflow, drop the
recoverable projection and return unavailable with safe guidance to await/refetch committed history.
Never return a truncated snapshot as complete or let a newly attached consumer display only a suffix
as the full response. Existing canonical persistence is unaffected. Do not repeatedly re-read a
known over-capacity projection while that same turn remains unavailable.

Restore by registering handlers, subscribing, then reading a snapshot. Buffer events during the
read, install the snapshot atomically, then apply only later sequence numbers. Bound the buffer;
overflow triggers read-only recovery. Generation, Character, message and attempt guards reject late
callbacks. A send acknowledgement racing notifications is buffered/matched to its actual request;
an old complete/error cannot settle a new send. Restoration never repeats chat.send or tool execution.

## 4. Durable presentation and atomic batch handoff

Add one nullable presentation JSON column to the existing `timeline_messages` table through the normal
additive migration path. Old rows and clients remain compatible. This is optional view metadata;
canonical content/parts/output, row IDs, sequencing and replay remain unchanged. Do not turn legacy
string messages into text-part messages merely to attach UI identity.

Use a strict versioned Shared metadata schema containing only:

- the accepted chat messageId, row entryIndex/entryCount, and covered activity sequence;
- ordered references from canonical text/tool parts to stable item IDs (a missing part index may
  reference a plain text row's content);
- captured terminal outcome and safe optional explanation where canonical conversion lost that fact.

Reuse that messageId as the batch identity; no separate commitId, duplicate Run lineage, raw input,
copied transcript, provider metadata or alternate content authority. Names already preserved on A2
tool parts stay there. Validate part references against the row and joined batch, including item
kind/order and canonical tool identity. Invalid headers are omitted; independently valid headers with
bad reference maps retain empty references so complete-batch handoff and canonical content remain
readable. Producer preparation remains strict. Replay and Compaction source digest select
only the same canonical fields as before. Add explicit metadata-only equivalence regressions.

Capture completed step response messages in `onStepEnd` before a later error can discard them. Its
installed SDK contract is per-step. Persist each completed step once, followed by actual current
partial text on exceptional ending. Do not combine cumulative and per-step arrays twice. Preserve
all legitimately produced canonical results; never synthesize successful output or a guessed result
for an unfinished invocation. Unknown interrupted state can remain presentation-only when there is
no valid canonical result to reference.

Prepare/validate a turn batch, write all rows in one existing Database transaction, then publish.
Keep legacy individual appended notifications after the transaction and add `timeline.committed`
with Character/message identity, the complete entries and covered activity sequence for new clients.
An empty batch is valid for a turn with no persistable response; it does not create a blank Assistant
message. Transaction failure publishes no partial entries and reports the existing safe failure.
Finalize activity/persistence in a deterministic order; retired producer callbacks cannot append
events to a completed batch or reopen a newer turn.

New reducers buffer ordinary appends belonging to the active batch. The batch notification installs
all durable entries, reuses visible item keys and retires covered live state in one update. It does
not clear on the first assistant row or solely on chat.complete. History carries the same metadata,
so a lost batch push is recoverable: fetch the necessary older pages until the indicated batch is
complete before retiring its live projection. Saved pending-turn anchors and prior canonical coverage
also recover a batch wholly absent from the newest page; retain a reachable cursor for a missing
middle range. Preserve unrelated history and the reading anchor.

Old rows without metadata retain their canonical order. Pair call/result records conservatively
inside their sequential history scope; keep one visible invocation entry where pairing is proved.
An orphan historical call never spins as active. An MCP content output without captured outcome
shows an honest result/unknown state, rather than assumed success.

## 5. Chat rendering and useful details

Project persisted and active data through one ordered view model with stable item keys. Language and
one compact tool entry per invocation appear in actual order. Phase/outcome updates replace that
entry in place, and terminal tools remain in Chat. Default details are collapsed and reversible.

Render useful actual result text/content or structured business values after unwrapping the canonical
tool-output envelope. Do not show JSON-RPC IDs, revisions/generations, empty argument placeholders,
or incidental SDK metadata. Existing raw-input omission is unchanged. Unknown tools can still show
real returned business content; do not strip meaningful user data merely because it contains a
word such as version. Absent details produce no empty disclosure. Keep markup literal/default-safe.

Preserve current scroll-follow discipline: reading older content or selecting text pauses follow;
new content does not steal focus or remount history. Text coalescing keys include generation/message/
segment, and tool boundaries, terminal events, commits and disposal flush or cancel it correctly.
The live-to-durable transition cannot replay entrance animations or flash duplicate cards.

## 6. Pet segment and motion design

Pet consumes the same ordered activity model but filters its final presentation differently:
language A -> transient tool 1 -> independent language B -> transient tool 2 -> turn end leaves A/B.
Multiple/concurrent tools have distinct rows and true state. The next language segment retires earlier
transient tool rows; turn end retires any remaining ones. Completion stops the running indicator even
if the row stays until that boundary. Late results update records without redisplaying retired bubbles.

On terminal error with no later language, retain earlier language and show one message-only error
bubble without a button. Use the safe Core turn-terminal message, or a recorded unhandled tool failure
when no turn message exists. Do not duplicate the explanation per failed tool or invent error causes.

Apply the detailed motion source: top-anchored transcript, stable composer/native frame, internal
scrolling, ~150 ms entrance, ~120 ms content exit and ~200 ms occupied-space transition. At a tool-to-
language handoff, use overlapping fades inside one measured occupancy envelope; do not collapse to
zero and expand again. Text/tool nodes keep distinct semantic IDs. Include row spacing in release.

Use CSS transitions/keyframes with finite local presence bookkeeping and bounded natural-size
measurement. No animation dependency, JavaScript animation timers, per-frame measurement loop or
delayed ingestion. Retarget an interrupted transition from current geometry. Hidden/disposed/replaced
views cancel stale work; reduced or zero motion settles without requiring transitionend. Retired
visual nodes cannot focus, announce twice or intercept clicks. Transparent reserved Pet geometry
remains click-through under the existing hit-test contract.

## 7. Delivery, gates and rollback

Implement in source/transport/persistence, Chat and Pet slices, reusing the same actor and reducers.
One combined independent `gpt-6-astra/xhigh` review covers the final streaming/persistence/interaction
contract; main reviews simple cosmetic follow-ups. The implementation uses `gpt-6-astra/high` and
does not recursively delegate. All semantic discovery uses jbcontext, never YCE.

Required evidence: ordered/concurrent/late events, known failure/preliminary normalization, completed
steps before exceptions, transaction rollback, complete/history/commit permutations, partial-batch
paging, authorized two-window fan-out, snapshot races/caps, identity-safe reconnect and cancellation,
canonical replay/digest parity, and Pet reduced-motion/visibility cleanup. Follow with relevant
Shared/Core/Desktop suites, typecheck/lint/build and actual WebView2 geometry/interaction checks.
No owner inspection, real provider cost, or animation continuity is inferred from a static screenshot.

Deployment is the normal coordinated Core/desktop build plus an additive nullable migration. A
client lacking new messages still receives compatible old Timeline appends. Rollback must retain
the additive column/data and existing canonical fields; do not delete presentation data or revert
unrelated D64/D68 work. No new configuration, external dependency or paid-service requirement.
