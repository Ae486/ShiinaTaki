# Candidate: Core-owned cancellation policy for post-turn callbacks

Date: 2026-10-22. Disposition: the owner explicitly approved this proposal and its stated behavior changes; the policy is now applied to production source. Final verification is recorded in [the implementation report](../implementation-report.md). The candidate matrix and preparation text below are retained as historical decision evidence; they do not mean approval or application is still pending.

## Proposed behavior

After the existing turn `finally` has persisted the produced content and witnessed exact primary rows, and after the existing retraction/real-failure handling, invoke the post-turn callback bundle only when `turn.signal` is not aborted.

The bundle currently comprises request-pressure remeasurement, `autoMemory.onTurnCompleted`, optional image-description maintenance and the detached turn-usage callback. This proposal does **not** disable all memory ingestion: `finishRecordedTurn` and `onPrimaryCommitted` still witness retained eligible user/partial assistant rows through the existing source/authority path. The candidate does not alter Memory eligibility, timeline identity or original-row persistence.

Keep the supported SDK's immediate cancellation and public stream ending. Remove this task's ineffective physical stream-failure observation layer instead of reconstructing a lost exception with timers or extra provider ownership. Genuine errors that reach the stream continue through the original failure path.

## Reviewable patch

[Candidate diff](cancel-policy-candidate.diff), relative to the current installed target:

- `packages/core/src/agents/chat-agent.ts`: remove the task-added stream observer import/wrapping/rethrow; use the original selected model; guard the existing `state.afterCommit` call after persistence/retract/failure handling; update the detached-callback comment; remove the now-unnecessary 363-line local allowance.
- `packages/core/src/agents/provider-stream-failure.ts`: remove only the file introduced by this SDK child.
- `packages/core/src/agents/index.md`: remove that observer's entry.

The new owner guard is:

```ts
if (retracted) return;
if (failure) throw failure.error;
// A cancelled turn keeps its committed source witness but starts no post-turn maintenance.
if (!turn?.signal?.aborted) state.afterCommit?.();
```

All preceding `finally`, `finishRecordedTurn`, witness, tool/Effect and retry code remains unchanged. The signal is sampled at this post-commit point; a cancellation already observed there suppresses the bundle even if the SDK stream returned normally.

The candidate module is stored at `cancel-policy-candidate/chat-agent.ts`. Its original three source preimages and hashes are under `cancel-policy-candidate/`. The probe uses Node resolve hooks only inside its process to load that module while resolving its relative imports against the production module's directory. No working file, package manifest, installed graph or original test was replaced.

## Observed before/candidate matrix

Each cell below was observed with Node v24.18.0 and actual in-memory SQLite/ConversationStore. HTTP rows use real Node fetch against an owned loopback HTTP/SSE server; the resolving fake is explicitly separate. Baseline uses the original ChatAgent preimage and integrity-verified exact old packages. Target/candidate use the currently installed exact target graph.

| Scenario | Original baseline | Current target | Candidate |
| --- | --- | --- | --- |
| HTTP abort before any delta | Empty transcript; one retraction; zero witnesses/maintenance; graceful caller return | Same | Same |
| HTTP abort after first `partial` delta | User + partial assistant retained; one primary witness; **exact string throw; maintenance 0** | Same rows/witness; **graceful return; maintenance 1** | Same rows/witness; **graceful return; maintenance 0** |
| Resolving fake provider, abort after partial delta | Same retained rows; one witness; graceful return; **maintenance 1** | Same | Same rows/witness/return; **maintenance 0** |
| Ordinary HTTP success | Complete text; one witness; maintenance 1; no failure | Same | Same |
| Genuine HTTP 401 provider failure | Original user row retained; one witness; API-call error with status 401; maintenance 0 | Same | Same |

Every case made exactly one model request. All fifteen mode/case assertions passed. The fixture counts calls at the detached maintenance seam; it does not run native memory extraction or a paid model. It leaves the exact witness callback in place and checks its count alongside the actual persisted transcript.

Evidence: [baseline](cancel-policy-baseline.json), [current target](cancel-policy-target.json), [candidate](cancel-policy-candidate.json), [combined matrix](cancel-policy-matrix.json), [command/exit records](cancel-policy-checks.json). Full outputs are beside those JSON files.

```powershell
node .trellis/tasks/10-21-ai-sdk-upgrade-baseline/research/recovery/cancel-policy-probe.mjs baseline
node .trellis/tasks/10-21-ai-sdk-upgrade-baseline/research/recovery/cancel-policy-probe.mjs target
node .trellis/tasks/10-21-ai-sdk-upgrade-baseline/research/recovery/cancel-policy-probe.mjs candidate
```

The candidate source also passed the existing production ESLint configuration through stdin with the real `chat-agent.ts` filename, without the local size override. `git apply --check` accepted the candidate diff. [Validation](cancel-policy-candidate-validation.json) confirms that all three production preimages remain unchanged. These checks do not apply the patch.

## Exact behavior decision for the owner

1. Previously graceful partial cancellation could start the existing post-turn callback bundle. Under the candidate, every turn whose signal is aborted at the post-commit guard skips that bundle. Retained eligible source witnessing and later memory processing remain governed by the unchanged existing owners.
2. Actual Node fetch string cancellation keeps the upgraded SDK's graceful return, instead of synthesizing the original thrown string. Source inspection of `chat-send.ts` shows that both branches settle Run/activity as `cancelled`, but the normal return path emits `chat.complete` whereas the old throw path emitted `chat.error`. **No RPC handler or schema is changed by this candidate.** This notification consequence is established by source inspection, not by an exercised WebSocket/UI acceptance test.

The alternative is to retain the strict original contract and leave this target unaccepted until an upstream-supported mechanism/version can preserve it. No equally simple transparent repair was found: early SDK cancellation destroys the physical failure before public callbacks observe it, and the arbitrary `LanguageModel` port does not declare whether a cancelled body would otherwise close or reject.

## Limits and work after an approval

- No production source or original expectation was changed. The old throwing-fixture expectations have not been weakened to make the candidate pass. Accepting the candidate requires updating the cancellation contract and affected regression expectations explicitly, while adding this real transport coverage at the maintained test seam.
- This candidate matrix does not exercise the full WS/UI path, image maintenance, completed tool effects, or every graceful/throwing provider shape. The unchanged earlier Effect/governance tests are not claimed as tests of this uninstalled candidate. Those affected tests and a real WS cancellation check should run after application.
- No broad suite was rerun for this proposal. Earlier workspace/platform results still describe the current target source, which retains the verified P2 until a repair is applied and reviewed.
- No external service, paid call, live data mutation, commit, push or archive occurred. The task-local loader uses the already prepared exact old-package fixture; it does not change root dependency resolution.
