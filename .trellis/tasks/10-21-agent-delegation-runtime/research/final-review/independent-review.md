# Runtime/Desktop bounded independent review

Date: 2026-10-23. Reviewer: `delegation_independent_check`.

Disposition: **No new confirmed defect in the completed bounded review; 37 independent deterministic regressions passed.** This is not a complete parent acceptance or final whole-workspace quality gate. The owner's latest instruction was to finish the current tests and pause. No new live scenario, paid rerun, broad regression campaign, commit, push, reset, clean, release or task archive was started.

## Scope and working state

- Verified cwd `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, and the actual worktree list. Native `task.py current --source` reported no child-session binding. The explicit coordinator assignment to `10-21-agent-delegation-runtime` was used; the stale legacy Avatar `.current-task` was left unchanged.
- Read the original parent PRD, Runtime PRD/design/implementation plan and curated check context, relevant joint-contract sections 3-7/11/13, and the S1/S2/S7 implementation/review evidence. G1-G4 and R14 remained the acceptance basis rather than implementer assertions.
- The final bounded scope was canonical terminal/admission wiring and independent controls; actual input receipts and Memory selection; Desktop exact-target/reconnect mutations; and parent E2E opt-in, request budget, evidence, cleanup and attribution. Source rendering, Co-Watching policy, Memory hash/ingestion changes and the Source A1-A3 campaign remained with their owner.
- No production, test-source, Shared, specification or task-status file was changed by this review. Only this report and three test result artifacts were created. No fix preimage was needed. Existing dirty work was preserved.
- No source freeze was requested because this review made no source changes and ran only local deterministic regressions. These are scoped execution results, not a claim that the entire concurrently edited tree was frozen or fully retested.

## Findings (fixed)

None. The completed checks did not establish a new production or test defect requiring a patch.

## Findings (not fixed)

None confirmed in the completed bounded scope. The unverified areas listed below are coverage limits, not speculative defect findings.

## Independently checked paths

| Boundary | Actual code and observed result |
| --- | --- |
| Terminal participation and production installation | `main.ts` constructs `RunRepo` with `subagentExecutions.linkedState`; `run-repo.ts` sends start, dispatch refusal and ordinary settlement to `run-terminal-transition.ts`. `settleRun` computes cancellation-adjusted outcome, writes linked terminal state inside the SQL transaction, and schedules notifications through `db.afterCommit`. Existing S1 fault-injection evidence was read, not rerun. |
| Private child lifetime and exact controls | `subagent-service.ts`/`subagent-execution.ts` retain child-owned controllers and scope keys. Parent cancellation does not abort them. User stop commits its latch before abort; explicit continuation checks work expiry/source currentness before accepting an input or clearing the latch. The 17-test Core run exercised parallel child survival, selected child stop, user-only continuation, expired/retired-source refusal and terminal identity preservation. |
| Completion admission and independent work | `subagent-completion.ts` scans durable completion rows, acquires the ordinary Character background lane, rechecks the exact work and admits under `subagent-completion:<completionId>`. Parent execution uses fresh main-role context and an explicit result collector; report publication is a later owner. Tests proved record-only produces no parent call, stopped original parent does not prevent one new eligible continuation, internal/no-action produces no relationship speech, and unrelated B does not supersede A. |
| Effect receipt and private history | `run-message-store.ts` separates preparation from `commitModelInput`; `chat-agent.ts` forwards the actual prepared model Effect through `run-observability-telemetry.ts`/`model-effect-middleware.ts`. The SDK/SQLite test observed pending addressed input before the next actual request, then its receipt and complete material in the subsequent model input once. The private path did not call primary witness/maintenance callbacks. |
| Fixed child Memory exclusions | `run-snapshot-capture.ts` captures `memoryToolExclusions` from trusted metadata before projecting the child Memory tool bag. `delegation-tools.ts` permits only captured fixed exclusions among removed explicit names; unknown names still refuse. `agent-tool-assembly.ts` enforces the final SDK lookup and `executable-tool-selection.ts` carries that lookup into `extension-registry.ts` indirect calls. The actual snapshot/SDK/SQLite regression executed recall, excluded canonical mutations and a metadata alias, preserved provider capability facts, and retained explicit empty selections. Additional tests denied excluded MCP/Skill/capability aliases through `extension_call` and retained main-continuation mutation authority. |
| Restart and uncertain execution | `subagent-recovery.ts` recognizes linked child/parent Runs, classifies unfinished Effects and records honest terminal results. It does not infer whole-work success from a completed model Effect. `workHasUncertainEffects` refuses automatic non-model Effect replay. Existing recovery regressions passed; a hard-kill end-to-end recovery campaign was not rerun. |
| Desktop mutation lifecycle | `subagent-controller.ts` compares child/work/control-version/nullable Run identity, serializes actions, retires old generations and does not resubmit after disconnect. `subagent-state.ts` supplies the displayed target; reads wait for acknowledged observation. Eight controller regressions passed for target changes, exact stop/continue/send, lost acknowledgement, stale-target versus read failure, hidden pending mutation and subscription retry. This run was not a rendered WebView2 trial. |
| Parent E2E evidence contract | Read `agent-context-real.e2e.test.ts`, `agent-context-runtime.e2e.test.ts` and `fixture/agent-context-scenario.ts`. Real calls require both explicit opt-in and credentials. Synthetic requests are captured before forwarding with finite budgets; budget/capture failures, deadline, source drift or cleanup failures fail otherwise passing acceptance. Cleanup attempts independent closers and retains the original failed scenario. Concurrent Effect candidates are explicitly not exact request attribution. All 12 local HTTP observer regressions passed, including capture/budget refusal, backpressure, cancellation and bounded diagnostics; they used no external model. |

The delayed reply's real accepted-root publication, retained acquired-material selection and S7 rendered/native evidence were inspected through their existing reports and key integration seams. They were not independently re-executed in this shortened closeout. The first failed R3 and repaired R3 remain separate in the coordinator's acceptance checkpoint; this review does not relabel the failed trial or merge its usage into a passing subtotal.

## Verification

Environment for this run: Windows PowerShell, Vitest `4.1.10`; all executed test file paths in the result JSON are under the T4 worktree. Node/provider version and real-model observations remain in the existing acceptance artifacts.

| Check | Result and evidence |
| --- | --- |
| Core controls/completion/recovery/selection | **PASS**, 4 files / 17 tests. [core-regressions.json](core-regressions.json). |
| Desktop controller | **PASS**, 1 file / 8 tests. [desktop-regressions.json](desktop-regressions.json). |
| Local provider observer | **PASS**, 1 file / 12 tests. [observer-regressions.json](observer-regressions.json). No upstream external model calls. |
| Lint | **PASS in the cited scope; not rerun by this reviewer.** Source's final manifest-scoped ESLint exited 0; [checks-final.json](../../../10-21-agent-source-context/research/s5-s6-recovery/checks-final.json) and `lint-final.log` record the command/result. Prior Runtime/Desktop scoped passes are documented in [S2/S3](../s2-implementation.md) and [S7](../s7-implementation.md). This is not a newly executed root lint gate. |
| TypeCheck | **PASS, externally executed and explicitly attributed.** Source's final `pnpm --filter @taki/core typecheck` and `pnpm --filter @taki/shared typecheck` both exited 0 (`typecheck-final.log`, `shared-typecheck-final.log` beside the same checks file). S7 documents its final Desktop pass. The coordinator explicitly requested no duplicate static-check run. |
| Complete workspace / Rust / new production boot / native UI / paid E2E | Not rerun in this bounded review. Existing evidence remains separately attributed. The user's pause instruction prevents treating this scoped gate as final integrated acceptance. |

Commands executed from `H:/TakiAgent-worktrees/t4`:

```text
pnpm --filter @taki/core exec vitest run src/harness/subagent-service.test.ts src/harness/subagent-completion.test.ts src/harness/subagent-recovery.test.ts src/harness/delegation-tools.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile=../../.trellis/tasks/10-21-agent-delegation-runtime/research/final-review/core-regressions.json
pnpm --filter @taki/desktop exec vitest run src/features/subagents/subagent-controller.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile=../../../.trellis/tasks/10-21-agent-delegation-runtime/research/final-review/desktop-regressions.json
pnpm --filter @taki/e2e exec vitest run src/fixture/real-provider-observer.e2e.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile=../.trellis/tasks/10-21-agent-delegation-runtime/research/final-review/observer-regressions.json
```

The Desktop command above records the exact executed command, including a reporter-path error. It executed the correct T4 test but placed its new JSON one directory too high. After validating that it contained exactly 8 passing tests and only T4 Desktop execution paths, the reviewer moved only that generated file:

- Source: `H:/TakiAgent-worktrees/.trellis/tasks/10-21-agent-delegation-runtime/research/final-review/desktop-regressions.json`
- Target: `H:/TakiAgent-worktrees/t4/.trellis/tasks/10-21-agent-delegation-runtime/research/final-review/desktop-regressions.json`

Outside-tree activity was limited to the reporter-created path and relocation of that generated JSON. No source file or pre-existing outside-tree content was changed, and no directory was removed. A future Desktop reporter command should use `../../.trellis/tasks/10-21-agent-delegation-runtime/research/final-review/desktop-regressions.json` from that package; this report does not claim a rerun with the corrected spelling.

## Remaining limits and handoff

- This result does not close all parent AC02-AC11. Source A1-A3, remaining accepted playback/native Memory semantics and final integrated verification belong to their existing owners; this review neither starts nor passes them. Source reported A1-A3 had not started and made zero actual requests. Its 290 passing unique scoped cases aggregate the latest result per file/full test name across six reports; they are not this review's 37 tests and not a single full-suite run.
- Full S1 rollback/COMMIT failure, acquired-material/replay/reduction paths, direct accepted-root reply publication, arbitrary transcript size, hard process loss and comprehensive rendered/accessibility behavior were not independently rerun here. Existing deterministic/live/native evidence must retain its stated limits.
- The current T4 migration lineage and main from 049 onward remain explicitly incompatible. No main integration, destructive rollback or compatibility claim was introduced.
- No human acceptance criterion was marked passed. No model reliability claim follows from scripted SDK/WS or local HTTP tests; no UI usability claim follows from controller tests or a build.
- Runtime/Desktop/E2E ownership is released to the coordinator after this report. The reviewer stops here under the owner's current pause instruction. The coordinator may consolidate the separately attributed Source static/test evidence without treating this review as whole-project acceptance.
