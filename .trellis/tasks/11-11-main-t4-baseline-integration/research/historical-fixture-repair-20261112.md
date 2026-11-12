# DB Historical Fixture Repair

## Scope and verified causes

Work was confined to `G:/TakiAgent-integration`, branch `integration/main-t4-20261111`.
Original worktrees, profiles, stopped backups and Git refs were not modified by this worker.
The parent supplied this task explicitly because the integration repository has no `.trellis/.current-task`.

The prior full Core receipt, `test-core.json`, contained **44 DB test failures**. Most used the current canonical
`MIGRATIONS` array to construct a purported T4 historical boundary. Canonical main 049-063 and T4 049-063 describe
different schemas; canonical fresh history also intentionally omits 064-072 before convergence 073-077.
Missing Timezone/source-context/delegation/usage/search tables were fixture defects, not evidence that the passing
production convergence should be rewritten. Historical max-version assertions remain 72 where the test really
reopens the preserved T4 sequence; no expectation was changed to 77 to conceal a skipped historical migration.

T4 053 and 054 tests had passed despite using the wrong predecessors. They now explicitly construct T4 history too.
All retained row, JSON, identity, receipt, strict-constraint, SQL/receipt/COMMIT rollback and reopen assertions remain.

One failure exposed a production integration defect rather than a fixture problem. T4 `advanceCoverage` deliberately
returns the proved partial cursor, while main custody adds an open-member `coverageGap`, including before the baseline.
The flush adapter ignored that gap and returned `not_required` before eligibility. The DB-owned regression now asserts
the actual repo-backed flush refuses an open pre-baseline group and an assistant-only open group without advancing the
cursor. Finalized pre-baseline history still returns `not_required`. The Memory worker owns the production
`memory-flush-port.ts` correction; this worker made no production DB or migration change.

## Historical 069 and current runtime coverage

Pure migration tests explicitly use T4 through 069, including all four early/current 058-context and 060-frontier
combinations, frozen exact signatures, unknown/partial refusal, SQL/receipt/actual COMMIT rollback, and reopen.
The old registry mock that truncated canonical main history at 069 was removed.

Runtime tests restore synthetic actual Run/Attempt/Effect/child/message/event rows into a file built from genuine
early T4 through 068. Restore uses only historical columns. Exact known runtime triggers are temporarily suspended
inside the fixture restore transaction to avoid manufacturing conversation-order rows, then restored verbatim;
foreign keys remain checked. Production code never uses this restoration helper.

The file then runs canonical migrations **073, 074, 075, 076, 077**, preserving old receipts and every original runtime
column value, without inventing receipt 069. Current runtime owners are composed only after this complete upgrade.
075 uses the unchanged frozen 069 branch SQL: exact terminal and canonical interaction boundaries backfill positively,
while malformed keys, check-ins and mismatched Attempts retain NULL frontiers. Reopen preserves the complete snapshot.
Recovery emits zero scripted-model calls, retains User Stop and the unknown primary Effect, settles orphan private Runs,
then permits explicit user Continue and normal new delegation/Stop. No test-only migration 078 was invented.

## Files changed by this worker

- `packages/core/src/db/migrations/050-initiative-model-opportunities.test.ts`
- `packages/core/src/db/migrations/051-initiative-feedback.test.ts`
- `packages/core/src/db/migrations/052-interaction-patterns.test.ts`
- `packages/core/src/db/migrations/053-initiative-wake-policy.test.ts`
- `packages/core/src/db/migrations/054-initiative-intentions.test.ts`
- `packages/core/src/db/migrations/055-initiative-backoff.test.ts`
- `packages/core/src/db/migrations/056-subagent-conversations.test.ts`
- `packages/core/src/db/migrations/057-source-context.test.ts`
- `packages/core/src/db/migrations/058-agent-inbox.test.ts`
- `packages/core/src/db/migrations/063-subagent-progress.test.ts`
- `packages/core/src/db/migrations/064-primary-conversation-sources.test.ts`
- `packages/core/src/db/migrations/065-auxiliary-model-usage.test.ts`
- `packages/core/src/db/migrations/069-delegation-schema-convergence.test.ts`
- `packages/core/src/db/cache-usage-repo.test.ts`
- `packages/core/src/db/search-projection-policy-repo.test.ts`
- `packages/core/src/db/primary-memory-custody-repo.test.ts`
- `packages/core/src/testing/subagent-fixture.ts` — parent-approved optional isolated `dbPath` fixture seam
- `packages/core/src/db/index.md`
- `packages/core/src/db/migrations/index.md`
- `packages/core/src/testing/index.md`
- This evidence report and the four test JSON receipts plus final command/environment receipt.

## Checks and receipts

Environment: native Node **24.18.0**, pnpm **10.22.0**, `TEMP`/`TMP` both `G:\Temp`.
Every Vitest command used `--maxWorkers=1`; no full Core suite was run by this worker.

| Receipt | Result | Purpose |
| --- | --- | --- |
| `test-db-historical-first.json` | 59/60 pass | Historical fixture corrections; reproduced actual pre-baseline flush refusal failure |
| `test-db-historical-069-first.json` | 15/17 pass | Pure 069 branches passed; synthetic restore exposed order-trigger duplication, corrected in the fixture |
| `test-db-historical-069-second.json` | 22/22 pass | All 069/075 runtime cases plus exact historical 053/054 |
| `test-db-historical-final.json` | **82/82 pass**, 16 files, **44.66 s** | Final complete owned DB gate after Memory flush correction |

`test-db-historical-final-command.json` records the exact reproducible final command, cwd, branch, test file list,
versions, temporary roots, duration and test-level coverage. Scoped ESLint over all 17 changed TS files and
`git diff --check` over the 20 changed source/index paths both passed. UTF-8/no-BOM checks over 22 owned source,
index and final evidence files passed.

The first `pnpm --filter @taki/core typecheck` reported only the concurrent Memory worker's
`testing/memory-historical-timeline-fixture.ts:119` use of `.shape` on a ZodPipe. After that worker corrected the
fixture, the final `pnpm --filter @taki/core typecheck` rerun **passed (exit 0)**.

## Limits and follow-up

These are deterministic SQLite and real SDK/repository/service composition checks with scripted models. They do not
establish live provider, original stopped-copy backup, native desktop or owner-manual acceptance; the parent owns those
separate integration gates. Peak process memory was not instrumented for this focused run. No commit, staging, push,
original-branch alignment or real-data rollout was performed by this worker.
