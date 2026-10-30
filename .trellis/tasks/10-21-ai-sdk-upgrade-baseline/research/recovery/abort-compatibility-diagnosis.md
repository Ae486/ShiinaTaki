# Real-fetch cancellation compatibility diagnosis

Date: 2026-10-22. Disposition: the reproduced P2 led to the [concrete policy](cancel-policy-proposal.md), which the owner explicitly approved and the implementer applied. Final verification is in [the implementation report](../implementation-report.md). The analysis and alternatives below are historical decision evidence, not an outstanding approval request.

## Observed regression

The reviewer, coordinator and implementer reproduced the same result with real Node v24.18.0 fetch, a local HTTP SSE server, the actual compatible adapter, real SQLite/ConversationStore and counted detached sinks. The original ChatAgent preimage plus integrity-verified exact old SDK packages throws the original string after partial text and starts no maintenance. Current target preserves the same user/partial assistant rows but returns gracefully and starts one maintenance pass. Prefill cancellation still retracts correctly in both versions. No external service or credentials are involved.

Evidence: `abort-real-fetch-baseline.json`, `abort-real-fetch-target-before-repair.json`, `abort-real-fetch-target-implementer-confirmation.json` and `independent-review.md`. Reproduce the target without overwriting previous evidence:

```powershell
node .trellis/tasks/10-21-ai-sdk-upgrade-baseline/research/recovery/abort-real-fetch-probe.mjs target <evidence-label>
```

## Ranked hypotheses and outcome

1. **SDK early cancellation destroys observable physical failure.** Prediction: the raw target provider still fails on abort, while ToolLoopAgent finishes gracefully and the outside observer sees no error. Confirmed: `stream-text.ts:1933` rejects aggregate results and immediately cancels the reader; the raw-provider probe fails, but the Agent probe resolves. The reader cancellation releases the pending transformed read before the physical fetch error crosses the provider transforms.
2. **The provider-utils upgrade changes failure identity.** Prediction: directly reading the new provider yields a wrapper whose cause is the original reason. Confirmed: the raw target provider throws `AI_APICallError("Failed to process successful response")` with `cause === signal.reason`; the old provider throws the original string. Merely rethrowing an eventually observed wrapper would not restore the old exact error identity.
3. **Core infers maintenance eligibility from stream termination instead of explicit lifecycle policy.** Prediction: equal persisted rows and equal cancellation state can still produce different maintenance counts. Confirmed: `executeAttempts` always commits in `finally`, then calls `state.afterCommit` only when no failure was recorded. Target early cancellation changes that branch without changing the persisted transcript.

## Existing contracts and live consumers

- `.trellis/spec/backend/agent-runtime.md` documents both graceful and throwing transport endings and forbids depending on a synthetic AbortError conversion. Both endings preserve partial text and retract an empty turn.
- `chat-agent-lifecycle.test.ts` and `chat-agent-tail.test.ts` explicitly require graceful partial iteration for a resolving provider. `chat-agent-usage.test.ts` requires no detached report on a throwing partial ending. The old implementation also permits maintenance after a graceful partial ending; changing that is a real semantic change even though the old graceful tests do not assert its maintenance count.
- `main.ts:468` supplies real `autoMemory`; `:479` supplies optional image maintenance. `runtime-composition.ts` binds the former to compaction/maintenance. This is a reachable production sink, not only a test callback.
- `onPrimaryCommitted` is independent: `finishRecordedTurn` witnesses the exact committed rows before any post-turn maintenance. A maintenance-policy change must not suppress that witness or alter eligibility/authority.
- `chat-send.ts:193` and `:201` both settle an aborted Run as cancelled. The graceful branch emits `chat.complete`; the throwing branch emits `chat.error`. Public iteration normalization therefore changes a visible notification path, even when Run state and rows are identical.

## Feasibility of a transparent repair

No supported switch was found to disable only the SDK's early stream cancellation. Its public `onAbort` receives reason/completed steps after cancellation; `onError` can report only errors that survived upstream processing. Existing Effect middleware knows interruption/unknown outcome but cannot prove whether an otherwise cancelled provider would have resolved or rejected.

For the arbitrary `LanguageModel` port, exact preservation of the previous physical-close-versus-physical-error policy is not possible from those public observations. Removing the SDK signal loses bounded stalled-provider cancellation and tool cancellation. Waiting for a physical read/cancel promise is unbounded for an uncooperative provider. Timers, microtask counts or polling would race the missing fact rather than recover it. A custom low-level fetch body observer would add provider-specific per-attempt ownership and cannot solve the generic injected-model contract by itself.

## Concrete owner-level alternatives

| Alternative | Result | Exact semantic change / cost |
| --- | --- | --- |
| Explicit Core cancellation policy for post-turn work; preserve SDK public iteration | Keep the existing commit/retract/Effect paths; skip post-turn maintenance when the turn is cancelled, regardless of public stream ending; remove the ineffective new observer | Graceful partial cancellation no longer starts maintenance. Real fetch string cancellation may now emit `chat.complete` rather than its previous `chat.error`, matching the upgraded SDK's public ending |
| Explicit Core policy and normalize every non-retracted cancellation to `throw signal.reason` | Keep original production string-cancel failure identity and prevent post-turn maintenance | Previously graceful partial aborts become throwing, including resolving-provider and AbortError-style cases; corresponding public notification behavior changes |
| Keep strict old semantics | Do not accept the target as a behavior-preserving upgrade | Requires a different upstream-supported mechanism/version or a separately reviewed provider contract; current callback evidence is insufficient |

The implementer recommends the first policy for simpler ownership only if its behavior change is explicitly accepted. It is not silently applied under the package-only compatibility requirement. The current source is unchanged while the coordinator resolves that decision; no broad suite is being rerun.
