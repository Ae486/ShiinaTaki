# S1 independent persistence and API review

Date: 2026-10-22. Disposition: **PASS for the S1 foundation and S2/S3 ownership handoff**.
This is not acceptance of a working delegation feature, recovery policy, Memory tool restriction, or conversation UI.

## Scope and authority

Reviewed the original parent PRD R02-R08/R12-R14, `docs/AGENT-DELEGATION-RESEARCH.md` G1-G4,
the Runtime PRD/design/implementation plan, joint Runtime/source contract sections 3-7/11/13,
`s1/after-commit-review.md`, curated check context, and the backend DB/lifecycle/quality contracts.
The explicitly assigned active task governs this review; the global task pointer still names the historical avatar task.
Workspace and branch were verified as `H:/TakiAgent-worktrees/t4` and `task/t4-skills-mcp-productization`.

The implementation handoff contains 33 source/test/index files. All 17 existing-file preimages matched their saved
SHA-256 values, and all 33 handed-off current files matched `changed-files.json` before the final gates. The baseline
is the actual dirty working tree in `preimages/`, not HEAD. The implementation delta is `s1-working-baseline.diff`.

During the initial read-only review, two production defects were reproduced with real `:memory:` SQLite and production
repositories. The implementer fixed them while it still owned production files. After explicit ownership transfer,
this reviewer independently checked those fixes, changed six existing migration tests, and synchronized two existing
backend specs. No additional production source change was necessary. Reviewer test preimages/hashes and the exact
delta are in `review/preimages.json`, `review/changed-files.json`, and `review/migration-tests.diff`.

## Findings (fixed)

### 1. A proposal could acquire a newer input watermark without being regenerated

- File: `packages/core/src/db/subagent-execution-repo.ts`, `subagent-terminal.ts`, migration 056.
- Issue: record a proposal at work sequence 1, accept a correction, then use a real Effect intent receipt to advance
  the execution to sequence 2. Canonical completion previously returned the old proposal as `validated`, `current`,
  and covering sequence 2. This was a reachable repository mutation sequence, not a hypothetical source callback.
  The same proposal slot also prevented a valid replacement after an actual Attempt retry.
- Fix: the proposal retains its exact work-token digest and Attempt identity. Same-identity content remains immutable;
  only the current active Attempt/token may replace an obsolete proposal. Terminalization rejects obsolete proposal
  text and source facts. Visible fallback must occur after the current Attempt's last addressed-input receipt.
  Current work with no current output still produces `body:null`, `outputKind:none`, and its requested status
  notification; only real same-work watermark supersession withholds completion.
- Evidence: the original real-SQLite probe returned `validated/current/throughWorkSeq:2` for the old body.
  Final `subagent-repo.test.ts` covers absent/current replacement, immutable same identity, late old Attempt,
  replacement Attempt, retained old transcript, and removal of old source descriptions. It also preserves parent
  proposal replacement after an actual parent Attempt change. These tests passed in the final full Core run.

### 2. Unused-capture disposal could reject an already committed admission

- File: `packages/core/src/harness/run-service.ts`, `packages/core/src/db/run-repo.ts`.
- Issue: an admission observer can synchronously cancel and terminalize a Run before captured context binding.
  `bindCapturedContext` then disposed the unused capture outside commit-error isolation. A throwing disposer rejected
  `admit` despite a durably cancelled Run and produced no callback diagnostic.
- Fix: post-admission unused capture disposal delegates to `RunRepo.afterCommit` and the existing Database callback
  runner/reporter. It cannot change the successful SQL result. Ordinary terminal cleanup still removes the exact
  context entry before disposal, and each remaining callback receives its turn.
- Evidence: the original production-repo probe observed `rejected:true`, durable `cancelled`, and zero reported
  callback errors. The final regression observes a resolved cancelled admission, no bound terminal context, one
  disposal and one reported error. Existing outer-rollback/direct-repo terminal cleanup tests remain green.

### 3. Existing migration coverage stopped at 055

- File: `db/pending-memory-repo.test.ts`, `db/scheduled-task-repo.test.ts`,
  `db/migrations/{index-list,lineage-reopen-matrix,041-canonical-memory-maintenance,048-memory-operations}.test.ts`.
- Issue: the complete workspace test run found 16 failures in these six files. Their exact current-tail assertions
  stopped at 55, and the manually composed historical MCP/Skill migration path omitted 056.
- Fix: updated the expected contiguous tail to 56 and added 056 to that explicit historical path. Added all four
  delegation table families to the shared final-schema assertion. Existing old-row, receipt, lease, checkpoint,
  authority, foreign-key and no-op-reopen assertions remain unchanged.
- Evidence: full-run failure details remain in `review/tests.log`; all six repaired files passed, 49 tests,
  in `review/migration-regressions.json`. No timeout or resource failure occurred in the bounded full run.

### 4. Database specs did not describe the new outermost-commit boundary

- File: `.trellis/spec/backend/sqlite-transaction-isolation.md`, `database-guidelines.md`.
- Issue: the specs described transaction failure isolation but omitted `afterCommit`, and the live-event example
  published directly after a local transaction return, which can merely be savepoint RELEASE.
- Fix: synchronized callback frames, rollback/COMMIT discard, reentrant FIFO, isolated callback/reporting failures,
  exact cleanup and context-binding rules. Updated the example to register publication with `afterCommit` and recorded
  the canonical linked-terminal, exact-work, immutable-expiry and proposal-identity rules in the existing DB guide.

## Findings (not fixed)

None within the S1 persistence foundation. The following API handoffs are intentionally downstream obligations,
not missing S1 delivery findings.

## Independently verified behavior

| Boundary | Verified result |
| --- | --- |
| Canonical terminal paths | `start` cancellation/deadline/budget refusal, `guardDispatch` cancellation/deadline/budget refusal, public settle and direct recovery settlement reach `settleRun`. The participant sees the final adjusted outcome. Child result/outbox/private tail/exact active pointer and canonical Run/Attempt/Receipt/events commit together. |
| Required participant failure | Admission failure rolls back Run/link/pointer; terminal failure rolls back terminal state, receipt, events, staged private tail, result and pointer release. Deferred FK COMMIT failure emits no notification or terminal cleanup. |
| Process callbacks | Successful savepoints do not publish; outer rollback/failed COMMIT discards callbacks. Implicit transaction abort blocks later SQL and callback registration. Callback/reporter exceptions cannot relabel committed SQL, and later callbacks still run in FIFO order, including reentrant commits. |
| Captured resources | Direct repository terminalization reaches the registered RunService owner. No synchronous release remains in `start`/`settle` during a rolled-back transaction. Disposal is idempotent through exact entry removal; disposal failure does not imply every physical resource released successfully. |
| Work identity and control | B has a distinct work ID/watermark/policy and cannot alter active A's token. Message targets and operation digests are immutable. User stop cannot be downgraded by parent interruption/input; exact user continuation is required. Active stop requires cancellation participation. |
| Work lifetime | Lifetime is captured before any Run, inherited by same-work inputs, never renewed by duplicates/retries/reuse, and bounds linked child/parent deadlines. Reply-acceptance expiry must match. The expiry addition was known unfinished work at review start, not a newly discovered defect. |
| Input receipts | The actual Effect identity reaches the synchronous intent participant. Deferred FKs tie first consumption and private receipts to its insertion. Repeated Effects and replacement Attempts retain distinct receipts while logical replay includes an addressed input once. Selection without intent consumes nothing. |
| Private messages | Native call/result identities, values, source sidecars and order survive; raw call arguments are removed. Invalid tool groups refuse. Completed steps are idempotent; partial evidence stays distinguishable and stale Attempts cannot mutate current work. |
| Results and parent linkage | Record-only outcomes remain discoverable without pending parent admission. Requested completion is unique and linked parent admission is idempotent. Cancel/deadline/unknown proposals are partial/status evidence, not successful replies; parent decision/result/disposition remains queryable. |
| Migration compatibility | Fresh/055/legacy-v35 and historical MCP/Skill convergence paths retain existing data and receipts and reopen without new changes; registry is ordered 1-56 and all four delegation table families exist. |
| Memory boundary | S1 adds only private Runtime evidence. No new Memory writer, ingestion eligibility, provider capability change or authority selection is introduced. Executable child restrictions are not claimed by these storage types. |

## Concrete API handoffs

1. S2/S3 must install the same `executions.linkedState` before both child admission and recovery scanning. S1 deliberately
   does not wire it in `main.ts`. Recovery's ordinary last-terminal-Effect inference still needs delegated-scope
   recognition before activation; a completed model Effect alone is not a complete delegated task.
2. Thread the actual `EffectLifecycle` through the existing model middleware/WorkContext intent hook. Read the durable
   execution token after admission advances control version. Repeated preparation without a request writes no receipt.
   Record failed-Attempt completed steps before retry; use `stageTerminal` only for the final Run tail after retry choice.
3. `run_messages` input receipt content is the direction projection. Join its `inputId` to retained `SubagentInput`
   material text and sender when rebuilding context/history; receipt text alone is not the complete accepted input.
   Child history spans child Runs; linked parent synthesis is read from the completion group.
4. Repository `list` exposes stored continuity, including selected context. Public list/navigation must project bounded
   summaries. Public source/material selection must resolve actual retained working evidence; descriptive JSON is not
   execution authority. Queries and schema data alone do not prove model-visible source handling.
5. Completion hints schedule later work and re-read durable state after context binding. They do not synchronously
   dispatch from admission publication. The normal Character lane, capacity/currentness gates and exact controller
   quiescence remain S2/S3 responsibilities; terminal pointer release is not a lease grant.
6. `SubagentPublication` records pending/deferred/refused/recorded disposition plus publication references. S3's result
   endpoint must join canonical delivery state to expose actual `sent`/`unknown`/`no_target`; `recorded` is not a
   transport acknowledgement. Its trusted reply adapter must validate the real primary witness and live accepted-root
   purpose/currentness; stored acceptance JSON and matching expiry do not establish that authority by themselves.
7. Trusted `workScope`, rather than `initiator=subagent`, distinguishes read-only child execution from normal main
   continuation authority. S2 must enforce the final executable tool subset, preserve explicit empty selections and
   provider capability digests, and verify reads/denials through actual execution. The dispatcher, public protocol,
   source publication/replay/compaction and UI remain their sequenced slices.

## Verification

Environment: Node `v24.18.0`, pnpm `10.22.0`, Windows PowerShell, actual Node SQLite. No external model or live native capability
call was made by this review. The later owner authorization for real-model trials does not turn S1 deterministic
evidence into full-feature/model acceptance.

| Command / gate | Result |
| --- | --- |
| `pnpm lint` | PASS after final changes; `review/lint-final.log`, exit 0. |
| `pnpm -r typecheck` | PASS after final changes for Shared/Core/CLI/Desktop/E2E; `review/typecheck-final.log`, exit 0. |
| `pnpm -r test --maxWorkers=4` | Full run: Shared 677/76 files, CLI 50/8, Desktop 1214/202 passed; Core 4060 passed, 2 skipped, 16 failures in the six migration files above. `review/tests.log` retains this failed run unchanged. |
| Six-file Core migration rerun, `--maxWorkers=4` | PASS: 49/49 tests, 6/6 files, including all 16 former failures; `review/migration-regressions.json`. Only those six test files changed after the complete run. Combined final coverage is 6017 passed and 2 skipped, not a claimed second full-suite run. |
| `python .trellis/scripts/task.py validate .trellis/tasks/10-21-agent-delegation-runtime` | PASS: 8 implementation-context and 6 check-context entries. |
| `git diff --check` and task-owned UTF-8/no-BOM/whitespace audit | PASS; final summary in `review/verification.json`. Git's existing CRLF normalization warnings were not failures. |
| Real isolated Node boot | Reused final implementer evidence `boot-reviewed/boot.json`: correct T4 cwd, listening log + socket connection, loopback trap 0 model requests. No production source changed after that evidence. |
| SDK/native gate | Not reopened or rerun. S1 did not change the accepted SDK/native files; prior accepted evidence remains separate. |

Reproduce the repaired migration gate from T4:

```powershell
pnpm --filter @taki/core exec vitest run src/db/pending-memory-repo.test.ts src/db/scheduled-task-repo.test.ts src/db/migrations/041-canonical-memory-maintenance.test.ts src/db/migrations/048-memory-operations.test.ts src/db/migrations/index-list.test.ts src/db/migrations/lineage-reopen-matrix.test.ts --maxWorkers=4
```

The original targeted command additionally used the JSON reporter. Its relative output path was initially one
directory too high; only that generated JSON was relocated to this T4 review directory after exact path validation.
All six executed test paths in the JSON are under T4. The correct reporter path from `packages/core` is
`../../.trellis/tasks/10-21-agent-delegation-runtime/research/s1/review/migration-regressions.json`.

## Final disposition and limits

S1's storage and synchronous transaction APIs are stable for the next slice. No unresolved S1 defect remains.
The original working tree and Memory data were preserved; no commit/push/reset/archive or real-user database
mutation occurred. Automatic tests do not mark any owner/UI acceptance criterion passed. Release S1 production
ownership to the coordinator only after this report and final verification summary are recorded.
