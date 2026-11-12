# SDK upgrade implementation and verification

Date: 2026-10-22. Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.

Status: the exact SDK upgrade and the owner-approved cancellation policy are applied. Final focused tests, typecheck, lint, bounded workspace tests, real Node boot and [independent final review](final/independent-review.md) passed. SDK implementation acceptance is complete; task archive/transition remains coordinator-owned. No live-model or owner UI acceptance is claimed.

## Exact dependency result

| Dependency | Captured installed baseline | Exact installed target |
| --- | --- | --- |
| `ai` | 7.0.17 | 7.0.148 |
| `@ai-sdk/mcp` | 2.0.10 | 2.0.81 |
| `@ai-sdk/openai-compatible` | 3.0.5 | 3.0.75 |
| `@ai-sdk/provider` | 4.0.2 / 4.0.3 | 4.0.31 |
| `@ai-sdk/provider-utils` | 5.0.5 / 5.0.7 | 5.0.65 |
| `@ai-sdk/gateway` | 4.0.13 | 4.0.121 |
| `undici` | absent | 7.30.1 |

Node is v24.18.0, pnpm 10.22.0 and Vitest 4.1.10. Zod 4.4.3, cross-spawn 7.0.6, pkce-challenge 5.0.1, eventsource-parser 3.1.0, standard-schema 1.1.0 and workflow/serde 4.1.0 are unchanged. MCP adds its required cross-spawn edge; provider-utils adds undici. No optional Harness/Workflow runtime was adopted.

Exact direct pins trade automatic direct updates for reproducibility. The [working-lock diff](reviewed-lock.diff) contains only the SDK family and required edges, preserving the already dirty lock. [Lock generation](lock-generation.log) and [frozen install](frozen-install.log) completed. [Final installed inventory](final-verified/inventory.json) exactly matches the verified target graph, entirely within this worktree.

## Final changed files and ownership

The [complete final patch](final/sdk-scope.diff) and [15-file list, hashes and original preimages](final/source-complete.json) compare the captured working state, never HEAD. They contain:

- `packages/core/package.json` and `pnpm-lock.yaml`: exact package/required transitive changes.
- `packages/core/src/agents/chat-agent.ts`: empty-error-step retry predicate, private SDK error callback and approved Core cancellation guard.
- `packages/core/src/agents/chat-agent.test.ts`, `chat-agent-usage.test.ts`, `run-observability-telemetry.test.ts`: narrowly update four assertions affected by the explicitly approved cancellation behavior; retain partial/retract/real-error and Effect checks.
- `packages/core/src/agents/sdk-wire-compatibility.test.ts` (new): real compatible-provider serialization/SSE and aggregate abort coverage.
- `packages/core/src/server/methods/chat-send-sdk-transport.test.ts` (new): real HTTP/global Node fetch/authenticated WebSocket integration, SQLite transcript/witnesses, Run/Receipt/activity and model/tool Effects.
- `packages/core/src/mcp/mcp-http.test.ts`: structured-only results and delayed modern discovery, using valid modern protocol envelopes.
- `packages/core/src/testing/mock-language-model.ts`: correct the historical rejecting-body explanation; no model factory behavior changes.
- `packages/core/src/agents/index.md`, `packages/core/src/mcp/index.md`, `packages/core/src/server/methods/index.md`, `packages/core/src/testing/index.md`: update their existing module entries.
- `.trellis/spec/backend/agent-runtime.md`: distinguish old SDK transport behavior from the approved Core cancellation contract and required real-transport coverage.

The earlier task-created `provider-stream-failure.ts` was removed after checking its exact absolute path and owned SHA-256. Its ineffective observer and the associated 363-line allowance are absent; normal production line limits pass. That temporary file is not part of the final 15-path net change.

Child PRD/design/implementation checklist, task compatibility metadata and task-local evidence were also updated. Root-added metadata fields are preserved. No parent/global/unrelated source was changed.

## Compatibility decisions

1. SDK `onStepEnd` can now fire for an empty error response. Such a response is not completed work for the existing one clean overflow retry. Immediate step-response capture and completed-tool no-replay fences remain unchanged.
2. The SDK's default streaming error callback may print a raw provider exception. The per-call `onError` suppresses that fallback while the exact public error still reaches Core. A regression checks exception identity and no console disclosure.
3. Independent real-fetch testing proved the old observer insufficient: SDK immediate cancellation can close its reader before a physical fetch error crosses provider transforms, and new provider-utils wraps raw body errors. In the old baseline, a partial string abort threw and started no maintenance; the first target attempt returned gracefully and started one maintenance pass. This P2 was not dismissed despite earlier green mocks.
4. On 2026-10-22 the owner explicitly approved the [concrete policy proposal](recovery/cancel-policy-proposal.md). After original persistence, retraction and surfaced failure handling, Core invokes `state.afterCommit` only when its signal is not aborted. The post-turn bundle consists of pressure remeasurement, auto-memory/compaction maintenance, optional image-description maintenance and detached turn-usage reporting.
5. This is **not suppression of all memory ingestion**. `finishRecordedTurn` still witnesses exact retained eligible primary user/assistant/tool rows through `onPrimaryCommitted`. Existing Memory eligibility, source authority and later processing are unchanged. A cancelled partial conversation is retained; an empty cancelled turn retracts.
6. The public SDK cancellation ending is accepted without a synthetic throw or timing workaround. Real-fetch partial cancellation now normally emits `chat.complete`; Run/Attempt/Receipt/activity still settle `cancelled`. The old `chat.error` string-throw path and graceful-abort maintenance eligibility were explicitly changed by the approved decision. Genuine HTTP 401 still emits `chat.error` and settles failed. These notification outcomes are now exercised over actual WebSocket transport, beyond the proposal's earlier source-only inspection.
7. Core MCP pagination, schema isolation, deadlines/late cleanup, leases, governance and Node/Tauri stdio relay remain in place. New upstream timeout/concurrency options were not enabled or turned into unrelated acceptance work.

## Verification and failure attribution

Recovery initially matched all 2,091 source entries and six dependency/configuration hashes to the interrupted target. The final runtime changes were then verified against the approved policy. Existing failures and invalidated intermediate results remain retained.

| Check | Baseline | Final evidence |
| --- | --- | --- |
| Focused existing compatibility baseline | 33 files, 288 tests passed | Included in full final suite |
| Maintained focused cancellation/provider/Effect checks | Historical behavior captured | [9 files, 69 tests passed](final/focused-final.log) |
| Real HTTP + authenticated WS matrix | Original/target behavior recorded separately | 9 cases passed: prefill, partial text/image, completed-tool-then-partial, graceful/rejecting fixtures, ordinary success text/image and real 401 failure |
| `pnpm -r typecheck` | Passed | Passed; [final result record](final-verified/results-typecheck-lint-tests-bounded.json) |
| Root `pnpm lint` | Passed | Passed; same final result record |
| `pnpm -r test` default workers | Core 41 failed, 3,968 passed, 2 skipped | Not repeated; matched four-worker comparison used |
| `pnpm -r test --maxWorkers=4` | 5,947 passed; Core 4,009 passed, 2 skipped | 5,968 passed; Core 4,030 passed, 2 skipped; 224.46 s; [final results](final-verified/results-typecheck-lint-tests-bounded.json) |
| Clippy `-D warnings` | Passed | Recovery target passed; all 54 native source/Cargo/build fingerprints remain identical |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | 211 passed | Recovery target 211 passed; same verified fingerprint reuse |
| Real isolated Node Core boot | Listening/socket connection; zero model requests | [Final boot](final/boot.json): same, no provider credentials or `.env` inheritance |
| Scoped rollback | Captured working preimages | 13 originals restored byte-for-byte and two new files removed in task-owned copies |

The maintained transport suite uses the real compatible adapter/global fetch, local HTTP SSE, real authenticated WebSocket server/methods, ConversationStore/SQLite, RunService/Receipt/activity and model/tool Effect owners. Only snapshot metadata, the fixture's positive permission decision and detached callback sinks are supplied test values. It checks one witness for retained rows, zero witness for retraction, no cancelled callback invocation, one model settlement per request, and exactly one completed tool Effect before a cancelled continuation. It does not claim full UI or external-provider acceptance.

Before applying the policy, the finalized transport fixture had five expected failures and four passes ([red evidence](final/transport-red.log)). After application all nine pass. The first broad final attempt caught four fixture typing issues plus two old `chat-agent.test.ts` expectations; those were corrected only under the approved semantics. The failed logs remain in `final/`; replacement checks live in `final-verified/`.

Final workspace totals are Shared 674, CLI 50, Desktop 1,214 and Core 4,030 passed (769 passed files plus one existing skipped file). The default-worker baseline's 41 failures are not claimed fixed. All existing Core tests passed with four workers before upgrading, so comparison uses that same configuration. The original two skipped tests remain outside acceptance.

[Final verification metadata](final/verification.json) records dependency equality, native fingerprint parity and rollback checks. [Recovery platform exits](recovery/results-clippy-rust-tests.json) identify the reused Clippy/Cargo execution. `run-checks.py` records commands/exits/durations and strips inherited TAKI/model/live-test settings.

The real boot uses Node's strip-only entry, disposable task-owned data and a random loopback port. An owned HTTP trap receives zero inference requests. Its owned process tree is explicitly stopped; child exit code 1 follows taskkill, while listening/socket success and `stop.exitCode=0` establish startup/cleanup. No live data or external endpoint is used.

## Scoped rollback

Use [final/source-complete.json](final/source-complete.json) to verify current paths and locate original working preimages. The source/spec reverse patch was checked and actually applied only to disposable copies; all 13 originals matched their saved bytes and the two new test files were absent afterward. Installed dependency rollback was not rehearsed.

If rollback is selected later:

1. Stop only owned test/Core processes. Compare current owned hashes and preserve any newer edits. Reconcile only SDK hunks if a path changed; never overwrite unrelated work from a backup.
2. Review `final/sdk-scope.diff`, then run `git apply --reverse --check -- .trellis/tasks/10-21-ai-sdk-upgrade-baseline/research/final/sdk-scope.diff`. Apply only the reviewed, still-applicable reverse patch. New files may be removed only while still task-owned.
3. Run `pnpm install --frozen-lockfile` against the restored working lock, re-inventory old resolutions and run the focused baseline. Missing local cache may require registry access. Do not reset to HEAD, clean/stash the workspace, delete node_modules recursively or use another worktree.
4. Keep evidence and newer unrelated edits. SDK rollback does not undo external actions or erase unknown Effect records.

## Remaining scope limits

No paid/model calls, external production MCP acceptance, packaged desktop visibility trial or owner UI/conversation acceptance was performed. Local real HTTP/WS, deterministic downstream suites and real isolated Core boot are the recorded integration levels. Generic Subagent Memory restrictions and delegation/source semantics belong to the next parent-owned work; they were not mixed into this package repair.

No commit, push, archive, parent task mutation or live-data mutation occurred.
