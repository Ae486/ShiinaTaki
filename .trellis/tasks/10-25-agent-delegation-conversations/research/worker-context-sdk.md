# Research: Task-worker context and installed SDK

- Query: How can delegated children continue without a fixed round cap, compact task context during and between executions, and retain exact self-readable evidence using the existing Runtime and installed AI SDK?
- Scope: mixed; current worktree source, installed package source/bundled official docs, deterministic offline probes. No new vendor survey.
- Date: 2026-10-25
- Authority: `prd.md` and `docs/AGENT-DELEGATION-RESEARCH.md:9-132`. Planning only; no production changes, paid calls, new dependency, Git action or acceptance claim.

## Findings

### Recommended direction

Keep `ChatAgent` / `ToolLoopAgent`. Only `work.scope.kind === "subagent"` receives explicit natural/report/interaction stop conditions without the project step cap. Add a small private task-summary projection at complete-round boundaries. Reuse it before later executions and before the next request inside long SDK loops. Preserve exact private history and make self-scoped retrieval a mandatory internal child capability. Compact delegation results through model-output projection while keeping durable evidence and exact action targets.

One additional boundary is necessary: `prepareStep` reduces model input but does not bound an indefinitely running SDK call's retained arrays. On actual context/retained-material pressure, end that SDK call after a complete, durably recorded step and continue with another `ToolLoopAgent.stream()` call inside the **same live Run/Attempt**. This is call segmentation within the shared ChatAgent owner, not a new tool executor or a task-round limit. Each new call receives the committed summary plus recent complete rounds. Production safety for this seam remains an implementation gate; the offline SDK probe establishes API feasibility only.

### Files found and verified patterns

| File / source lines | Purpose and verified finding |
| --- | --- |
| `packages/core/src/agents/chat-agent.ts:347-375` | Existing SDK owner; prepares addressed work/disclosed tools, applies `isStepCount` to all work, and records completed steps before another request. Branch by actual child scope; `parent-continuation` must retain main policy. |
| `packages/core/src/agents/chat-agent.ts:255-280,388-415` | One clean overflow retry is fenced by completed output; current SDK-call completion reaches settled-text/post-turn processing. Segmentation must stay inside the live attempt and bypass task-final processing until a genuine execution boundary. |
| `packages/core/src/agents/work-context.ts:13-36` | Existing private projection, actual-intent receipt, completed-step and partial ports. `prepareStep` is currently synchronous; task compaction needs an awaitable preparation/checkpoint seam. |
| `packages/core/src/agents/run-message-store.ts:35-74,104-136` | Per-attempt prepared-step cache and addressed-input watermark; replay uses at most 2,000 newest rows, no rolling summary (`summaryTokens: 0`), and an `inspect_subagent` omission instruction. Sender rendering distinguishes user/parent/system. |
| `packages/core/src/db/run-message-repo.ts:24-45,59-85` | Model-intent transaction links exact input receipts to Run/Attempt/Effect and validates stop/control/source/watermark currentness. Preparing or summarizing context alone cannot consume an input. |
| `packages/core/src/harness/subagent-execution.ts:22-43,53-62,96-107` | Shared ChatAgent admission and settlement; child-specific tools currently contain the final collector only (or `{}` for feature-owned validation). SDK end currently leads toward Run settlement; a rollover must not escape here. |
| `packages/core/src/agents/subagent-result-tool.ts:40-58` | Final stop becomes true only after the actual matching accepted tool-result witness commits the proposal. Preserve this structural condition; text saying “done” is insufficient. |
| `packages/core/src/agents/subagent-inspect-tool.ts:11-27`; `packages/core/src/harness/subagent-queries.ts:49-69` | Scoped inspector exists, but child wiring omits it. Tool only forwards message cursor, resets input cursor to zero and omits completion/list cursors; service already supplies all cursor families. |
| `packages/core/src/harness/delegation-tools.ts:12,29-43` | Executable membership is filtered after work-specific tool assembly. Adding retrieval to `WorkContext.tools` alone does not guarantee it survives an empty allow list/exclusion. Introduce an explicit internal self-history capability, rather than silently widening inherited user tools. |
| `packages/core/src/agents/context-window.ts:55-57,158` | Existing `replayUnits` protects assistant call groups and matching results, including overlapping spans; newest valid unit is retained even when oversized. Reuse pairing validation, not arbitrary row slicing. |
| `packages/core/src/agents/request-measurement.ts:37-62,81-88` | Prices instructions, messages and actual/prepared tool schema, with reserve and provider-usage calibration. Reuse calculation; keep child pressure independent of Companion maintenance. |
| `packages/core/src/agents/context-reduction.ts:121-136,190`; `packages/core/src/agents/summary-quality.ts:18` | Source-aware bounded transcript/tool reducers and blank/truncated/non-shrinking/content guards. Adapt private rows and trusted sender facts; do not manufacture Timeline rows to call these helpers. |
| `packages/core/src/agents/model-effect-middleware.ts:79-95`; `packages/core/src/db/effect-repo.ts:60-74` | Each real provider dispatch obtains a new governed model Effect with `replayPosture: "never"`; Effect IDs are UUIDs, not SDK step numbers. Preserve this owner and request-specific usage settlement. |
| `packages/core/src/agents/turn-recording.ts:28-39`; `packages/core/src/harness/subagent-tool-materials.ts:28-29,60-72` | Project caches also grow with completed steps/tool material. SDK segmentation alone cannot establish bounded process retention. Flush/prune already-durable step/receipt/material caches and resolve older material through durable scope-checked reads. |

### Installed SDK contracts and references

Verified Core dependency `ai@7.0.148`, Node `v24.18.0`; package resolves inside this worktree. In the following citations, `<AI>` means `node_modules/.pnpm/ai@7.0.148_zod@4.4.3/node_modules/ai`.

- `<AI>/src/agent/tool-loop-agent.ts:132` defaults omitted `stopWhen` to 20. `<AI>/src/generate-text/stop-condition.ts:29-38` implements `isStepCount` and `isLoopFinished`; the latter always returns false and removes a count condition. Natural noncontinuation, missing execution/approval, cancellation and collector stops still apply.
- `<AI>/docs/07-reference/01-ai-sdk-core/72-loop-finished.mdx:8-10,40-46` is the bundled official reference. Corresponding public reference: <https://ai-sdk.dev/docs/reference/ai-sdk-core/is-loop-finished>. This session relied on the installed version's docs/source, not a live public-page refresh.
- `<AI>/src/generate-text/stream-text.ts:1755-1781,2426-2450,2499-2503` waits for completed-step callbacks, accumulates `recordedSteps`, passes full response history into preparation, and makes the returned message projection the next loop base. `prepareStep` is awaitable. It never evicts `recordedSteps` during the call.
- `<AI>/src/generate-text/stream-text.ts:3217-3229` evaluates stop conditions after client tool outputs settle. A pressure stop must additionally reject unresolved/deferred/provider-executed frontier work; the client count check alone is insufficient for every supported provider path.
- `<AI>/src/generate-text/stream-text.ts:1819,1888-1917` builds aggregate arrays and clears references only after ending in the non-replay path. The `streamTextIterable` non-replay entry is not a replacement for `ToolLoopAgent` and does not remove in-loop retention; no alternate loop is selected.
- `<AI>/src/prompt/create-tool-model-output.ts:23-24` calls `toModelOutput`; `<AI>/src/generate-text/to-response-messages.ts:111-125` converts output for native replay messages. Raw `event.toolResults` still holds the original result. **Do not persist only the compact converted messages and then claim full raw-result retention.** Attach producer source metadata and keep any required full result/material in its existing durable owner before pruning process-local caches.

### Offline probe evidence

Retained initial probe `worker-sdk-probe.mjs` / `worker-sdk-probe-result.json` (2026-10-25 04:41:35 UTC) used `MockLanguageModelV4`, no provider or production database. All recorded assertions passed:

| Scenario | Requests / tools | Observed result |
| --- | --- | --- |
| Omitted stop condition | 20 / 20 | SDK fallback stopped before the scripted final request. |
| Explicit `isLoopFinished()` | 23 / 22 | Crossed both project default 10 and SDK fallback 20; final step arrived. |
| Four `prepareStep` projections | Same 23 / 22 | Compacted at steps 5/10/15/20; maximum prepared input was 15 messages, while SDK retained 45 full response messages and 23 StepResults, including earliest evidence. |
| `toModelOutput` | Same execution | Raw step tool results retained `privateReceipt`; converted model response messages omitted it. This proves separation of SDK views, not project durable storage. |

Added `worker-sdk-probe-rollover.mjs` / `worker-sdk-probe-rollover-result.json` (2026-10-25 04:54:53 UTC): a retained-response material threshold of 1,800 bytes triggered **four SDK calls with 7/7/7/4 steps**, totaling 25 model requests and 24 once-only tools. SDK-local numbering restarted while asserted global numbering stayed 0..24. Every next request contained the latest completed result; compact summary plus two complete rounds crossed call boundaries. Four SDK `onEnd` events produced one simulated task-final state. All assertions passed. This uses invented Run/Attempt/Effect identifiers and an in-memory checkpoint; it does **not** prove production ledger, cancellation, checkpoint transactions, memory footprint or summary quality.

Reproduce from `H:/TakiAgent-worktrees/t4` without network:

```powershell
node .trellis/tasks/10-25-agent-delegation-conversations/research/worker-sdk-probe.mjs
node .trellis/tasks/10-25-agent-delegation-conversations/research/worker-sdk-probe-rollover.mjs
```

### Required safe call-segmentation contract

1. **Pressure, not task count.** Reprice the next complete request after bounded tool projection; trigger compaction from complete-envelope pressure. Also monitor retained SDK/project material, including raw tool results and request copies, so repeated shrinking inputs cannot hide growing retained history. No fixed total round/turn cap. Individual request timeouts and real authority/source validity remain active.
2. **Complete frontier only.** Persist the completed assistant/tool round and producer source material first. Verify all tool outcomes settled, no approval/deferred frontier pending, and current Run/Attempt/control/source token. Never abort a running tool to force compaction; never resend its original call to reconstruct results. An unfinished or unknown non-model Effect requires existing reconciliation/refusal semantics.
3. **Atomic private checkpoint.** Bind selected complete range, prior revision/coverage, canonical source digest (including sender/source facts), tail frontier and resulting summary. Validate output; then atomically CAS summary text/coverage/revision and status under the current worker owner. Concurrent appended user input remains uncovered and appears in the next model-intent receipt. Failed commit, stale stop/source/owner or failed quality check leaves old checkpoint and raw history authoritative. Do not update coverage before saving the summary. A separate long-lived lease framework is unnecessary if the existing serialized owner and durable CAS provide the required exclusion.
4. **Same live execution.** A typed internal `context_rollover` reason stops only the current SDK call after that checkpoint. Drain/release its stream/result/callback references; retain the child lane, original cancellation signal, same Run and same Attempt. Do not call Run retry/settle, report final text, create completion events or run Companion maintenance. Revalidate authority before each subsequent actual provider dispatch.
5. **Global step association.** Map each SDK-local number to a monotonically increasing Attempt-level task step ordinal across segments. Use that number consistently for prepared input, raw/completed/partial rows, tool material refs and activity. Continue obtaining unique actual model Effect IDs from the existing lifecycle; bind intent receipts to the actual Effect, not the reused local number. Summary model calls also require their existing governed Utility execution/usage path and must not reuse a task-request Effect or consume addressed task inputs accidentally.
6. **Release all retained caches.** Keep only current preparation, latest complete tail and partial frontier in process-local work recording/material caches after durable persistence. Clear SDK result/stream closures at rollover. Older full materials resolve through existing durable repositories. Never clear captured executable authority, stop latches, pending input receipts or unsaved source metadata. Preserve successful Skill/MCP disclosure for this same captured generation in bounded activation state: `activeTools(steps)` cannot treat a new SDK call's empty local steps as a new generation, or require replaying loader effects to reconstruct availability. Verify raw tool-call IDs cannot alias old material when a provider reuses a local ID; retained matching must include the actual step/model Effect association where needed.
7. **Natural end remains truthful.** Task final/report/needs-input, user Stop, failure and an SDK context rollover are separate. If the model naturally stops without an accepted final collector, retain its truthful unstructured/partial outcome; do not auto-retry indefinitely or announce successful task completion. Persisted checkpoint after a crash supports later explicit continuation under existing recovery; it never authorizes automatic replay.

### Input frontier clarification after independent review

Reverified in recovery session `01a17186-8409-7073-b737-845377a5e84f`: `agents/run-message-store.ts:35-61`
accumulates `carried` IDs and step preparations; `:104-113` reads every work input on each preparation.
`db/run-message-repo.ts:24-45,65-85` creates a raw input row for each supplied input/Effect association, while keeping
the first-consumption pointer immutable. If compaction removes raw input but these IDs remain carried, new receipts
would incorrectly claim raw input inclusion. This is a proposed-compaction integration risk, not a claim that
the unimplemented compaction already corrupts the baseline.

Use the existing durable first-consumption facts to select pending inputs, plus IDs actually represented in the
bounded exact replay tail. Record the committed summary revision, coverage and digest separately at actual task
model intent. Summary-only historical inputs receive no new raw receipts; existing first-consumption evidence is
unchanged. A summary Utility call cannot consume a pending task input. Newly accepted inputs remain outside summary
coverage until their first task-model dispatch.

Read pending data in pages under a captured work watermark. Preserve `recordModelInputs`' complete-pending-input
check through that watermark and its stop/control/source validation; later arrivals remain pending. Paging and
cache eviction do not justify dropping a correction or advancing a receipt for omitted content. If the complete
pending envelope cannot fit, return explicit context failure with unchanged pending evidence. Release covered
historical/preparation references only after durable raw evidence and checkpoint agreement. Add many sequential
user/parent corrections, concurrent arrival, actual payload-versus-receipt assertions, stale CAS and restart to the
S4 tests; tool-only rollovers do not establish this contract.

### Task summary, exact retrieval and failure handling

- Summary contents: original task/constraints, findings and decisions, completed changes/actions, unresolved work, essential artifact/evidence references. Keep sender/source and negation with the associated facts. Parent-selected text remains generated parent context; a summary never becomes a direct user quote, trusted authority, external fact or primary Memory source.
- Retain recent complete action/observation units by token pressure, not N database rows. Protect current input and every pending frontier. Apply source-aware compact tool projections first. A giant newest round that still exceeds the context envelope cannot be silently chopped into orphan messages or treated as zero pressure: reduce its tool body with exact retrieval/material reference, or return explicit context-unavailable degradation at that safe boundary. Giant immutable instructions/tool schemas need explicit refusal rather than repeated ineffective summarization.
- Minimal checkpoint belongs to the private child transcript owner; retain range/revision/digest and summary. Exact message/input/result evidence stays under existing retention policy. Do not run Character `CompactionCoordinator` unchanged, flush private work to Memory, or mirror private context into the relationship Timeline.
- Summary retries are bounded per same captured range/source; failures/empty/truncated/non-shrinking summaries leave raw evidence and prior checkpoint intact. If a remeasured raw/projection request fits, continue with an explicit no-compaction result and suppress immediate repeated retries at that same boundary. If it cannot fit after the bounded budget, stop dependent inference with a typed compaction/context failure and report unfinished work. This is an explicit failure boundary, not a reduced task capability or a success claim.
- Wire an internal history tool fixed to the actual child ID, scope-check any Run/completion reference, and expose one requested category/page. Support all relevant message/input/completion/list cursors for the parent inspector; the child need not list siblings. Use explicit next-cursor/has-more and available/empty/omitted/unavailable states. Bound each response, but make all retained pages reachable. Large single body retrieval needs a text/material continuation cursor rather than returning the same truncated prefix forever.
- Mandatory self retrieval must survive empty user tool selections because it is intrinsic context recovery, not inherited action authority. Keep it in the executable registry and SDK disclosure when the omission instruction is emitted. No child gains sibling access or Memory mutation. Prompts cannot promise an unavailable tool.
- For delegation acknowledgements/results, `toModelOutput` can expose readable name, truthful accepted/refused/queued/outcome state, bounded result, exact control target/version and material references. Raw receipts/digests/input copies remain available in existing diagnostic/durable owners. UI formatting is a separate surface.

### Alternatives and material tradeoffs

| Alternative | Decision / consequence |
| --- | --- |
| Raise caps or merely omit `stopWhen` | Reject: fixed cap contradicts requirements; omission restores SDK 20. |
| One unlimited SDK call with `prepareStep` only | Reject as complete design: provider context can stay small while SDK and project caches grow. |
| Pressure compaction plus safe shared-owner SDK segmentation | Recommended: retains package-owned tool execution, requires global numbering, complete-frontier/CAS and cache-release work. Extra summary calls cost latency/tokens; no paid probe was run here. |
| One-step SDK calls under a bespoke external tool loop | Reject: duplicates tool-loop ownership and creates replay/approval/source risk. |
| Reuse main Character compaction coordinator unchanged | Reject: relationship Timeline/Memory flush ownership contradicts private task compaction. Reuse helpers, not its pipeline. |
| New framework, broker or memory/index service | No demonstrated gap requires it; excluded by approved scope. |

### Applicable specs and later implementation gates

Read `backend/agent-runtime.md` (complete paired records/source truth), `backend/shared-agent-delegation.md` (private storage, actual-intent receipts, child tool restrictions/recovery), `backend/compaction-harness.md` (measurement, source-aware projection, quality/CAS patterns), `backend/tool-design.md` and `backend/tool-disclosure.md` (actionability/executable membership), plus database/SQLite transaction, permission/accepted-work and E2E contracts for affected wiring. Current immutable work-expiry wording in shared delegation and the old SDK `7.0.17` main-compaction prohibition are historical contracts: approved child-only changes need a targeted spec update; they do not authorize changing main policy or feature-owned `record_only` work.

Required deterministic integration gates before claiming implementation success:

1. Real shared ChatAgent child crosses both caps, compacts in-loop and on later reuse, and crosses multiple pressure segments with the same live Run/Attempt. Main and `parent-continuation` caps, `record_only` and publication authority remain unchanged.
2. Actual SQLite Effect/input/message/material records prove increasing global step association and unique provider Effect identity across segments; every tool executes once; latest complete paired result and source/sender facts reach the next actual provider request. Preparation alone consumes nothing.
3. Inject Stop, appended user correction, stale source/control, checkpoint rollback, crash after tool settlement and unknown/deferred/approval frontier. No false final notification, discarded raw evidence, auto-resume/replay, double input consumption or orphan call/result projection.
4. Force blank/failed/non-shrinking summaries and giant rounds/schema pressure. Verify bounded attempts, truthful degraded/failure state, unchanged checkpoint/raw bytes and no permanent retry loop.
5. Exhaust self-history and parent category cursors beyond 2,000 records, empty tool selections, large single results, sibling/Character denial and read failures; summaries plus retrieved facts preserve real sender/source and failure status.
6. Compare actual compact provider payloads with full durable source/results and stale-control targets. Verify caches/SDK references stay bounded by retained material/tail/frontier across many segments; a message-count mock is insufficient heap evidence.
7. Focused runtime/SDK/governance/recovery tests, Core/Shared typechecks and required lint; composition/SQLite changes require isolated production-main/WS checks. Any real-model observation and owner UI/semantic acceptance remain separately labelled gates.

## Caveats / Not Found

- Global `.trellis/.current-task` still names `09-03-avatar-presentation-lab`; this assignment explicitly selected `10-25-agent-delegation-conversations`, whose `task.json` is `planning`. No pointer/task-state change was made.
- No production summary/checkpoint or pressure-rollover implementation exists from this research. The new probe proves installed-SDK call boundaries only; it asserts rather than exercises Run/Attempt/Effect governance and does not measure heap retention or real model accuracy.
- Existing replay is bounded and retrieval wiring/pagination is incomplete; a truthful omission note is currently insufficient as usable recovery.
- `toModelOutput` alone cannot guarantee full raw durable-result retention, source association, compact UI, or bounded request/SDK memory.
- No paid model/provider call, external SDK migration, dependency install, native Hindsight validation, real-user database change, human acceptance or production-main migration convergence was performed.
