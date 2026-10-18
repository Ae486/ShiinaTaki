# D2 capture admission failure: read-only diagnosis

Owner: `/root/core_independent`. The sole full Core suite remains root-owned
(`b3-whole-core-tests-01`, root session 8619). No test, lint, typecheck, source edit or runner
edit was performed for this diagnosis. Only this note and its companion JSON evidence are new.

## Observed facts

- The running log reports `hindsight-capture-sync.test.ts`: 10 tests, one failed, 23391 ms.
  The failing D2 case is reported at 5347 ms. All nine other cases in that file passed.
- The final assertion/timeout stack has not yet appeared. A duration near five seconds is
  evidence for a timeout hypothesis, not proof of the error type or its exact stage.
- `hindsight-capture-sync.test.ts:120` has no per-test timeout. It enables fake timers before
  constructing and priming a full SQLite runtime, publishes eight new units, and delays each
  synthetic commit by 2500 fake milliseconds. It verifies a 7500-ms admission budget twice,
  then drains all fake timers and the real Bank service before checking exactly eight completed
  receipts, zero refusals and all eight bound rows.
- Core has no Vitest configuration override. Its package script is `vitest run`.
  Installed Vitest 4.1.10 sets Node `testTimeout` to 5000 ms in
  `node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:538`. The installed runner's
  `chunk-artifact.js:2261` uses `getSafeTimers()` in `withTimeout`; its real test deadline is
  separate from this test's fake admission/commit time.
- Fixture setup, SQLite transactions, hashes, event reconstruction and repeated binding/pull
  work still consume real time. The eight delayed commits are serially bound and each successful
  commit is followed by a complete incremental pull. Advancing fake time does not remove that work.

## Actual call path

1. The subsystem's `captureRun` enters `createHindsightMemoryRuntime.captureRun`, then
   `synchronizeHindsightCapture`.
2. `synchronizeHindsightCapture` starts an independently owned whole-Bank sequence with
   `state.service.capture`, races its completion against `within(..., budgetMs)`, and detaches
   caller cancellation after the budget. It does not cancel the unfinished binding sequence.
3. `createHindsightRuntimeBankService` serializes same-Bank work behind the preceding promise.
   Foreground mode has no whole-operation timeout; it retains request-level bounds and renews
   only its current live lease. `settle()` joins all owned work.
4. `createHindsightApplicationSyncRunner.bindPasses` commits one binding and pulls its complete
   event before another binding. The binding intent digest supplies the stable receipt identity.
5. The D2 assertion requires two admitted Runs, four deferred-Bank events, exactly eight completed
   bindings and no refused receipt. Those assertions must remain unchanged in any eventual repair.

The documented contract is `.trellis/spec/backend/hindsight-application-runtime.md:172` through
the Run-capture paragraph: bounded admission, complete detached ownership, original receipt reuse
and truthful per-Bank deferred status.

## Source comparison

The test and these production files exactly match the accepted B2 check-input hashes:
`hindsight-capture-sync.ts`, `hindsight-runtime-bank-service.ts`, `hindsight-memory-runtime.ts`,
`hindsight-memory-subsystem.ts`, `hindsight-runtime-state.ts`, `hindsight-runtime-connection.ts`,
`hindsight-application-sync-runner.ts` and `hindsight-application-binding-runner.ts`.
The application fixture is also unchanged.

Two fixture files differ from that baseline. In-memory reversal of only the namespace-support
hunks reproduces their accepted B2 hashes exactly; no file was written:

- `hindsight-policy-curator-fixtures.ts` adds optional `namespace` and otherwise uses the original
  `APPLICATION_TEST_SCOPE.namespace`. D2 supplies no namespace.
- `hindsight-runtime-composition-fixtures.ts` derives the seeded authority lineage from its actual
  Banks and checks consistency. D2's two default Banks still share the original fixture lineage.

This bounds the visible B3 fixture delta; it does not prove every transitive dependency has no
performance effect. The source identities and partial-log evidence are in the companion JSON.

## Hypotheses and discriminators

| Hypothesis | Evidence now | What resolves it |
| --- | --- | --- |
| The ordinary five-second real test envelope expires while the fake-time integration finishes | 5347-ms failed duration; default 5000-ms test timeout; eight real binding/pull cycles and full setup inside the test | Final stack must state timeout; isolated original-source D2 shows completion time and whether assertions pass |
| A fake-time budget, deferred-event or exact-once assertion actually fails | These assertions exist; the current log does not show the failed assertion | Final stack and an unchanged isolated D2 reproduction |
| Service settlement or fixture cleanup hangs | The case explicitly drains the service; afterEach closes all owners | Final hook/test stack plus bounded isolated phase evidence if the ordinary run still stalls |

No concrete production defect or permanent timeout change is justified yet.

## Minimal authorized follow-up after root releases the slot

1. Let the existing full suite finish and preserve its original log/result/source/cleanup evidence.
   Read the final D2 stack before editing anything. Do not rerun the completed Healthy matrix.
2. Run only the unchanged D2 case, one worker, through the existing credential-free wrapper:

   ```text
   python .trellis/tasks/10-07-hindsight-template-lifecycle/research/run-b3-core-source-check.py independent-d2-default-01 H:/TakiAgent G:/Roaming/npm/pnpm.cmd --filter @taki/core exec vitest run src/memory/hindsight/hindsight-capture-sync.test.ts -t "bounds admission by its budget with many pending units" --maxWorkers=1 --reporter=verbose
   ```

3. Only if a five-second timeout is confirmed and the original-source run cannot reach the final
   assertions, use a separately named one-case diagnostic invocation with `--testTimeout=30000`.
   This is a temporary command-level measurement, not an accepted fix. It preserves the actual
   7500-ms admission budget, 2500-ms fake commit delay, eight units and all assertions. If needed,
   root may authorize temporary phase timing around fixture/prime, each fake-clock advancement,
   and final timer/service drain; keep that evidence separate and do not add a production timer.
4. Select a repair only from the resulting stack and timing. A measured test-envelope issue can
   justify a local budget with its original logical assertions; a failed assertion or stalled
   owner requires a specific code-path correction. Do not change global timeouts or runtime leases.

## Recommended affected verification

- A test-only correction: the complete ten-case `hindsight-capture-sync.test.ts` file once, plus
  the changed file's lint and whichever final type gate root requires. Reuse the unchanged suite's
  other successful files; this does not justify another complete Core/26-case Healthy run.
- A production capture/Bank-owner correction, only if proven: add
  `hindsight-runtime-bank-service.test.ts` and `hindsight-runtime-lifetime.test.ts`, which directly
  cover queue cancellation, detached multi-Bank ownership, transition drain and settled shutdown.
  Include changed-file lint and Core typecheck. Expand beyond this only if the specific fix reaches
  another boundary.

All source, Shared, Native, specifications and existing research scripts remain frozen. Await
root's final stack, explicit check slot and any necessary write ownership before execution.

## Second failure: Pending Memory migration-tail expectation

Root subsequently requested a separate read-only diagnosis of
`src/db/pending-memory-repo.test.ts`, without expanding the D2 investigation. The running suite
reports 23 tests / one failed; the case
`applies the current migration tail after a populated version-34 database and reopens without changes`
took 445 ms. Its final error stack is also pending.

### Confirmed source inconsistency

- `pending-memory-repo.test.ts:170` opens `fixture(true, 34)`. The fixture creates the file with
  `MIGRATIONS.slice(0, ceiling)` at line 327 and seeds both Bank records and checkpoints.
- The first reopen at line 172 asserts the exact applied list **35 through 57**.
- `fixture.reopen` at lines 338-341 passes the complete current `MIGRATIONS` to `openDatabase`
  and returns the actual `onMigrated` versions. It has no historical upper ceiling.
- `openDatabase` forwards `runMigrations`' result unchanged. The runner reads the recorded maximum,
  applies every higher registry entry, and appends each applied version to its result.
- The current registry ends with migration 058 and 059. Its independent registry test requires
  the exact contiguous sequence **1 through 59**. Therefore a successful upgrade from 34 returns
  **35 through 59**, and the assertion at line 172 is stale independently of any timing concern.

This is a definite mismatch between the test and its declared current-tail contract. The final
stack must still confirm that the observed failure is this array comparison rather than an earlier
exception. The current evidence does not identify a production migration compatibility defect.

### Existing local pattern and supporting evidence

The existing 041 maintenance, 053 candidate, 054 publication and lineage-reopen tests use explicit
current-tail arrays, already extended to include 58 and 59. In particular,
`lineage-reopen-matrix.test.ts:390` upgrades populated 034/main/T4/both histories, checks preserved
migration receipts and Pending/Timeline data, runs `foreign_key_check`, and proves a no-op second
reopen. The current full-suite log already reports all ten lineage-matrix cases passing.

Migration 058/059 do not reference the old Pending/replica-record/checkpoint tables named by this
failing case. Their production sources remain the previously accepted immutable migrations. The
test's preservation assertions occur after the stale applied-list assertion, so this failed case
has not yet verified those later assertions in the current run.

### Minimal follow-up scope after root releases ownership

1. Preserve the full-suite final diff/stack as the red evidence. If it shows only added versions
   58 and 59, append those two literals to the existing array at line 172. Keep the populated
   version-34 setup, second-open empty list, persisted Pending identity, original record/checkpoint
   equality and immutable-identity trigger checks unchanged.
2. No migration, registry, runner, repository implementation or historical receipt needs changing
   for that correction. Follow the nearby explicit-list pattern; no new helper or abstraction.
3. Run the complete 23-case `pending-memory-repo.test.ts` file once after the authorized fix and
   lint the changed test. Reuse the unchanged migration/lineage results from the finishing suite;
   root retains the final typecheck decision. A test-only expected-list correction does not warrant
   rerunning the complete Core suite or the 26-case Healthy matrix.

Suggested affected command, **not executed**:

```text
python .trellis/tasks/10-07-hindsight-template-lifecycle/research/run-b3-core-source-check.py independent-pending-tail-01 H:/TakiAgent G:/Roaming/npm/pnpm.cmd --filter @taki/core exec vitest run src/db/pending-memory-repo.test.ts --maxWorkers=1
```

Only this owned research note and its JSON evidence were updated. All existing source, migration,
specification, test and harness inputs remain frozen; no checks were started.
