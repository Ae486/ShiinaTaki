# Phase 2 serial automated gate — 2026-11-11

## Scope and conclusion

The owner authorized testing after freeing memory, followed by recorded results and
an assessment of checkpoint/merge readiness. This report covers the serial automated
gate in `H:/TakiAgent`, `main`, HEAD `ba5be726e8f03408d389e25962f511f0bc7982c4`.
The supplied existing task path was authoritative; the checker did not create or
bind another task. The D103/D104 source review remains in
[the wave-3 review](phase2-wave3-check-20261111.md).

All seven workspace typechecks and root lint passed. Final package results contain
**6,131 passed, 2 failed and 2 skipped tests in 785 files**. Both failures reproduce
the two already recorded Core failures; this is not a green whole-repository test
claim. No new failing product test was identified. The full Core gate includes the
current migration 063 and the D104 backup service tests that were missing from the
prior review's completion evidence.

The checker changed no production code, test source, dependency, Git state, task
lifecycle or original data. Its repository write is this report. The leader owns
the current full-stack harness changes, phase/ledger updates, C/L runs and final
[validation record](phase2-validation-20261111.md). These automated results do not
establish full-stack, installed-build, owner UI or complete parent acceptance.

## Evidence and execution

Evidence root: `G:/taki-codex-work/phase2-gate-20261111-bf8a`.

- `runner.ps1`, `supplement.ps1`: exact serial commands, temporary-directory and
  supported fixture overrides. No concurrent test process was admitted.
- `results.json`, `supplement-results.json`: each command's arguments, start/end
  timestamps, wall duration, exit code and before/after available-memory samples.
- `test-*.log`, `test-*.json`: retained console output and Vitest result details.
  Failed initial attempts remain separate from corrected invocations.
- `statistics.json`: final unique package totals and all attempted command timings.
  Vitest nested suite counts are not mislabeled as test-file counts.
- `source-baseline.json`, `source-readback.json`: HEAD/Node identity and byte hashes
  of 134 changed application/source files; all 134 hashes were unchanged at final
  readback. Leader-owned `.trellis` harness changes are outside this source list.
- `adapter-provenance.json`: verified retained fake adapter and copied identity.
- `cleanup-observation.json`: no matching checker or C2 fixture process remained
  after the serial slot was released. Retained test artifacts were not deleted.

Environment: Windows, Node `v24.18.0`, pnpm `10.22.0`, Vitest `4.1.10`.
Every test process used `NODE_OPTIONS=--max-old-space-size=1536`,
`--pool=threads --maxWorkers=1`, and the owned G: `temp` directory for `TEMP/TMP`.
The normal gate ran from **18:18:28 to 18:58:53 Asia/Shanghai**; the two corrective
fixture invocations ran from **19:05:05 to 19:06:02**. The sum of all command wall
times is **2,472.683 seconds (41 minutes 12.7 seconds)**, including failed initial
invocations. This excludes orchestration pauses and is not an application-latency
measurement. Before/after command samples span **7.622–8.586 GiB** available
physical memory; these are not in-test peak or minimum measurements.

## Verification

| Check | Final result | Command wall time |
| --- | --- | ---: |
| `pnpm -r --workspace-concurrency=1 typecheck` | Exit 0; Shared, Core, Desktop, CLI, Host, codec and E2E workspace | 100.587 s |
| `pnpm lint` | Exit 0; actual root ESLint script | 37.795 s |
| Shared | 72 files; 689 passed | 32.593 s |
| Desktop | 130 files; 776 passed | 130.074 s |
| CLI | 8 files; 47 passed | 7.242 s |
| Hindsight Host, supported fake-adapter override | 10 files; 87 passed, 1 installed-fixture skip | 54.102 s |
| Secret Catalog codec, declared test script | Exit 0; zero test files/tests with declared `--passWithNoTests` | 1.866 s |
| Core, eight serial shards | 565 files; 4,532 passed, 2 existing failures, 1 Windows skip | 2,096.129 s |

The full-package test command shape was:

```powershell
pnpm --filter @taki/<package> exec vitest run --pool=threads --maxWorkers=1 --reporter=default --reporter=json --outputFile=<owned-result.json>
pnpm --filter @taki/core exec vitest run --shard=<1..8>/8 --pool=threads --maxWorkers=1 --reporter=default --reporter=json --outputFile=<owned-shard-result.json>
```

The codec correction uses its declared script:
`pnpm --filter @taki/secret-catalog-codec test` with the same worker/report flags.
All complete argument arrays, including output paths, are in the result JSON.

| Core shard | Files | Passed | Failed | Skipped | Exit | Wall time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 71 | 517 | 1 | 0 | 1 | 179.118 s |
| 2 | 71 | 511 | 0 | 0 | 0 | 200.073 s |
| 3 | 71 | 598 | 0 | 0 | 0 | 329.613 s |
| 4 | 71 | 523 | 0 | 0 | 0 | 202.248 s |
| 5 | 71 | 620 | 0 | 0 | 0 | 173.556 s |
| 6 | 70 | 645 | 0 | 1 | 0 | 596.622 s |
| 7 | 70 | 576 | 1 | 0 | 1 | 217.962 s |
| 8 | 70 | 542 | 0 | 0 | 0 | 196.937 s |

Shard 6's long first file was `transition-template-healthy.test.ts`: all 26 cases
passed in 361.396 seconds. The suite covers selected/removed RETURN+REENTRY and
publication-drift combinations; observed individual cases took 5.2–27.1 seconds
within existing 60–360-second test budgets. Its previous Vitest cache duration was
341.379 seconds. CPU and newly created owned fixture directories showed progress;
no test was killed, timeout enlarged or expectation weakened to finish the gate.

Task context validation passed (23 implementation and 24 check entries), retaining
the existing warning that the 39,182-byte replica spec exceeds the 32,768-byte
automatic injection limit. `git diff --check` passed; Git's CRLF normalization
notices are not whitespace-check failures.

## Current D103/D104 evidence

These are subsets of the full totals above, not additional test counts:

| Area | Selected current-file evidence |
| --- | --- |
| D103 accepted-only waiting and real recovery | Pending aggregate 21; Pending recovery 45; scheduler repo 27; scheduler 26 — all passed |
| D103 durable operation and history | Migration 063 2; replica operation adapter 12; operation service 9 — all passed |
| D103 Home projection | Authority state 13; authority card 29 — all passed |
| D104 capture on current migration lineage | Backup service 25/25 passed with current `MIGRATIONS`, including 063; 5.418 s inside Vitest |
| D104 Home presentation | Backup state 16; backup block 5 — all passed |
| D105 integration retained | Publication convergence 1; publication target 14 — all passed |

Desktop's existing colocated browser cases also ran inside the serial package
suite, including the transition, configuration and template browser paths. These
use controlled dependencies and existing browser harnesses; they do not constitute
packaged Tauri or real Native/model acceptance. The leader explicitly confirmed
that these existing cases were within the authorized serial testing scope.

## Findings fixed — test invocation/environment only

1. The initial generic codec invocation omitted its package's declared
   `--passWithNoTests`. It exited 1 with zero tests in 1.714 seconds. The retained
   declared-script rerun exited 0 with zero tests. No coverage is invented and no
   package source/script was changed.
2. The initial Host invocation reported 55 passed, 32 failed and 1 skipped in
   10.581 seconds. All 32 failures were the same `ENOENT` before child dispatch:
   the historical default `G:/Temp/taki-c2a-source-20261014-impl/fake-key-adapter.exe`
   no longer exists. Host source has no diff from HEAD. The supported
   `TAKI_C2A_KEY_ADAPTER` override restored this existing fixture without editing
   tests or production code; `TAKI_C2A_TEMP` points to the owned G: directory.

The copied adapter came from
`.trellis/tasks/10-14-hindsight-managed-deployment/research/c2a-database-persistence-run-1b05d2f6/fake-key-adapter.exe`.
Its SHA-256, verified against that directory's saved evidence and after copying, is
`58a7b15f048522b9dbac140c9f99539d55bb3f8d28a2fb238f5455745d82dace`.
The checked-in Rust fixture only emits a fixed fake 32-byte key and cannot read
Credential Manager. `FakeDeploymentEngine` uses private C2 owner/child pipes;
`C2FakeConsumer` accepts only generated `C2A_FAKE_` values, and its fixed child
imports no provider or network client. No Docker daemon, Hindsight API/PostgreSQL
stack, original credentials or original database was used for this restoration.
The default Host command still requires the documented external fake fixture or
this override; a green configured run is not a self-contained fixture-packaging fix.

## Findings not fixed — existing failures and unrun boundaries

- `packages/core/src/memory/hindsight-memory-consumer.test.ts:106` again expects
  `JSON.stringify(result)` to throw `RangeError`, but it does not. It is the sole
  shard-1 failure.
- `packages/core/src/memory/hindsight/hindsight-configuration-context.test.ts:56`
  again expects `verifyTransitionNativeEvidence` to have been called. It is the
  sole shard-7 failure.

Both test files are unchanged from HEAD. The same failure identities were already
baseline-checked and recorded in [the phase plan](phase-plan-20261107.md) and
[phase-1 delivery](usable-delivery-20261108.md). This turn reproduced them on the
current source; it did not rerun a separate historical checkout. Neither failure
was hidden, skipped or fixed outside the assigned phase-2 scope.

The Core skip is the POSIX owner-only mode-bit assertion on Windows. The Host skip
is its opt-in installed Shell fixture. Rust compilation/clippy/tests, a packaged
Desktop build, real-model behavior and the leader's C/L full-stack runs are not
results of this checker. No Rust source changed in this phase's dirty scope.

The automated evidence supports evaluating a clearly labeled phase-2 checkpoint,
with the two existing failures disclosed. It cannot alone authorize a merge,
establish compatibility with T4's different baseline, or close the parent task.
The leader must combine the live-run outcomes and independent branch/merge
assessment before making that recommendation. No commit, merge, push or archive
was performed by this gate.
