# D68-B query, request identity and producer preflight

Read-only findings supplied by the bounded D68 explorer on 2026-09-06, against T4 checkpoint
`a771496`. Two jbcontext queries were followed by current source reads; no code or task pointer was
changed and no tests were run. Main adopts the decisions below for the approved DSH UI port.

## Exact request and invocation identity

The installed `ai@7.0.17` generates `callId` once in
`packages/core/node_modules/ai/src/generate-text/stream-text.ts:1534`, then reuses it for each model
request and tool execution. It is generation identity, not a model-request identity. Model `effectId`
identifies one real request; a tool's `effectId` identifies its own Effect and is not its parent model.

Current `run-event-schema.ts:127` retains model/tool identities, but
`observability-query-service.ts:149` drops them in `projectEvent`. Add optional machine-only
`eventKind`, `effectId`, `callId`, `toolCallId` and `modelEffectId` to the trajectory projection.
Tool observations additionally retain producer-captured `displayName` and exact `modelEffectId`
when available. Any stable invocation identity needed to disambiguate repeated tool IDs comes from
the same producer snapshot, never UI reconstruction.

Group model/usage by exact model Effect. Pair tools only through confirmed invocation identity;
when available, `(modelEffectId, toolCallId)` identifies that request's tool. Legacy, conflicting,
start-only or partially loaded facts remain independent. Do not group by Attempt, nearby time,
translated label, tool name, or generation `callId`. Internal IDs remain absent from rendered text,
tooltips, accessibility names and copy actions.

`run-observability-telemetry.ts:114` already binds middleware Effects to pending SDK starts. Replace
the generation-keyed overwrite map with immutable per-request observations keyed by Effect and a
generation's unfinished candidates. First-output/failure use the exact middleware binding. At SDK
model end, associate only a unique unfinished candidate for that generation; remove that exact
record. Missing or conflicting candidates do not acquire guessed relationships.

The installed SDK supports an object bridge:

- `stream-language-model-call.ts:624` enqueues the same normalized tool-call object placed into
  `modelCallContent`.
- At `:588`, model-end telemetry completes before `model-call-end` is emitted.
- `execute-tools-from-stream.ts:198` executes those saved objects afterward.
- `execute-tool-call.ts:98,114,177,207` retains the same object for start and terminal callbacks.

A per-attempt WeakMap may associate that object with an immutable invocation snapshot containing
only IDs, captured name and observed state. It must not copy/serialize raw inputs. Start and result
use that same snapshot; a late result never looks up the newest generation mapping. Same-request
duplicates are idempotent; another request reusing `toolCallId` is a distinct invocation. An optional
IDs-only middleware observation before forwarding a tool-call can establish a unique early binding;
ambiguous stream-only observations remain unassociated.

## Real phases, outcomes and captured names

The parallel live-feedback source study found:

- Public `tool-call` arrives before execution. `execute-tools-from-stream.ts:87` forwards it and
  queues local work until model-call-end; it is not an executing signal.
- SDK `onToolExecutionStart` enters the tool wrapper; `governed-tool.ts:105` can subsequently wait
  for Approval before the underlying dispatch at `:197`. Do not label this as confirmed OS execution.
- Current `tool-observability.ts:90` incorrectly treats receipt as running; its stream-result fallback
  also fails to exclude `preliminary`. Correct these semantics in the D68 adapter.
- MCP `isError: true` is an actual failure even when `ok` is absent. The installed MCP client returns
  that raw tool result, but its model-output conversion later removes `isError` from content output.

Normalize known tool outcomes once before conversion, using the source result and actual invocation
snapshot. A preliminary result never settles. Reuse this pure classification/snapshot seam in the
later live-feedback slice; Monitor events are observations, never execution or UI-stream authority.
Retain unknown/processing semantics when actual execution is not proved. Do not introduce D77's
broader error taxonomy or expose arbitrary exception messages.

A2 already captures `attempt.toolDisplayNames` at `chat-agent.ts:192`. Pass it through the current
observability session construction at `:237`. Use Shared own-key lookup and bounded display helpers
from `tool-presentation.ts:35`; capture the name once and persist optional `displayName` (240 UTF-16
units) on tool facts. The old 120-unit trajectory label is not a replacement for that field. Legacy
records use their stored label, a fixed known-tool name or generic Chinese text, never a live catalog.

## Bounded pages, summary and Inspector

`observability-query-service.ts:39-50` currently loads every event for both trajectory and Inspector.
Add `RunEventRepo.page` and exact `get(runId, eventId)` using the existing `(run_id, seq)` index;
no migration or new ledger is needed. Keep current forward `afterSeq` and limit 1..200; add:

```typescript
// Additional trajectory request fields.
tail?: true;
beforeSeq?: number; // exclusive, positive
// Additional response fields; new Core supplies hasOlder.
hasOlder?: boolean;
olderCursor?: { runKey: string; seq: number };
```

`tail` and `beforeSeq` are mutually exclusive and reject nonzero `afterSeq`. Forward queries use
ascending `limit + 1`; backward queries use descending `limit + 1`, trim, then return ascending rows.
The response cursor denotes the newest returned position; only forward mode retains `hasMore` for
forward continuation. Backward continuation uses `hasOlder` and the oldest returned sequence.
`beforeSeq=1` is a valid empty earlier page. Validate stale/out-of-range cursors after Character/Run
authorization. Preserve existing unknown-Run and disabled-mode rejection.

`buildSummary:102` also materializes all events. Replace that with SQL aggregates over the existing
validated Run/Event/Effect tables, retaining the exact current summary meaning. `sumComplete`
semantics are mandatory: an unknown constituent keeps its bucket unknown. No observed constituents
and observed zero are different cases. A synchronous read must keep summary, tail and page consistent.

Inspector uses exact event lookup and the existing semantic whitelist. Stop generating technical
fields; retain `technical: []` and `technicalCollapsed: true` on the wire for old consumers if useful.
Add optional typed semantic section keys (`event`, `model`, `tool`, `usage`, `context`, `governance`,
`recovery`) rather than parsing Chinese labels. Render only sections backed by useful fields. There
is no approved producer for raw prompt, full tool input/output/definition or diff tabs; do not borrow
Timeline/Host data or show generic JSON dumps to fill them. All Monitor modes retain their privacy gate.

## Controller correctness and recovery

- Keep `selectedRunKey` independent of the newest 25 Run summaries. Restore it through an authorized
  tail query; ordinary network failure preserves the stale view, while true unavailable/forbidden
  responses clear inaccessible content.
- Keep `liveCursor` separate from `olderCursor`. Prepending a before-page never rewinds live state.
  Reconnect drains bounded forward pages before subscribing, deduplicating each real event.
- A committed live event invalidates the selected summary. Reuse a tail query with `limit: 1` and
  take only its `run`; preserve loaded rows, history cursor and reading anchor. Coalesce one in-flight
  refresh plus one trailing dirty refresh. Check generation, Character, Run and selection epoch.
- Give Inspector its own request epoch. Replacing/closing the selection invalidates both success and
  failure callbacks and clears pending state; closing Run A's row cannot be undone by its late reply.
- Preserve the existing subscription authorization and overflow contract. The current bus defaults
  to 128 records and `main.ts:124` uses unbounded list backfill; bound that path and prove recovery
  beyond 328 missed records without silent gaps, cursor jumps or endless overflow loops.

## D75 decision: remain deferred

The current quality gate calculates source/summary token estimates in `summary-quality.ts:25`, with
the correct rolling-summary denominator in `compaction-policy.ts:37`. They are heuristic estimates
from `token-estimator.ts`, not provider-exact tokenizer measurements. `compaction-coordinator.ts:197`
persists output characters but not those token counts. Full-request/reduction measurements live in
the Character-level in-memory map wired at `main.ts:143`; they are not replayable request evidence.
Existing `beforeTokens` and logged after-history estimates have different scopes and cannot be divided.

D75 therefore remains open for a dedicated producer/persistence/measurement-quality slice. It would
require migration, operation/event fields, same-scope capture, retry/CAS coverage and privacy review.
D68-B exposes existing real usage/cache/timing; it does not invent compression-benefit values or use
character ratios. D77 remains deferred as already decided.

## Required regressions

- Same generation callId across two model Effects; failed request then retry; repeated toolCallId in
  distinct requests; late result snapshot; duplicate callbacks; absent/conflicting association.
- Actual receipt/wrapper/dispatch distinction, preliminary then terminal, `ok:false`, MCP `isError:true`.
- Captured name after catalog replacement, 240-unit labels, invalid/legacy fallback and unchanged routing.
- Legacy forward queries; mutually exclusive parameters; 0/1/200/201 records; before=1; authorization;
  concurrent tail append plus prepend; exact Inspector lookup; aggregate parity with unknown buckets.
- Older selected Run, summary refresh coalescing, more than 328 missed events, old generation,
  Inspector A/B reverse completion and close-before-success/error.
- No internal fields in any mode or UI disclosure; no raw content or fabricated details/metrics.

Current Core tests require an Event ID field in Inspector (`observability-query-service.test.ts:75`).
Replace that obsolete assertion with the owner-approved absence contract. Real-window interaction
and DSH reference comparison are separate from this source study.
