# S8-S10 Core/Shared implementation checkpoint — 2026-10-30

## Scope and authority

Implemented in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, under the coordinator's
session-bound `10-25-agent-delegation-conversations` task. The legacy global pointer was left unchanged.
Requirements 1-14, October 30 design and the independent check-in advisor remain the acceptance authority.
No task, Git delivery, dependency change, real-user database edit or provider call was performed by this agent.
No environment/credential file or memory file was read. JetBrains Context required login, so known source paths and
focused `rg` were used after that failed availability probe.

Actual inherited preimages are retained under `target/runtime-followup-20261030/preimages/`; nothing was restored
from HEAD. `target/runtime-followup-20261030/owned-files.json` enumerates changed source/spec paths against those
preimages. Root owns task status/deferred decisions, integration harnesses and final acceptance; Desktop had its own owner.

## Delivered contracts

- S8: idle executable/disclosed tools omit `delegate_subagent`, and the actual request explains its existing-child-only
  scope. Pre-intent failures retry at 1s/5s/15s plus fresh opportunities. Exhaustion persists per Character, is visible
  through `subagent.attention`, and supports explicit `subagent.inbox.retry`. Delivered members never return to automatic
  eligibility. Fresh/timer races coalesce; shutdown aborts timers without creating false exhausted-retry attention.
- Attention also projects unresolved `needs_user_input`, user-required check-ins and reconciliation-needed consumers.
  Handled escalation does not clear user attention; accepted trusted guidance to the exact work/request does.
  Existing authenticated reads/invalidation own Home observation; no Companion speech is fabricated.
- S9: ordinary model send resolves current work transactionally only when omitted. Explicit work is preserved, including
  historical work. Run/control drift is relaxed only for ordinary model messages; Continue/Stop/question answers retain
  strict exact targets. Refusals expose scoped current state/targets and next actions. Wrong-Character errors do not leak
  child summaries. Result and history model pages omit internal digests/receipts while canonical data stays unchanged.
- S10: migration 063 adds work progress, actual task-model intent/completion facts, check-in sidecars and attention.
  Completed steps include empty-message steps and remain unique across Runs/SDK rollovers/repeated callbacks. Failed
  provider retries cannot become extra completed steps. Utility calls contribute usage but not task steps.
- The ordered boundary preserves accepted final completion, ordinary question, check-in and pressure rollover precedence.
  Check-in snapshot/event/wait/ordinal commits atomically with the completed step, with no synthesis or fabricated collector.
  A checkpoint failure fences later dispatch. N=50/K=3 come from one constant and existing operator config; next-interval
  capture preserves active thresholds and existing user-required waits. Only exact explicit continuation resolves check-ins.
- Parent approvals count once; K=3 permits three and then requires the user. Direct authenticated guidance to that work
  resets approval count but does not implicitly reset N or resolve a wait. Core/system messages cannot approve check-ins.
  User Stop remains independent. Early answers and repeated completed callbacks preserve the producer's stop boundary.
- Child token aggregates read actual child-owned model Effects and usage across task and Utility executions, excluding
  parent inbox Runs. Missing/single-sided/in-flight totals remain unknown; any known subtotal is explicitly partial.
- Uniform Co-Watching support retains the existing natural SDK end plus owner validation. Natural final-on-N wins;
  continuing tool frontiers legitimately check in. Immutable `events.checkInForRun` handles an already-answered producer
  callback. Checkpoint continuation preserves artifact path/revision/edit and fresh owner revisions retain prior behavior.
  Actual testing found and fixed an inbox Character-lane release wake gap for an already accepted source continuation.
  Open check-ins still block automatic owner resume. Default-50 fixture preparation takes two task steps.

## Files and interface handoff

Shared: `subagent-progress-schema.ts`, `subagent-attention-schema.ts`, API/inbox/tool schemas and package exports.
Core: existing Agent/WorkContext/message-store boundaries, delegation service/query/inbox owners, new progress/check-in/
attention/usage repositories, config reader/registry/main injection, authenticated methods, and narrow Co-Watching adapter.
Tests are colocated. Folder indexes and the delivered `private-worker-checkin.md`, inbox/delegation specs were updated.
The existing S7 method test's `Promise.withResolvers` was replaced with equivalent explicit construction because the
current TypeScript lib rejects that API; its acceptance condition was retained.

Desktop/E2E interfaces: `SubagentSummary.progress` and nullable `tokenUsage`; pending request `reason`/`checkIn` pair;
`SUBAGENT_METHODS.attention` and `inboxRetry`; exact existing Continue target plus `replyToEventId`; inbox action
`continue_child`; knobs `TAKI_SUBAGENT_CHECKIN_STEPS` and `TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS`.
The API schemas enforce question/null versus check-in/non-null sidecar. An older missing usage projection defaults to
unknown, never zero. Progress carries its own work ID so current counters cannot masquerade as historical-work counts.

## Verification

All commands used locked dependencies and isolated synthetic databases/services. No native/full-workspace suite was run.

| Check | Result |
| --- | --- |
| `pnpm --filter @taki/core typecheck` | PASS, final run after source/config/test fixes |
| `pnpm --filter @taki/shared typecheck` | PASS, final run |
| `pnpm exec eslint` over every TS path in the owned-files manifest | PASS; later small changed paths also rechecked |
| Shared `subagent-schema.test.ts` + `subagent-progress-schema.test.ts` | 6 PASS |
| 15-file Core integration selection below | 96 PASS |
| Subsequent four impacted suites: check-in, Co-Watching adapter, retry and retry-timer | 20 PASS |
| Final check-in suite after early-answer race addition | 9 PASS; repeated callback/early-answer case also rerun PASS |
| Final retry/retry-timer suites after shutdown guard | 6 PASS |
| Config reader after default constant consolidation | 1 PASS |
| `git diff --check` over owned source/spec directories | PASS; CRLF-to-LF notices only |

The 15-file integration command:

```powershell
pnpm --filter @taki/core exec vitest run src/harness/subagent-checkin.test.ts src/harness/subagent-followup-contracts.test.ts src/harness/subagent-inbox-retry-timer.test.ts src/harness/subagent-service.test.ts src/harness/subagent-interactive.test.ts src/harness/subagent-inbox-recovery.test.ts src/db/subagent-repo.test.ts src/db/subagent-inbox.test.ts src/db/migrations/058-agent-inbox.test.ts src/db/migrations/063-subagent-progress.test.ts src/server/methods/subagent-methods.test.ts src/config/subagent-config.test.ts src/co-watching/child-adapter.test.ts src/agents/chat-agent-worker-context.test.ts src/agents/chat-agent-step-recording-failure.test.ts
```

Additional targeted commands use the same `pnpm --filter @taki/core exec vitest run` prefix and the named suites above.
N=50 test crosses real SDK compaction segments in one Run, includes actual Utility Effect usage, and stops at exactly 50
completed task steps. Co-Watching low-N tests use actual SDK and governed `write_file`; native/browser inputs remain
synthetic. Migration 058's populated legacy evidence test now upgrades through 063 without changing historical rows;
063 separately verifies file reopen, unchanged prior receipts and no emitted execution/model work.

## Remaining acceptance and limits

- Root's independent combined review, full integrated application boot, E2E and real-model campaign remain separate.
  A clean typecheck is not a real boot; the coordinator owns isolated startup/campaign configuration.
- Human/native UI acceptance, native Hindsight and T4/main migration convergence remain unpassed, as before.
  `git show main:.../migrations/index-list.ts` verified main's divergent 049-059 history before reserving T4 063.
- Legacy exact historical task counts are unknowable; post-upgrade tracked intervals are explicitly labelled.
- Factual snapshots preserve evidence but may lack freshly reasoned next steps. No extra model call is hidden in check-in.
- No framework, new owner/executor, new task, commit/push/reset, real-user data mutation or external service change was added.

## Bounded full-suite expectation repair — 2026-10-30 17:38

The coordinator's completed full workspace run passed Shared (684), CLI (50) and Desktop (1274), then reported
18 Core failures with 4,231 passing and six skipped tests. The final assertion diffs identified stale independent
expected migration tails/version counts and two missing operator knob names; no production/data failure was shown.
After the run settled, the coordinator released exactly seven failed test files for repair:

- `config/knob-registry.test.ts`: add both check-in knob literals to the exact known-key and live-apply lists;
  expected registry size changes from 84 to 86. Secret/default/schema/metadata assertions remain intact.
- `db/pending-memory-repo.test.ts` and `db/scheduled-task-repo.test.ts`: append literal 63 to the expected upgrade tail.
- `db/migrations/041-canonical-memory-maintenance.test.ts`, `048-memory-operations.test.ts`, `index-list.test.ts`
  and `lineage-reopen-matrix.test.ts`: append literal 63 to expected tails, assert final version 63, and update the
  fresh lineage receipt count from 61 to 62 (version 59 remains deliberately absent).

No helper refactor, production/config implementation or migration SQL changed. Expectations are independently pinned,
not derived from the registry under test. Populated-data, byte-preservation, historical receipt timestamps, lease,
replay, metadata and no-op reopen checks were retained unchanged.

Preimages, the exact seven-file patch and focused output are saved under
`target/agent-delegation-20261030-validation/migration-expectations/` as `preimages/`, `expected-lists.patch`,
`files.json` and `focused-tests.log`. Scoped ESLint and `git diff --check` passed. The following command passed
all seven suites and all 57 tests:

```powershell
pnpm --filter @taki/core exec vitest run src/config/knob-registry.test.ts src/db/pending-memory-repo.test.ts src/db/scheduled-task-repo.test.ts src/db/migrations/041-canonical-memory-maintenance.test.ts src/db/migrations/048-memory-operations.test.ts src/db/migrations/index-list.test.ts src/db/migrations/lineage-reopen-matrix.test.ts --maxWorkers=4
```

These seven test files are frozen again. The coordinator owns the complete Core rerun; this focused pass does not
claim that rerun has completed.
