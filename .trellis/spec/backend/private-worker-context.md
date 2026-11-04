# Private worker context and SDK segmentation

## 1. Scope / Trigger

Apply when changing private child replay, summary storage, actual-input receipts, exact-history retrieval or
same-Attempt SDK segmentation. The production owners are `agents/agent-attempt.ts`, `run-message-store.ts`,
`private-task-context.ts`, `private-task-summarizer.ts`, `worker-sdk-segment.ts`, `subagent-self-history-tool.ts`,
`db/subagent-context-summary-repo.ts`, `db/subagent-tool-result-repo.ts` and `harness/subagent-tool-materials.ts`.

This applies only to `WorkContext.scope.kind === "subagent"`. Primary, parent-continuation and inbox-handler step
policies remain finite and unchanged. Private work never invokes Character compaction, automatic relationship Memory
ingestion or public Timeline writes. See [shared delegation](shared-agent-delegation.md) for control/recovery authority
and [agent runtime](agent-runtime.md) for complete native recording and foreground privacy.

## 2. Signatures

The shared `WorkContext` adds these request/checkpoint contracts:

```ts
interface WorkContextEnvelope {
  instructions: string;
  toolSchemaTokens: number;
  maxInputTokens: number;
  signal?: AbortSignal;
}
interface PreparedWorkStep {
  messages: ModelMessage[];
  attemptId: string;
  stepNumber: number;
  inputIds: readonly string[];
  pendingThroughWorkSeq?: number;
  token?: SubagentWorkToken;
  summary?: SubagentContextSummaryWitness;
}
type WorkSegmentCheckpoint = { kind: "continue" } | {
  kind: "context_rollover";
  messages: ModelMessage[];
  summary?: SubagentContextSummaryWitness;
};
```

- `prepareStep({ messages, attemptId, stepNumber, envelope? })` is awaitable and consumes no input.
- `commitModelInput(prepared, effect)` executes inside the actual model Effect intent transaction.
- `checkpointSegment({ attemptId, stepNumber, retainedBytes, safeToRollover, envelope? })` decides whether to stop
  only the current SDK call after completed evidence is durable.
- `SubagentContextSummaryWitness` is Shared-defined: `workInputId`, `revision`, `throughSeq`, `sourceDigest`.
- Summary repository `capture({ subagentId, workInputId, throughSeq })` binds previous revision and canonical source
  digest. `commit({ range, text, runId, attemptId, token, validateCurrent })` performs the transactional owner/source CAS.
- `subagent_context_summaries` stores immutable text/coverage/revisions; `subagent_context_summary_intents` links actual
  task model Effects to a summary witness; `subagent_context_summary_failures` suppresses a repeated unchanged range.
- `subagent_tool_results` keys full raw output by Run/Attempt/global step/tool-call ID. SDK `toModelOutput` may compact
  provider replay but cannot replace these exact original bytes.
- Native image replay accepts the same optional `ImageReplayReader` through Subagent dependencies and RunMessageStore.
  Image refs use the Shared Timeline tool-result contract; ephemeral native sidecars remain Attempt-local.

## 3. Contracts

- Private DB-backed replay follows [Native Image Input](native-image-input.md), including initial snapshots, later
  Runs, tail selection and shrink/summary accounting. Hydrate and price retained image refs through the same reader
  snapshot before deciding fit; do not reconstruct tool images as text merely because SDK objects were persisted.
  Temporary native sidecars are associated with exact Run/Attempt/step/pair identity, never guessed from arbitrary JSON
  or provider call ID alone. They do not enter SQL. A committed summary releases only the temporary images in its
  retired coverage; a new Attempt drops old temporary state, and outer native lifetime cleanup still runs.
  Utility summarization remains text-only: pixels do not become summary input or a new image-description job.
  Missing/expired or unretained originals stay explicitly unavailable. Ordinary original tool text is preserved;
  supported typed image content is represented by original retained refs rather than inline base64 in tool JSON.
- Explicit SDK `isLoopFinished()` avoids the installed SDK fallback of 20 steps. Do not omit `stopWhen`, raise a total
  cap, or implement rollover as Run retry. SDK-local ordinals map to increasing global Attempt step numbers.
- Price the actual instruction/schema envelope, current input, summary and history together. Use calibrated
  `contextWindowTokens()` and the existing response reserve; the main request policy is unchanged. Current context
  pressure starts at 80% of the message budget. SDK retained material pressure uses actual serialized request/result
  bytes and `max(16_384, historyBudget() * 16)` as a segment boundary, never a task lifetime or total action limit.
- Read pending input pages through one captured `throughWorkSeq`, preserving complete pending-batch validation at intent.
  Every `inputId` receipt must correspond to raw text actually included in that request. Summary-only older inputs receive
  a summary witness instead of a fresh raw receipt. Later arrivals remain outside the earlier capture.
- Preserve complete SDK action rounds. Never project an orphan tool result. Giant current tool outputs may use a bounded
  source-aware projection with an exact retrieval cursor; unfit fixed instructions/current input fail explicitly.
  Preserve each `read_self_history` page and cursor verbatim. If the same tool message contains ordinary results, those
  peers remain independently reducible with their original order, source metadata and exact-history references intact.
- Price retained rounds through the same projection as the request, including summary wrapper, initial snapshot and
  pending inputs. The 40% recent-history target is soft: always protect the newest round, but do not add an optional
  older round if that complete suffix would exceed the budget. Retire eligible older prefixes and remeasure after each
  replacement summary. A shrinking summary is not a guarantee of fit; if no further prefix can retire, an actually
  unfit protected envelope still fails explicitly without truncating evidence or dispatching an oversized request.
- A terminal prior Run's partial or input-only tail may be summarized as immutable historical evidence together with its
  actual `outcome`/`outputKind`; it must not permanently block later conversation compaction. Raw replay labels historical
  partial output as incomplete. The summary source digest includes the canonical execution outcome. A current Run's
  incomplete frontier remains protected, and existing unknown non-model Effect continuation fences still apply.
- Summaries preserve task, constraints, findings, decisions, completed actions, outstanding work, essential references,
  sender/source and negation. This is a generated projection, not user-authored evidence or authority. Utility requests use
  separately governed model Effects and never consume pending task inputs. Read SDK result accessors explicitly: spreading
  `GenerateTextResult` omits prototype-backed `text`/`finishReason`.
- Summary requests carry a prompt-only `targetSummaryTokens`: space within the existing 80% pressure line after pricing
  initial/pending input, retained projected tail and replacement wrapper without the old summary text; if that space is
  nonpositive, use the actual remaining message budget (minimum one). Ask the model to rewrite/consolidate repeated rules
  and tool chronology while retaining distinct facts and sources. This is neither a new product cap nor `maxOutputTokens`.
  Exceeding the prompt target alone does not reject a summary or bypass quality/CAS/full-request remeasurement.
- Commit text, coverage and revision atomically only after raw source persistence, current Run/Attempt/control/source checks,
  quality validation and actual shrinking of the retired model projection. Stop, stale owner/source/revision or SQL failure
  preserves the prior checkpoint. Failed ranges are not retried immediately; raw replay may continue only while it fits,
  with an explicit summary-unavailable notice.
- A safe local frontier contains complete successful or explicit error pairs. Provider-executed, deferred, preliminary,
  unresolved or approval-pending frontiers cannot authorize rollover. Runtime separately refuses unfinished or unknown
  non-model Effects before another task model dispatch. A settled local exception is not automatically an unknown Effect.
  An SDK-invalid local call is safe only with its matching local error, never a successful result. This includes schema
  validation errors that never execute the tool, both at retained-reference rollover and at the N-step check-in boundary.
- Drain the SDK stream before releasing completed recording/activity/material/invocation references. Persist before release;
  no durable material repository means no discard. Empty producer source metadata gets a `result` reference with unknown
  source, so the completed cache entry remains addressable and releasable. Successful disclosure retains only activated names
  across segments, without replaying loaders or retaining their full results.
- SDK 7.0.148 `notify()` swallows exceptions from `onStepEnd`. Core must latch the first completed-step source/material/
  persistence error outside the callback, refuse later prepareStep/model intent/summary/rollover and assert after stream
  drain before settled-text/final success. Do not release undurable references or retry executed tools. Keep already-produced
  public text through the primary writer's existing finally boundary; private action acceptance remains separate from raw
  transcript durability and is not replayed after recording failure.
- `read_self_history` remains intrinsic even under an empty selected action tool set. Its child and Character are captured
  by Core. Requests choose `messages | inputs | results | materials`, `cursor: string | null`, and `limit: 1..20`.
  Responses distinguish `available | empty | invalid_cursor | unavailable | failed`; each record has `id`, JSON-text `body`,
  UTF-16 `offset` and `complete`, plus page `hasMore`/`nextCursor`. Pages have a 3,000-character body budget and preserve
  surrogate pairs. Continue the exact cursor to reconstruct a large record. Numeric categories freeze their traversal
  watermark, so reading history does not chase its own newly recorded tool results forever.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Fixed instruction/schema budget nonpositive or invalid | `SUBAGENT_CONTEXT_FIXED_ENVELOPE_UNFIT`; no task model intent |
| Complete pending batch cannot fit | `SUBAGENT_CONTEXT_PENDING_INPUT_UNFIT`; pending receipts unchanged |
| Newest protected complete round cannot fit | `SUBAGENT_CONTEXT_ROUND_UNFIT`; raw evidence retained |
| Summary unavailable/invalid and raw request no longer fits | `SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE`; truthful unfinished failure |
| Blank/truncated/non-shrinking summary | Reject; preserve previous coverage; at most one attempt per unchanged range identity |
| Summary revision/source/owner changed or database insert failed | Atomic rejection; no coverage-only commit |
| Segment pressure at unsafe SDK frontier | `SUBAGENT_CONTEXT_UNSAFE_FRONTIER`; no reconstructed/replayed tool call |
| Non-model Effect unfinished or outcome unknown | Runtime `SUBAGENT_CONTEXT_UNRESOLVED_EFFECT`; no new task dispatch |
| Cursor belongs to another child/category or mismatched body | `invalid_cursor`; no sibling read or false empty result |
| Missing full-body repository / wrong Character / storage exception | `unavailable` or `failed`, never successful empty history |

## 5. Good / Base / Bad Cases

- Good: a worker passes 20 model steps, receives corrections, summarizes older complete evidence, rolls several SDK calls
  within one Run/Attempt and later continues the same work in a fresh Run using its durable summary and exact recent tail.
- Base: summary generation fails but the raw projection still fits; the worker sees an explicit maintenance failure notice
  and can continue with raw evidence. A later unfit request fails without losing or consuming omitted input.
- Bad: a summary covers pending input before model intent; a fresh receipt claims an input present only in summary text;
  an SDK segment end announces task completion; or a missing retrieval page is returned as an empty successful result.

## 6. Tests Required

- `chat-agent-worker-context.test.ts`: actual ChatAgent/SQLite crosses project and SDK caps, unique global step/material
  keys despite reused provider IDs, one Run/Attempt, exact raw-vs-summary receipts, 205 pending corrections, giant input
  refusal, primary cap preservation, successful loader disclosure, source/CAS/SQL-failure checks, blank/truncated/provider
  summary failures, Stop/correction during generation and safe local-error versus unsafe provider/deferred boundaries.
- `chat-agent-worker-retention.test.ts`: explicit continuation after a committed summary, complete traversal beyond 2,000
  retained records with captured watermarks, and forced-GC reclamation of real SDK raw-result objects across 25 segments
  while exact SQLite bodies remain. Also resume actual user-cancelled Runs with either partial or input-only history,
  cross 35 later tool rounds, and prove cancellation facts/raw evidence remain unchanged while summaries advance.
  Repository-history fixtures are not claims of thousands of simultaneous admissions.
- `worker-sdk-segment.test.ts`: complete success/error pairs and provider/approval/preliminary/mismatch refusal matrix.
- `private-task-context.test.ts`: projected summary/tail fit, oversized optional old rounds, replacement remeasurement,
  initial-snapshot pricing and live-partial/protected-round refusal; repository boundaries are stubbed in this unit suite.
- `chat-agent-worker-invalid-frontier.test.ts`: real SDK invalid-argument round, zero invalid executions, durable error,
  pressure rollover and corrected same-Run completion; invalid arguments exactly at N enter a normal check-in.
- `chat-agent-worker-mixed-history.test.ts`: actual SDK mixed history-page/file results retain exact page and cursor bytes,
  reduce ordinary peer output, continue within the same Run/Attempt and reconstruct the untouched file from raw pages.
- `subagent-tool-materials-retention.test.ts`: unknown-source reference/release and refusal to discard unsaved evidence.
- `chat-agent-step-recording-failure.test.ts`: actual SQLite output/material INSERT failures stop the real SDK before another
  model/tool call; a natural last-step failure suppresses settled text; foreground private-recording failure preserves public
  text and previously committed action receipts while surfacing failure instead of continuing.
- Preserve `tool-disclosure`, `chat-activity`, `chat-agent-overflow`, `subagent-service` and `subagent-materials` regressions.

Run the GC gate explicitly; ordinary tests skip its GC-only case:

```powershell
pnpm --filter @taki/core exec vitest run src/agents/chat-agent-worker-context.test.ts src/agents/chat-agent-worker-retention.test.ts --pool=forks --execArgv=--expose-gc
pnpm --filter @taki/core typecheck
pnpm --filter @taki/shared typecheck
```

These deterministic tests prove SDK/storage/routing behavior. They do not prove semantic summary fidelity with a real model,
native UI acceptance, native Hindsight acceptance or T4/main migration convergence.

## 7. Wrong vs Correct

Wrong: `prepareStep` drops old messages but the same unbounded SDK call and project maps retain every full result; new
calls reuse local step zero and carried input IDs after their raw text has disappeared.

Correct: persist full completed evidence, remeasure a task summary plus exact tail, stop one SDK call at a safe pressure
frontier, drain/release its references, and resume with the same Run/Attempt and increasing task ordinal. Link raw receipts
only to raw represented inputs, and link summary coverage through its separate actual-intent witness.
