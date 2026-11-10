# Research: Reliable memory maintenance and agent recovery

- Query: How comparable systems handle recoverable tool errors, partial writes, retries, interruption, candidate coverage, and validation; why a passing repair can fail again in everyday use.
- Scope: Mixed; local Letta, Hermes, pi source snapshots, current official AI SDK documentation, AWS Builders' Library, and the installed ai@7.0.148 implementation.
- Date: 2026-11-06
- Task: 11-06-memory-tidy-reliability. The legacy `.trellis/.current-task` points elsewhere; the parent's explicit session task and this task's PRD are authoritative.

## Findings

### 1. A rejected call is an observation for the next step, not automatically a permanently failed task

**pi source.** `references/pi-main/packages/agent/src/agent-loop.ts:600-665` validates tool arguments before execution and converts missing tools/invalid arguments to `isError: true` results. `:207-221` appends all tool results into the continuing context; an individual error does not itself terminate the loop. `:196-199` separately terminates a model error/abort. `:208-214` refuses potentially truncated tool arguments after a length stop. `references/pi-main/packages/coding-agent/src/core/agent-session.ts:650-667` persists completed assistant and tool-result messages.

**AI SDK documentation and installed source.** The official tools guide distinguishes invalid input, missing tools, repair errors, and execution errors; execution errors become `tool-error` parts so the model can react in subsequent steps. Installed `packages/core/node_modules/ai/src/generate-text/parse-tool-call.ts:112-133` returns a structured invalid call containing the original call ID and `invalid: true`. This is useful existing machinery; another autonomous repair agent is not required.

**Application implication.** Preserve error observations and completed writes, but classify effects separately: known rejected-before-write, confirmed applied, and uncertain outcome. Give the model a concrete way to correct an invalid call within the existing step budget. An accepted finish cannot override unresolved actual effects. Equally, a historical rejected call need not poison a valid completed review forever. This classification must come from the real write boundary, not from matching arbitrary exception text or assuming every error implies no mutation.

Do not copy pi's broad raw exception-message projection into TakiAgent diagnostics; our privacy boundary is stricter. Safe field names, closed reason codes, and a corrective instruction are sufficient.

### 2. Memory-specific loops use explicit scope and completion, but references are not proof of flawless durability

**Letta source.** `references/letta-main/letta/agents/voice_sleeptime_agent.py:85-95` expresses store -> rethink -> explicit finish with tool rules and a maximum step count. `:127-151` returns tool-specific success/error results rather than throwing the whole maintenance entry point; chunk storage aggregates individual success flags. `:97-102` persists the resulting context.

This supports a small specialized maintenance loop with meaningful tools and explicit completion. It does **not** establish atomic multi-chunk writes, restart-safe work resumption, or TakiAgent-style revision protection. Importing Letta's full agent architecture or copying its finish rule would not solve our candidate-coverage and operator-state gaps.

### 3. Retry budgets, useful guidance, and honest interruption are standard engineering work

**Hermes source.** `references/hermes-agent-main/agent/tool_guardrails.py:241-261` can stop repeated identical failed calls; `:321-328` warns the model to inspect the error and change strategy. `:407-422` provides action-oriented recovery guidance. The principle is useful; importing its entire configurable guardrail subsystem is unnecessary for one bounded tidy loop.

`references/hermes-agent-main/agent/memory_manager.py:628-684` serializes background memory writes so a slow provider cannot keep the foreground turn open. Its comment records a real provider hang of about 298 seconds. `:688-712` makes admission plus tracked-future ownership atomic with shutdown. `:1159-1211` drains work for a bounded interval, then reports abandoned writes separately from abandoned prefetch and still-active work. This is explicit loss/uncertainty reporting, not a guarantee of durable replay after restart.

`references/hermes-agent-main/run_agent.py:3448-3507` prevents interrupted turns from being published as completed conversational memory. The regression at `references/hermes-agent-main/tests/run_agent/test_memory_sync_interrupted.py:1-17` documents how partial replies previously became false durable truth. Mature projects also ship defects; their useful practice is to retain the failure scenario and strengthen the lifecycle contract.

**AWS guidance.** The Builders' Library explains that retries can amplify failure, timeouts do not prove an operation had no effect, and retryable side effects need idempotency. Apply a small retry budget/backoff at the owning tidy service; do not stack independent retries in UI, service, model adapter, and mutation tools. Multi-host jitter and a distributed queue are not justified by this single-process Local feature.

### 4. Reuse the project's operation owner before adding a framework

The existing `.trellis/spec/backend/memory-operations.md:1-75` already specifies Core-minted operation identity, one active operation per family, state queries, restart classification, and no mutation replay after a lost UI reply. `packages/core/src/memory/operations/` implements this for setup/replica operations. It is a candidate for reuse, subject to inspecting its actual extension cost and Local/Hindsight boundaries; its current Hindsight producer accessor is not evidence that Local tidy is already supported.

Whether the implementation extends that owner or adds a narrow Local tidy record, the required facts are small: what is running, what committed, what remains, whether retry is safe, and the next action. Preserve existing mutation receipts rather than creating a second general-purpose receipt store.

Candidate coverage is a separate correctness requirement. None of the inspected snippets proves a directly reusable cursor for our five-class report. For TakiAgent, a bounded rendered batch and its completed coverage must correspond. A timestamp spanning unshown records is not evidence they were reviewed. Leave unshown/unfinished work eligible; do not remove the report bound to hide the defect.

## Verified AI SDK 7 API for bounded tidy execution

Installed version: `packages/core/node_modules/ai/package.json:3` is **7.0.148**. Official pages were retrieved on this date, but their moving documentation should not substitute for these installed interfaces.

```ts
const agent = new ToolLoopAgent({
  model,
  tools,
  toolCallConcurrency: 1,
  maxRetries: 0, // Example: choose one explicit owner for provider retries.
  timeout: { totalMs: TIDY_TOTAL_MS },
});
await agent.generate({
  prompt,
  abortSignal: controller.signal,
  timeout: { totalMs: TIDY_TOTAL_MS, stepMs: TIDY_STEP_MS },
});
```

- `src/agent/tool-loop-agent-settings.ts:49-55` includes `RequestOptions` except constructor `abortSignal`; `:124-130` accepts `toolCallConcurrency`. Set 1 for sequential SDK-executed local calls. It does not reduce how many calls the model generates or control provider-executed tools.
- `src/agent/tool-loop-agent.ts:197-222` accepts per-call `abortSignal`/`timeout`; a call timeout overrides the prepared constructor timeout.
- `src/prompt/request-options.ts:13-22` supports a number or `{ totalMs, stepMs, firstChunkMs, chunkMs, toolMs, tools }`. For non-streaming `generate`, use total/step budgets; first/chunk timers are streaming-only.
- `src/generate-text/generate-text.ts:639-652` merges cancellation and timeout signals before provider retries. Budget the whole pass, not a fresh full interval after every failed call.

### Timeout limitation verified locally

A synthetic `MockLanguageModelV4` probe used `agent.generate({ prompt, timeout: { totalMs: 25 } })` and no network/database. With an abort-aware provider promise, generation rejected (observed 73 ms). With a provider promise that ignores abort and never settles, the signal was aborted but generation remained pending after 150 ms (observed 153 ms). The observation used a race solely to cap the test, not to implement production cancellation.

Therefore SDK timeout is cooperative. It is the first implementation choice for the shipped HTTP adapter, but cannot honestly be described as a hard bound for an arbitrary non-cooperative provider. Verify a stalled local HTTP response through the actual compatible adapter. If the product must also release a non-cooperative injected provider, an owner-level bound must retire the attempt and fence all late writes; a bare Promise.race that leaves tools free to write is unsafe. Do not add that extra machinery unless the supported runtime requires it.

## Why the earlier green checks were insufficient

1. **The tested acceptance condition was too narrow.** Exact version-conflict correction passed while other known no-write refusals remained sticky by design. Passing those tests confirms that contract, not the broader user requirement.
2. **One tidy pass does not exercise accumulating state.** More candidates than the report cap, same-record multi-step edits, concurrent foreground changes, queued manual/automatic work, and a second tidy cycle produce states absent from a clean single-pass fixture.
3. **Transport success and tool execution are separate.** Four completed model requests do not establish successful mutations, correct memory judgment, or complete candidate coverage.
4. **A known DB mutation and an observed UI reply are separate.** Drop the reply after commit, recreate the page, and restart Core to test recovery from the state of record.
5. **A scripted model proves mechanics, not tool usability.** Retain deterministic failure injections and add bounded model observations over representative memory contents. Preserve all attempts, rather than retrying until a run passes and reporting only that success.
6. **Missing diagnostics prevents a precise regression.** Keep safe per-attempt classifications and affected work identities so a real failure can become a reproducible case without logging private memory bodies.

## Minimum meaningful validation matrix

| Scenario | Required evidence |
| --- | --- |
| Invalid input/reference -> correct call -> finish | No write on rejection; intended write once; recovery is reflected in final status |
| Applied edit -> later API failure/timeout | Applied edit survives; incomplete state and next action survive reconnect |
| More than one report batch; finish without changes | All shown coverage is recorded; unshown candidates remain eligible across later attempts/restart |
| Manual and automatic overlap; changes while queued | One owner; snapshot captured when admitted execution starts; no stale duplicate pass |
| Identical repeated refusal / repeated transient failure | Bounded calls; safe retained work; visible stopped/backoff state |
| Response lost after commit / page remount / Core restart | Query reconstructs actual status; no automatic uncertain-write replay |
| Local HTTP provider never returns a response | Actual adapter aborts; tidy settles; later Utility work and shutdown can proceed |
| Realistic multi-step/model corpus | Preserve semantic judgment review and error frequency separately from deterministic lifecycle tests |

The project already requires this distinction in `.trellis/spec/backend/e2e-harness.md`: L1 deterministic routing is not L2 model behavior; a single-turn empty history cannot catch context-dependent tool failures. No general reliability percentage can be claimed from a small passing sample.

## External references

- AI SDK tools and tool calling: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- AI SDK ToolLoopAgent: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent
- AI SDK request settings: https://ai-sdk.dev/docs/ai-sdk-core/settings
- AWS Builders' Library, Timeouts, retries, and backoff with jitter: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/

## Related specs

- `.trellis/spec/backend/canonical-local-memory-runtime.md` — authority, revision, transactional writes, existing tidy completion.
- `.trellis/spec/backend/error-handling.md` — structured actionable errors, mutation timeout is unknown, no unsafe retry.
- `.trellis/spec/backend/memory-operations.md` — existing durable operation ownership and restart/reconnect truth.
- `.trellis/spec/backend/e2e-harness.md` — deterministic versus model-backed evidence and multi-turn acceptance.

## Caveats / Not Found

- Letta/Hermes/pi were read from local snapshots; no git operation or upstream freshness verification was performed. They are implementation examples, not claims about their latest releases or defect rates.
- No third-party suite was run. The only new executed experiment was the installed-SDK timeout probe; it used synthetic providers, no paid model or live state.
- The reference index searched revision 06a8090118a4 and did not directly index the requested reference trees. Subsequent reads used exact known files and local symbols. The main implementation must use current workspace source rather than index revision as truth.
- The two live invalid-call arguments remain unknown. These comparisons do not establish their exact cause or prove model context length caused them.
- No new dependency, workflow engine, remote queue, model replacement, or general agent architecture is recommended.
