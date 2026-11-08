# P1-F Core F2 verification

Workspace: `H:/TakiAgent`, branch `main`. Node `v24.18.0`, pnpm `10.22.0`, Vitest `4.1.10`.
All commands set `TEMP` and `TMP` to `G:/taki-codex-work/tmp-f2`.

## Commands and results

The following PowerShell variables reproduce the selected scope from the workspace root:

```powershell
$env:TEMP = 'G:/taki-codex-work/tmp-f2'
$env:TMP = $env:TEMP
$tests = @(
  'src/memory/hindsight/hindsight-application-sync-runner.test.ts',
  'src/memory/hindsight/hindsight-runtime-verification.test.ts',
  'src/memory/hindsight/hindsight-foreground-recall-lifetime.test.ts',
  'src/memory/hindsight/hindsight-memory-reflect-deadline.test.ts',
  'src/memory/hindsight/hindsight-pending-recovery.test.ts',
  'src/memory/hindsight-lifecycle/hindsight-lifecycle-journey.test.ts',
  'src/db/hindsight-runtime-admission-repo.test.ts',
  'src/memory/hindsight/hindsight-memory-write-deadline.test.ts',
  'src/memory/hindsight-backup/hindsight-backup-service.test.ts',
  'src/memory/hindsight/hindsight-replica-sync-runner.test.ts',
  'src/memory/hindsight/template-lifecycle/template-runtime-control.test.ts'
)
$production = @(
  'src/memory/hindsight/hindsight-application-capability.ts',
  'src/memory/hindsight/hindsight-runtime-state.ts',
  'src/memory/hindsight/hindsight-application-sync-runner.ts',
  'src/memory/hindsight/hindsight-memory-provider-context.ts',
  'src/memory/hindsight/hindsight-memory-reflect.ts',
  'src/memory/hindsight/hindsight-pending-recovery-runner.ts'
)
$changedTests = $tests[0..5]
pnpm --filter @taki/core exec vitest run @tests --maxWorkers=2
pnpm --filter @taki/core exec vitest run @tests --maxWorkers=2 --pool=threads
pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-runtime-verification.test.ts src/memory/hindsight/hindsight-memory-reflect-deadline.test.ts --maxWorkers=2 --pool=threads
pnpm --filter @taki/core typecheck
pnpm --filter @taki/core exec eslint @production @changedTests
```

| Check | Result | Artifact |
| --- | --- | --- |
| Initial pre-production-change sync tests, default forks | Could not start; `spawn EPERM`; no behavioral test evidence | `before-tests.log` |
| First implementation sync tests, threads | 15 passed | `thread-tests.log` |
| Requested 11-file default-fork command | Could not start any worker; `spawn EPERM`; no tests ran | `requested-tests.log` |
| Same 11 files with two thread workers | 9 files passed; 6 newly written fixture cases failed across 2 files, out of 211 tests | `affected-tests.log` |
| Corrected 2 fixture files, two thread workers | 27 passed; combined with the 184 tests in the other 9 passing files, all 211 selected tests have passing final per-file results | `corrected-tests.log` |
| Final Core typecheck | Exit 0 | `typecheck-final.log` |
| Final ESLint on six production files and six changed tests | Exit 0 | `eslint-final.log` |
| Final scoped `git diff --check` on all 17 edited repository files | Exit 0 | `whitespace-final.log` |

The paused-response fixture does not implement D77 pulls, so its evidence is warmed through the real provider capability admission before the paused sync. The Reflect omission fixture must omit the optional wire property, rather than supplying JavaScript `undefined`. These corrections preserve the expected refusal/deadline/publication assertions. No production behavior was changed to satisfy those failures.

## Covered outcomes

- Cold sync makes three admission requests; warm sync and persisted reuse after runtime replacement make one and do not resave evidence.
- Changed build or upstream identity forces full admission; changed live lineage refuses before still-readable historical D77 rows are pulled.
- Two independent cold Bank syncs save identical evidence only once. The resolver rereads current persisted evidence after admission, before deciding to save.
- Repeated availability failures preserve historical evidence and checkpoints. Recovery requires one successful live manifest, with no health/version replay.
- Warm composed Reflect makes one admission request and retains the five-minute shrinking allowance. Removed guarded Reflect refuses before policy upload or generation.
- Composed D77 Pending recovery completes tracked native proof with two sync admission requests. Missing/corrupt post-pull admission evidence throws before native dispatch.
- Paused warm replies after marker/checkpoint/configuration/caller-cancellation/runtime-stop changes perform no late admission save or replica publication.
- Explicit lifecycle revalidation still calls health, version and compatibility once each. Existing legacy recovery, admission-repository integrity, standalone B5, write deadline, backup and private-template runtime checks remain passing.

## Scope and resource disposition

Exactly six production modules, their folder index, six existing test files and the four assigned spec documents were edited. No new production module, migration, dependency, callback/generation state, template/prompt change, or repository/lifecycle-revalidation implementation change was introduced. Baseline copies are retained in `baseline/`; final production line counts and SHA-256 values are in `source-check.json` (largest production file: 243 lines). Shared specs received only targeted admission edits.

No Core, Native or PostgreSQL service was started. All invoked test/static-check processes exited. No original user data, real credentials or unrelated services were accessed or changed. G: logs, baseline copies and failed-test fixture remnants remain available for review; no cleanup of inherited workspace files was performed.

Live Native/PG performance, real model behavior, release/build identity and owner acceptance are not established by these deterministic checks. Default fork-pool execution remains blocked by the environment; no approval or security-policy override was attempted.
