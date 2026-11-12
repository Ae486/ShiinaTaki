# Live feedback producer and persistence contract preflight

Read-only source study returned on 2026-09-06 at T4 checkpoint `a771496`, coordinated with D68's
request-identity research. No production files or task pointers were changed and no tests were run.
The design document records main's final choices where they narrow the research proposals.

Implementation clarification, 2026-09-07: Core can acknowledge another Run while the current
Character turn still owns the execution queue. The bounded recovery projection therefore tracks the
latest **started** foreground turn, switching at queue acquisition rather than mere admission.
This preserves the current turn's remaining events and terminal publication. Admission/queue/cancel
policy is unchanged. The source-backed two-sender regression and native reproduction are recorded
in the implementation evidence; current design.md supersedes the earlier admission wording below.

## Source facts that change the implementation

| Source | Verified consequence |
| --- | --- |
| Installed `ai@7.0.17`, `execute-tools-from-stream.ts:87-124,198-237` | A normalized tool call is forwarded immediately, then local calls wait until model-call-end before concurrent execution. Receipt is not execution. |
| `execute-tool-call.ts:114` | SDK execution-start precedes the tool wrapper. Start/end callbacks share the same normalized tool-call object. |
| `governed-tool.ts:105,197` | That wrapper can wait for Approval before the underlying dispatch. Do not call wrapper entry confirmed OS execution. |
| `tool-observability.ts:90-101` | Existing receipt-as-running and preliminary-result settlement are wrong for live presentation. D68 corrects this shared observation seam first. |
| Installed MCP `mcp-client.ts:861` and `:147-176` | Raw MCP `isError:true` survives execute, but model-output conversion to `{type:"content",value:...}` drops it. Capture outcome before conversion. |
| `chat-agent.ts:286` | Core reads all SDK stream parts but currently yields only text. |
| `chat-agent.ts:439-450` | Thrown ending can bypass completed responseMessages and persist only pendingStepText, losing earlier completed steps. |
| Installed `stream-text.ts:1272-1308` | `onStepEnd(event.response.messages)` contains the completed step's messages, not the whole accumulated response. |
| `conversation-store.ts:143` | appendTurn currently appends and publishes each row individually; no atomic batch handoff exists. |
| `chat-send.ts:144-163` and `timeline-subscriptions.ts:44-47` | chat.* currently targets only the initiating socket, while Timeline fan-out is Character-scoped. Adding a callback alone cannot update both windows. |
| `ws-client.ts:264`, `ws-client-routes.ts:106` | Current send acknowledgement identity is dropped; completion/error are not fully checked against the active messageId. |
| `chat-timeline-store.ts:125-129` | Any assistant append currently clears in-flight state; this would remove the whole live turn on its first persisted row. |
| `chat-delta-coalescer.ts:17` | Only messageId keys buffered text; segmented streams need generation and segment identity too. |
| `chat-bubble-store.ts:12`, `use-chat-bubble.ts:23` | Pet has one reply string and asynchronous presentation-gate callbacks requiring current-identity guards. |

## Shared producer identity

Reuse D68's per-attempt immutable invocation snapshot and pure outcome classifier. Its request ID is
the exact model Effect, not SDK generation callId. The installed SDK's model-end/start/end object
bridge and unique request candidate rules are documented in the D68 query preflight. Never use
Monitor events as an execution authority or a replay mechanism.

Assign a stable Core invocationId and segmentId for UI identity. Include actual Run/Attempt IDs when
available; do not invent a Run for a legacy direct ChatAgent caller. Names come from the same A2
captured Run map with own-key lookup and 240-unit validation. Callback updates use the original
invocation snapshot, including when a later request reuses toolCallId.

The public stream defines text/call order. A tool boundary flushes pending text and closes that text
segment. Subsequent text gets a distinct segment. Execution callbacks may arrive before the public
call is consumed, so buffer state by identity until its ordered receipt exists; do not insert a tool
ahead of preceding language. Preliminary results cannot settle. Known denial, cancellation,
`ok:false`, MCP `isError:true` and tool-error are normalized before conversion; unknown remains unknown.

Actual underlying execution may be known later than SDK wrapper entry. Emit waiting/approval/work
phases only from the matching production boundary. Avoid frontend timers that infer tool execution.
Do not copy arguments, raw result objects or exceptions into activity events.

## Character fan-out and disposable recovery

Main selected Character subscription fan-out through the existing authorized Timeline subscription
registry, deduplicating the initiating connection. Initiator-only chat RPC completion, draft restore
and legacy chat.complete/error behavior remain. Observing another window's activity never opens Pet.

A read-only active-turn snapshot is necessary for reconnect or reopening an existing bubble:
register handlers, subscribe, read the snapshot, buffer concurrent activity, install the snapshot,
then apply only later sequence numbers. Never resend chat.send to restore display state.

The projection is process-local, disposable and bounded, with one admitted foreground turn per
Character. It is neither durable transcript nor another Run authority. Main selected a 512-item /
1 MiB UTF-8 text snapshot budget, counted incrementally; over-capacity returns explicit unavailable,
not a truncated complete snapshot. Existing canonical history is unaffected. An incomplete consumer
waits for/refetches durable history instead of displaying a suffix as the whole response. Buffer
overflow causes read-only resynchronization, never tool execution. Retirement is identity-guarded.

## Durable outcomes and atomic handoff

MCP failure cannot be reliably recovered from historical `content` output. Retain normalized terminal
outcome as optional Timeline presentation metadata, captured before conversion. Keep canonical
parts/content/output unchanged. Main chose a nullable presentation JSON column in the existing
Timeline table, rather than another ledger or changing plain-string replay into text-part replay.

Main narrows the research's larger metadata proposal: reuse the accepted chat messageId as the batch
identity; do not add a second commitId or duplicate Run metadata/content. Store row index/count,
covered activity sequence and references from canonical text/tool parts to stable item identities,
order and optional observed outcome. Presentation data must never enter canonical replay or source
digest. Corrupt optional display metadata is omitted without losing valid canonical history.

Capture each completed step before later stream failure. Normal and exceptional endings use that
completed material exactly once, plus actual current partial text. Never synthesize a successful
tool result or guessed output for an unfinished invocation. Interrupted tool state may remain
presentation-only and unknown where canonical result content was never produced.

Batch persistence uses the existing single Database transaction: validate/prepare, write all rows,
commit, then notify. Preserve legacy individual append notifications after commit and add a typed
batch notification for new clients. The reducer installs the batch and retires its covered live
items in one update, using the same visible item keys. A failed transaction publishes nothing.

History carries the same optional metadata, so a missed batch push is recoverable. A partial history
page is not a complete batch; fetch the needed pages before retiring its live content. Old history
without metadata retains canonical order. Pair tool calls/results conservatively in their sequential
scope; an orphan call is not running, and historical MCP content is not proof of success.

## Desktop and motion contract

Chat interleaves one compact row per invocation with text and updates its phase/outcome in place.
Terminal tool entries remain. Details are collapsed and show useful actual result content, without
the JSON-RPC wrapper, IDs, generations, empty input placeholders or arbitrary internal metadata.
Current raw-input omission is preserved. Displaying useful tool-produced business content is not
permission to expose hidden pending inputs or unrelated internal telemetry.

Pet retains separate language A/B segments. Consecutive or concurrent tools keep their own identity
and real state; all transient tools before a new language segment retire at that boundary, or at
turn end. Late results never make a retired bubble reappear. Terminal error without later language
uses one message-only error bubble, keeping earlier language. Core turn-terminal safe message is
preferred; D77 still owns broader error-taxonomy repair.

The existing motion document defines top-anchored layout, tool-to-text overlapping handoff, measured
occupied-space release, stable composer, CSS-driven transitions, reduced motion, reading anchors
and stale-callback cleanup. Do not replace it with an animation library or a timer-backed queue.

## Required regression set

- Text A / two received calls / concurrent execution / reverse completion / text B; truthful order
  and phase; callback-before-receipt; reused IDs in later requests; duplicate notifications.
- Preliminary then failure; MCP isError before/after conversion; late result preserves snapshot.
- Completed A/tool/B followed by provider failure; cancellation during Approval; unknown outcome;
  no loss or duplicate persistence of completed steps and no guessed successful result.
- Atomic transaction rollback; batch/complete/history delivery permutations; partial batch paging;
  canonical replay and old Compaction digest remain byte-equivalent when only metadata changes.
- Snapshot read racing live pushes; overflow/unavailable; reconnect; old generation/messageId/attempt;
  delayed coalescer flush; late async presentation gate after close/Character/client replacement.
- Two authorized windows see the same active turn without duplicate initiator events or auto-opening
  Pet; another Character and unauthenticated clients cannot read or subscribe to its activity.
- Actual WebView2 geometry for tool-to-text and tail removal, scroll-up/follow, interruption, hidden
  window and reduced motion. Static screenshots or jsdom alone do not prove motion continuity.

Related source: [D68 request bridge](../../08-28-dsh-observability-expansion/research/d68-query-contract-2026-09-06.md),
[shared names](../../../spec/backend/operation-presentation.md), and
[motion design](../../08-22-t4-agent-architecture-observability/research/uiux-motion-continuity-2026-09-05.md).
