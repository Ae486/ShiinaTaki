# Foreground Chat activity and atomic Timeline handoff

This contract joins truthful Core tool facts, disposable Chat/Pet views and the existing canonical Timeline.
The live-feedback task owns implementation and acceptance; the contract adds no execution authority.

## 1. Scope / Trigger

Read before changing `chat.activity`, activity recovery, foreground turn persistence, optional Timeline
presentation, or the Chat/Pet live-to-history handoff. Preserve the D64 approval, D68 invocation/outcome,
Memory, Compaction and Run admission contracts. Proactive/Heartbeat delivery is outside this surface.

## 2. Signatures

Shared schema files are the sole wire authority:

- `chat-activity-schema.ts`: `ChatActivitySchema`, `ChatActivityReadParamsSchema`,
  `ChatActivityReadResultSchema`, item/phase/outcome types and snapshot bounds.
- `timeline-presentation-schema.ts`: `TimelinePresentationSchema`, text/tool references and
  strict producer `validTimelinePresentation(candidate, canonicalRow)`, read-side
  `readTimelinePresentation(candidate, canonicalRow)` and joined-row `sanitizeTimelinePresentations(entries)`.
- `timeline-schema.ts`: optional `TimelineEntry.presentation` and `TimelineCommittedSchema`.
- `CHAT_METHODS.activity = "chat.activity"`, `CHAT_METHODS.activityRead = "chat.activity.read"`,
  `TIMELINE_METHODS.committed = "timeline.committed"`. All are operator-only; no Rust mirror is required.

Activity envelopes carry `characterId`, accepted `chat.send` `messageId`, positive monotonic `seq`,
and optional actual `runId`/`attemptId`. Item identity is `itemId` plus zero-based `order`. The accepted
message identity is also the final batch identity; it is not a persisted row's `id` or Timeline `seq`.

| Event kind | Additional fields |
| --- | --- |
| `turn.started` | None |
| `text.delta` | `itemId`, `order`, non-empty `delta` |
| `tool.received` | `itemId`, `order`, canonical `toolCallId`/`toolName`, optional captured `displayName` |
| `tool.phase` | Existing `itemId`, `phase` |
| `tool.terminal` | Existing `itemId`, `outcome`, optional safe `message`/observed `durationMs` |
| `turn.terminal` | `outcome`, optional safe `message` |

Phases are `received`, `processing`, `approval`, `executing`; terminal outcomes are `completed`,
`failed`, `cancelled`, `outcome_unknown`. Tool status becomes `phase: "settled"` with its outcome.
Safe activity messages have a 240 UTF-16-unit maximum; they are not raw exceptions or tool payloads.

`chat.activity.read({characterId})` returns `idle`, `active` with items, `terminal` with items/outcome,
or `unavailable` with `reason: "capacity"`, current identity/sequence and optional terminal summary.
Snapshots allow at most 512 items and 1,048,576 UTF-8 bytes of display text, labels and safe messages.

Presentation metadata is `schemaVersion: "timeline-presentation.v1"`, `messageId`, `entryIndex`,
`entryCount`, `activitySeq` and `references`. Text references select a non-overlapping UTF-16
`[start,end)` in a canonical text part, or in `content` only when there are no parts. Tool references
select the canonical call/result `partIndex` and may retain the observed outcome/message/duration.
`timeline.committed` contains `characterId`, `messageId`, `activitySeq` and the complete ordered `entries`.

## 3. Contracts

### Producer and recovery lifetime

- Only the Character queue owner calls `ChatActivityProjection.start(identity)`, immediately before
  `turn.started`. A newly admitted but queued message cannot replace the currently executing snapshot.
- Keep the latest started foreground turn per Character, including its terminal snapshot. Dispose with
  the Core runtime; closing an observing view never cancels the turn. Existing explicit cancellation
  and initiating-connection-loss behavior remain unchanged.
- Public SDK stream order controls text and tool receipt. Flush earlier text at each tool-call boundary;
  later text starts a new stable segment. Buffer early wrapper/phase/result callbacks until receipt.
- Use D68's actual request/SDK-object invocation bridge. A reused SDK `toolCallId` is not enough to
  merge invocations. Capture readable names from the same immutable tool snapshot as A2.
- Receipt proves receipt; wrapper entry proves processing; an actual unresolved durable Approval proves
  waiting for confirmation; only underlying dispatch proves executing. No timer infers an execution phase.
- Preliminary results do not settle. Classify structured failure, MCP `isError`, execution denial,
  cancellation and unknown outcome before SDK/model-output conversion loses those facts. Preserve the
  original canonical output; observation errors cannot suppress execution or retry it.
- Sequence and item identity survive attempts within the accepted message. Stale/terminal callbacks
  cannot revive an older projection. Snapshot overflow discards recoverable items permanently for that
  message and reports unavailable; later deltas cannot reconstruct a misleading suffix. Canonical
  persistence is independent of the disposable snapshot budget.
- Fan out through existing Character subscriptions and include the initiator exactly once. Every new
  physical connection authenticates and restores membership. A role/Character mismatch receives no data.

### Durable turn and handoff

- Capture each completed SDK step before a later provider error; preserve useful current partial text
  once. Normal, exceptional, cancellation and iterator-close paths converge on one commit guard.
  `onStepEnd` may precede consumption of public `finish-step`; identify whether partial text's exact
  step was already captured. Equal language from different steps is not a reason to deduplicate it.
- Historical T4 migration 035 adds nullable `timeline_messages.presentation` after unchanged migrations 001-034.
  The combined forward registry uses main Pending Memory 035 and existing 036 convergence through 048;
  applied receipts and both original 035 modules remain unchanged.
  Metadata references existing canonical content; it stores no second transcript, output or Run ledger.
- Prepare/validate the full turn, insert it in one synchronous DB transaction, then publish legacy
  appends and one complete batch. Rollback publishes nothing. Empty batches create no blank row.
- Invalid batch headers are omitted on read. If the header independently validates but its references
  do not, retain the header with an empty reference list so a complete canonical batch can still retire
  its live view. Producers remain strict; read-side degradation does not permit malformed writes.
- Check item kind/order, exclusive order ownership, text spans and canonical tool identity within a
  row and across joined batch/history pages. Legitimate multi-span text and one call/result pair can
  share an item ID. Conflicting or partially referenced tool maps fall back to the canonical projection
  for the batch; they must not overwrite or hide valid tool content.
- Metadata-only changes must preserve replay and Compaction source digests. Do not weaken conservative
  handling of ambiguous legacy canonical call IDs to make a presentation test pass.
- A client buffers partial batch appends and applies a validated complete batch atomically. Keep the
  same stable text/tool objects during handoff; the first appended row or legacy `chat.complete` cannot
  clear all activity. Missing commits recover through complete paged history metadata, not a resend.
- A pending batch may be wholly absent from the newest history page. Saved turn anchors and the
  pre-reconnect canonical tail bound catch-up; the mere absence of a partial batch is not proof that
  recovery is complete. Keep a reachable gap cursor when newest-page coverage is disjoint from cache,
  and stop on exhausted/empty/non-advancing cursors or a retired client generation.
- Keep exact acknowledgement/accepted message identity, physical client generation and Character when
  settling the initiating request. Early notifications and late old-client responses cannot clear a
  newer draft/turn. Shared activity is a read view, not the initiating request's completion authority.
- Reconnection performs reads/subscriptions only. Preserve last visible content with truthful stale or
  unavailable state while recovering; neither state claims tool success or authorizes a retry.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Wrapper/result callback precedes public tool receipt | Buffer it; earlier language remains before the tool. |
| Concurrent results return in reverse order | Update exact invocation objects; keep receipt/text order. |
| Known failed or preliminary MCP output | Failed terminal or still active as appropriate; never false success. |
| Second message is acknowledged while first is executing | First projection and terminal publication remain complete. |
| Later provider step fails | Prior completed text/tool rows and current useful partial persist once. |
| SDK callback captured a step before the public finish chunk | Iterator close never appends that same step's partial again. |
| Any batch row insert fails | Roll back every row; emit no append or commit. |
| Snapshot capacity is exceeded | Explicit unavailable; no truncated complete reply or suffix recovery. |
| History page includes only part of a batch | Load the remaining pages before treating it as a completed replacement. |
| The pending batch is absent behind later turns | Catch up to its saved anchor/known coverage and keep missing ranges reachable. |
| Optional references conflict but the batch header validates | Discard the reference map, keep complete-batch coverage and canonical readable content. |
| Commit/read/push races or duplicate events | Deduplicate by actual identity/sequence; no double entry or execution. |
| Old connection/Character/message callback arrives | Ignore it for the current view/request; never reopen a closed bubble. |

## 5. Good / Base / Bad Cases

- Good: A, tool 1, B, tool 2 remain stable ordered objects; outcomes update in place and the complete
  canonical batch adds useful details without replaying entrances or breaking text selection.
- Base: old rows without presentation remain readable and retain conservative canonical tool pairing.
- Bad: infer executing from receipt, treat a call's mere presence as success, pair repeated IDs across
  requests, clear live content at the first appended row, or resend a mutation during recovery.

## 6. Tests Required

- Shared: strict event/snapshot/batch shapes, optional legacy metadata, reference/span validation,
  row/cross-page identity/order/tool-reference conflicts, valid-header fallback and UTF-8 bounds including split surrogate pairs.
- Core: actual SDK callback/receipt ordering, concurrent/reused IDs, preliminary/failed MCP output,
  queue ownership, completed-step exceptions, transaction rollback, metadata-only replay/digest parity,
  migration lineage/reopen and role/Character/observer isolation.
- Desktop: acknowledgement and generation races, subscribe/read/push/commit permutations, partial
  history pages and wholly absent older batches, unavailable snapshots, late callbacks, two observers and no mutation replay.
- Native acceptance: actual Core/SDK/SQLite process scenarios plus real WebView2 geometry/identity,
  focus/selection/scroll and reconnect checks. Label synthetic model/UI data and owner inspection
  separately. Unit tests or screenshots alone do not prove animation continuity.

## 7. Wrong vs Correct

```ts
// Wrong: admission is not ownership of the currently executing Character projection.
const admitted = await runs.admit(request, interactive);
activityProjection.start(admittedIdentity);

// Correct: projection replacement follows actual queue acquisition.
const release = await queue.acquire(characterId);
activityProjection.start(identity);
activity.start();
// Existing turn execution and finally/release follow.
```

For visibility, reading anchors and motion, follow the
[frontend foreground-feedback contract](../frontend/foreground-chat-feedback.md). For process teardown,
follow [accepted connection cleanup](server-push-and-connection-auth.md#scenario-core-shutdown-drains-accepted-connections-before-storage).

## Combined canonical Memory source witness

The turn recording guard returns the exact rows from the atomic writer. Primary ingestion receives that
batch plus the exact committed user row after commit, including useful exceptional and iterator-close partials.
It receives no retracted row, unrelated interleaved row, automatic Recall fragment or non-primary turn.
The captured Memory assembly/tools/Recall bundle and tool-display-name map coexist; automatic Recall
remains primary-only and is reused across the one clean overflow retry.
