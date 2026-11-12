# Production Core child recovery integration

Date: 2026-10-23. **Passed** on the first behavioral run. The coordinator added this zero-paid integration after the final reviewer established that earlier recovery evidence covered the actual SQLite/RecoveryCoordinator owner, while production main installation was only statically inspected.

## Real process observations

[first.json](first.json) records one passing test. [result.json](first/production-restart-KcxCfr/result.json) and the adjacent baseline/phase artifacts record three actual Core PIDs (`36976`, `30112`, `39032`), two process-tree kills, eight local scripted-provider HTTP requests, unchanged source hashes, successful cleanup and no fixture deadline or request-budget failure.

- An actual primary model-tool response creates two generic children through production Core. Both have real pending model Effects. Public `subagent.stop` latches A, and public `subagent.send` persists a private pending input without resuming it. B remains active until the fixture kills the Core process.
- Restart uses the same isolated canonical Local database and real production `main.ts`. Startup makes no provider request. A's user latch/control version and complete input records survive. B's interrupted model Effect and linked child Run are settled as `outcome_unknown`, with exactly one retained result.
- A deliberate ordinary foreground probe verifies the restarted runtime continues processing without starting another child request. It is an explicit scripted model request, distinct from the no-request startup observation.
- Public Continue starts a new Run for each child. A's original pending input acquires the actual new model Effect receipt. The original A cancellation and B unknown outcome are not reopened or rewritten; all child results remain record-only and private input never enters the relationship Timeline.
- A second kill/restart, followed by another explicit foreground probe, leaves the entire retained `subagent_executions` table unchanged and makes no extra child request. Each child has exactly two requests: the interrupted original and its explicitly continued new Run.

The independent reviewer read the test and actual result/phase evidence and confirmed this closes the production restart wiring gap for these supported generic-child paths.

## Reproduction and boundaries

```powershell
$env:TAKI_E2E_EVIDENCE_DIR='H:/TakiAgent-worktrees/t4/.trellis/tasks/10-21-agent-context-acceptance/research/restart-20261023/first'
pnpm --filter @taki/e2e exec vitest run src/agent-context-restart.e2e.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile=H:/TakiAgent-worktrees/t4/.trellis/tasks/10-21-agent-context-acceptance/research/restart-20261023/first.json
```

Use a fresh evidence directory for a future reproduction. The fixture has a 12-request local cap and 150-second deadline; the passing test took 12.78 seconds (15.07 seconds including discovery/import). E2E typecheck and scoped ESLint passed before execution. Only fixture-owned process handles are killed. Test databases and synthetic request/state evidence are intentionally retained under the task; real profiles, databases and credentials are not opened.

This is production Core/WS/SQLite/SDK integration with scripted local model responses, not real-model semantic evaluation. It exercises interrupted model Effects, not unknown external Host side effects. Existing owner-level non-model reconciliation and lost-domain-authority tests remain separately attributed. No runtime production patch, migration rewrite, commit, push, archive or human acceptance occurred.
