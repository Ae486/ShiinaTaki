# Independent SDK upgrade review

Date: 2026-10-22. Reviewer scope: the nine SDK-owned files in `source-complete.json`, compared with
the captured working preimages through `sdk-scope.diff`; HEAD was not used as the baseline.
Workspace/branch verified: `H:/TakiAgent-worktrees/t4`, `task/t4-skills-mcp-productization`.

**Historical finding; repaired boundary review is [here](../final/independent-review.md).** The owner subsequently
approved an explicit Core cancellation policy, and the independent original transport probe now confirms that policy.
The findings below preserve the original reviewed state and evidence; consult the linked final review for gate status.

**Original disposition: one confirmed P2 compatibility blocker.** Existing broad checks pass, but a matched real-fetch
probe reproduces an introduced cancellation/maintenance change. The coordinator assigned repair to the
implementation worker; this reviewer has not edited production source. A final repaired-source review is pending.

## Findings (fixed)

- No production fixes made by this reviewer. The already completed local `max-lines=363` correction is valid under
  the existing numeric, exact-file allowance rule. Its reason identifies turn-owner retry/capture/commit ordering;
  it does not justify additional unreviewed growth or disable unrelated checks.

## Findings (not fixed)

### P2 — real HTTP cancellation bypasses the new observer and triggers detached maintenance

- Classification: **real defect**, reproduced against the captured old source and exact original package graph.
- Files: `packages/core/src/agents/chat-agent.ts:380` and `:384`; supporting new middleware
  `packages/core/src/agents/provider-stream-failure.ts:12`.
- Trigger: the actual OpenAI-compatible provider consumes an HTTP SSE text delta; the caller then aborts with
  `"turn cancelled by operator"`, the value used by production `turn-registry.ts:42`.
- Baseline: AI 7.0.17 / compatible 3.0.5 rethrows the exact cancellation reason. The real ConversationStore keeps
  the plain user input and consumed partial assistant text, invokes the exact-primary commit witness once, and
  never invokes `autoMemory.onTurnCompleted`.
- Target: AI 7.0.148 / compatible 3.0.75 with the reviewed patch returns normally, keeps the same rows and witness,
  and invokes `autoMemory.onTurnCompleted` once. That hook is behind `state.afterCommit`, so restoring rows alone
  does not preserve the previous cancellation behavior. The probe counts the hook; it does not claim an actual
  remote memory/model operation occurred.
- Root cause: installed `ai/src/generate-text/stream-text.ts:1933` immediately rejects aggregate promises and
  cancels its stitched reader. Cancellation traverses the adapter's stream transforms before the physical fetch
  rejection reaches the middleware reader. The wrapper therefore cannot record that failure, and the check at
  `chat-agent.ts:380` falls through to the normal detached-write path. In the initial direct wrapper probe,
  the observer was still unset at public-stream completion and after another 20 ms.
- Additional source/transport distinction: direct provider reads without ToolLoopAgent still reject on both
  graphs. The old provider exposes the raw string; the target provider exposes
  `AI_APICallError("Failed to process successful response")` whose `cause` is the same string. This is why the
  synchronous `abortRejectingModel` alone is insufficient evidence for the target transport stack.
- Prefill cancellation is unaffected in the matched probe: both graphs retract, leave no Timeline row, invoke
  no commit witness/maintenance/usage sink and make one model request.
- Requested repair: restore the supported no-detached-write throw ending on the actual transport and retain
  existing graceful-abort behavior, partial persistence and bounded stalled-provider cancellation. Do not replace
  this distinction with an unconditional abort write suppression or an arbitrary timer. If the distinction is
  intentionally replaced by explicit Core policy, record and resolve that real semantics decision first.
- Why not fixed here: source ownership is with the implementation worker while coordinated verification runs.
  The blocker, exact commands and evidence were sent to the coordinator and that worker immediately.

### Reproduction and evidence

Run from the verified worktree root:

```powershell
python .trellis/tasks/10-21-ai-sdk-upgrade-baseline/research/recovery/materialize-cached-baseline.py
node .trellis/tasks/10-21-ai-sdk-upgrade-baseline/research/recovery/abort-real-fetch-probe.mjs baseline
node .trellis/tasks/10-21-ai-sdk-upgrade-baseline/research/recovery/abort-real-fetch-probe.mjs target
```

The materializer copies only the five original packages' published runtime JS/package manifests from the existing
pnpm content-addressed store into `abort-baseline/node_modules`, checking SHA-512 for every copied file. It installs
nothing, makes no network request, runs no lifecycle scripts, and changes no workspace manifest, lock or node_modules.
`abort-baseline/cached-integrity.json` records all 14 verified files. Resolution hooks select the exact baseline
AI/provider graph and original ChatAgent preimage; other code and unchanged dependency versions remain constant.

The probe uses Node v24.18.0, global Node fetch, a real loopback HTTP SSE server, actual `openDatabase(:memory:)`,
all real migrations, TimelineRepo and ConversationStore. Memory/model side effects are counted sinks and no
credential is configured. Both public source cases and direct-provider isolation use one model request each.

| Scenario | Baseline | Reviewed target |
| --- | --- | --- |
| Abort before first text | Retract; empty history; maintenance 0 | Same |
| Abort after `partial` | Exact string throw; user + partial assistant; maintenance 0 | Normal return; same history; maintenance 1 |
| Direct provider read, no SDK loop | Raw string rejection | APICallError with exact string cause |

Machine-readable evidence: `abort-real-fetch-baseline.json` and preserved `abort-real-fetch-target-before-repair.json`.
Use the optional third script argument (for example `target after-repair`) for later evidence without replacing the
recorded failing result.
The script and evidence are task-owned. No external provider, live data or paid inference was used.

## Checked requirements and nonblocking decisions

- Read the original child/parent PRDs first, child design/implementation/check contexts, all curated backend
  specs, planning brief and readiness review. The session's explicit child path supersedes the stale avatar pointer.
- **Scoped dependency update:** exact direct pins 7.0.148 / 2.0.81 / 3.0.75; provider 4.0.31, provider-utils 5.0.65,
  gateway 4.0.121 and required undici 7.30.1. The reviewed baseline-relative lock only changes this package family
  and required edges, preserving the original QQ management-client local-tarball resolution/integrity. Exact pins
  are an accepted reproducibility tradeoff; no Workflow/Harness runtime is adopted.
- **Error-only overflow retry:** installed SDK `onStepEnd` receives an empty `finishReason="error"` step before
  the public error. The new predicate preserves one clean overflow retry while completed content/tool steps retain
  the replay fence. `turn-recording.ts` still captures each step once and commits from the outer `finally`.
  Existing tests cover error-part/thrown overflow, one retry, partial-output refusal, completed-tool refusal and
  admission-captured context reuse; no second execution authority was introduced.
- **Ordinary error privacy:** installed streamText defaults to raw `console.error(error)`. ToolLoopAgent's actual
  `prepareCall` spreads the returned `onError` into streamText. The no-op callback suppresses that fallback without
  removing public error parts; the exact exception/no-console test covers it. This does not settle the distinct
  transport cancellation blocker above.
- **Tool/Effect preservation:** the new observer executes no tool, creates no Effect and performs no retry.
  Existing governed tool assembly, disclosure, immutable invocation bridge and model Effect middleware remain
  their owners. Added graceful/rejecting partial-cancel tests assert one terminal unknown model Effect and one
  settlement event; their normalized mock scope is explicitly narrower than real fetch.
- **Actual provider fixtures:** tests use the installed compatible adapter with serialized SSE/fake fetch, checking
  complete `12` arguments instead of early `1`, sparse/repeated wire IDs, distinct persisted identities, ordered
  results and zero execution on unsafe finishes. The stalled-cancel test checks SDK aggregate settlement directly;
  it does not by itself verify ChatAgent's additional observer/maintenance boundary.
- **MCP fixtures/retained adapters:** loopback HTTP cases exercise real defaultConnect/manager/namespaced tool
  execution, structured-only results and delayed modern discovery with required success envelopes. Existing
  Core `listTools` pagination, nullable isolation, candidate deadline/late cleanup, captured generation leases and
  Node/Tauri stdio relay remain unchanged. No setting/permission/template migration was introduced.
- **Rollback:** seven saved source/manifest/lock preimages and two task-created files are fully identified.
  Current nine-file SHA-256 values matched the review snapshot before further repair. The recorded reverse-patch
  rehearsal operates only on task-owned copies and restores the seven original byte sequences. Instructions
  correctly require current-hash/concurrent-edit checks and a frozen reinstall for real dependency rollback.
  The installed graph was not rolled back or claimed rehearsed.
- **Spec synchronization:** existing quality/logging/runtime specs already state the relevant authority and privacy
  contracts. After repair, synchronize the actual cancellation decision and highest-observable regression requirement
  in the existing runtime guidance; do not retain a claim that synchronous mock rejection proves real transport behavior.

## Verification

- Lint: **pass**, inspected `results-typecheck-lint-tests-bounded.json` and `lint.log` (root `pnpm lint`).
- TypeCheck: **pass**, same result manifest and `typecheck.log` (`pnpm -r typecheck`).
- TS tests: **pass for existing recorded suites**, `pnpm -r test --maxWorkers=4`: Shared 674, CLI 50,
  Desktop 1,214, Core 4,021; total 5,959 passed and two existing skipped tests. This reviewer did not rerun broad
  checks. Baseline bounded total 5,947 passed; baseline default-concurrency failures are separately retained.
- Independent compatibility probe: **fail**, confirmed P2 above despite existing suites passing.
- Rust: **pass**, actual recovery Clippy and Cargo test exit records inspected (211 tests). Baseline source hashes
  do not contain Rust files, so this conclusion uses actual target platform evidence, not invented hash parity.
- Real Node boot: **pass within recorded startup scope**, baseline and target listening + socket connection,
  no `.env` inheritance, isolated data and zero model requests; explicit owned-tree termination explains exit code 1.
- Remaining limits: no remote-provider semantic acceptance, external production MCP trial, packaged desktop process
  visibility test or owner UI/conversation acceptance. Later delegation/source requirements are outside this SDK child.

Passing gates and faithful Timeline rows do not close the reproduced maintenance regression. Compatibility acceptance
remains open until the coordinated repair passes the matched real-fetch case and preserves the existing graceful case.
