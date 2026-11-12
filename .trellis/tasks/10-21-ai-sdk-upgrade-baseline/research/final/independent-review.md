# Independent review of the approved cancellation repair

Date: 2026-10-22. Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.
Review authority: original parent/child requirements plus the owner's explicit approval of
`../recovery/cancel-policy-proposal.md`, reported by the coordinating agent. The earlier strict preservation
requirement is superseded only for the documented cancellation/notification/post-turn callback semantics.

**Final disposition: pass; no blocking findings remain in the reviewed SDK child.**
The earlier P2 is resolved through the approved Core policy; it is not silently dismissed as mock-only behavior.
See the preserved [original finding](../recovery/independent-review.md) and failed transport evidence.

## Findings (fixed)

- File: `packages/core/src/agents/chat-agent.ts:264`.
  Issue: immediate SDK cancellation could return gracefully and trigger detached callbacks after a real-fetch
  cancellation, whereas the old transport throw suppressed them.
  Fix: the existing turn owner now invokes `state.afterCommit` only while its signal is not aborted. This check is
  after the capture/commit `finally`, retraction and genuine surfaced-failure handling. Exact retained-primary
  witnessing remains inside `finishRecordedTurn` before this guard. Non-primary settled-text checks remain separate.
- File: former `packages/core/src/agents/provider-stream-failure.ts` and its ChatAgent/index references.
  Issue: the outer observer could not recover a physical body error destroyed by SDK/adapter cancellation.
  Fix: remove the ineffective task-created observer and synthetic rethrow attempt; keep the SDK's supported graceful
  ending and bounded immediate cancellation. No timers, polling, signal replacement or additional provider owner
  were added. The temporary 363-line allowance is no longer needed and is removed.
- Files: `packages/core/src/server/methods/chat-send-sdk-transport.test.ts`, affected existing cancellation tests,
  `packages/core/src/testing/mock-language-model.ts`, `.trellis/spec/backend/agent-runtime.md`.
  Issue: scripted body rejection had been described as sufficient real-transport evidence, and old expectations
  encoded the superseded callback/throw policy.
  Fix: retain distinct scripted fixtures, document their limits, and maintain actual HTTP/global-fetch plus real
  authenticated WebSocket coverage. Expected cancellation behavior is changed only under the owner's explicit
  decision; partial rows, retraction, witnesses, genuine errors and Effect assertions remain required.

All production/test/spec fixes above were made by the implementation worker. This reviewer changed only independent
review/evidence files and ran the narrow original reproduction against the repaired source.

The review snapshot contains 15 files in `source-complete.json`. All current SHA-256 values match, every comparable
saved source preimage matches the original baseline source manifest, and the removed observer is absent. An
independent `git apply --reverse --check` passes. [Independent verification](independent-verification.json) records
the manifest digest, checks and approved-probe assertions. The worker's final rollback-copy rehearsal restores
13 original files byte-for-byte and removes the two task-created files; no actual workspace rollback was performed.

## Findings (not fixed)

- None. The first final gate's four fixture typing errors and two old `chat-agent.test.ts` policy expectations were
  fixed and the final required checks passed. The fixture now uses the configured TypeScript library, explicit
  ToolSet inference and the actual SQLite named-parameter API. The two expectation updates retain the original
  partial/retraction/Timeline assertions and change only the owner-approved maintenance/throw semantics.

## Independent verification and checked boundaries

The exact original probe was rerun with a new evidence suffix; the original failure is preserved:

```powershell
node .trellis/tasks/10-21-ai-sdk-upgrade-baseline/research/recovery/abort-real-fetch-probe.mjs target approved-policy-review
```

Observed on Node v24.18.0 with installed AI 7.0.148 / compatible 3.0.75, real loopback HTTP SSE/global Node fetch,
actual SQLite/TimelineRepo/ConversationStore, no credentials and counted memory/usage sinks:

| Scenario | Actual repaired result |
| --- | --- |
| Cancel before first text | One request; one retraction; empty history; no primary witness, maintenance or usage |
| Cancel after `partial` | One request; graceful return; exact user + partial assistant history; one primary witness; maintenance 0; usage 0 |
| Read raw provider without SDK loop | Still rejects with APICallError whose cause is the string abort reason; Core does not invent that lost physical throw |

Evidence: `../recovery/abort-real-fetch-target-approved-policy-review.json`. The direct-provider case is diagnostic,
not a separate failure: accepting the SDK's graceful cancellation is part of the approved policy.

The maintained WS fixture was read through its actual wiring: real connection authentication and JSON-RPC
send/cancel handlers, queue/TurnRegistry, RunService/Receipt, activity projection, model/tool Effect services and
ConversationStore. Only provider content, memory/usage/image sinks and the fixture governance decision are controlled.
It checks nine scenarios: prefill, partial text, partial image, completed tool before partial cancel, resolving and
rejecting scripted bodies, successful text/image, and real HTTP 401. It asserts:

- prefill `chat.error{retracted:true}` with no rows/witness;
- partial `chat.complete` while Run, Attempt, Receipt and activity remain `cancelled`;
- no cancellation maintenance/image/usage callbacks, with ordinary success still calling eligible sinks;
- one unknown model Effect after cancellation, one model settlement event per physical request, completed earlier
  model/tool Effects retained, and exactly one tool execution without replay;
- preserved partial/tool history and primary witnessing; genuine 401 produces `chat.error` and failed outcome.

This fixture intentionally does not establish external-provider semantic behavior, authorization policy correctness
in isolation, actual image decoding or real memory extraction. Existing policy/usage/tool/persistence suites provide
their separately recorded coverage. The guard does not affect the actual `onPrimaryCommitted` source witness, so
it is not a claim that all memory ingestion has been disabled.

The existing error-only `onStepEnd` overflow predicate and private SDK `onError` callback remain unchanged from the
earlier review. Completed-step capture and refusal to replay completed tools remain in the same owners. Dependency
pins/required lock edges, nullable MCP normalization, Core pagination/deadline/late cleanup and the Windows relay
are unchanged by this repair. No new runtime dependency, schema or permission authority was introduced.

## Approved tradeoffs and limits

- Every signal-aborted turn skips the post-turn callback bundle, including previously graceful partial cancellation.
  The bundle includes post-turn request measurement, automatic maintenance, optional image description and usage
  callback. Exact eligible primary-source witnessing and later source-authorized processing remain intact.
- Partial real-fetch cancellation now keeps the SDK's normal iterator ending and normally emits `chat.complete`;
  internal cancellation outcomes stay truthful. No synthetic original throw is promised.
- Acceptance here is deterministic local integration/source review, not remote model quality, external production
  MCP acceptance, packaged desktop process visibility or owner UI/conversation acceptance. Later delegation and
  source-awareness requirements remain separate work.

## Verification

- Independent original real-fetch probe: **pass under the approved policy**.
- Focused maintained checks: **9 files / 69 tests passed**, `focused-final.json` / `focused-final.log`, including
  the maintained nine-scenario real WS/HTTP regression and updated old cancellation tests.
- Lint: **pass**, final root `pnpm lint`, 23.75 seconds.
- TypeCheck: **pass**, final `pnpm -r typecheck`, 35.58 seconds.
- Full bounded TS suite: **pass**, final `pnpm -r test --maxWorkers=4`, 224.46 seconds. Shared 674, CLI 50,
  Desktop 1,214 and Core 4,030: **5,968 passed, two existing skipped tests**; 769 passed files and one existing
  skipped file. Exact commands/exits are in `../final-verified/results-typecheck-lint-tests-bounded.json`, with
  full logs beside it. This reviewer inspected the completed results rather than duplicating the broad run.
- Earlier failing final records remain under `research/final/`; the corrected results above are under
  `research/final-verified/`. The pre-upgrade default-worker failures remain separately recorded, and neither
  those failures nor skipped tests are described as fixed by this upgrade.
- Real isolated Node Core boot: **pass**, `boot.json` records listener/socket success, zero model requests,
  no inherited model configuration, isolated data and successful owned-process cleanup.
- Earlier actual target Rust Clippy and 211 tests passed. No Rust change is part of this repair; no new Rust
  parity is inferred from TS-only source hash manifests. Worker verification separately compares 54 native/Cargo
  files with the passed recovery snapshot. The final SDK patch contains no native/Cargo source change.
