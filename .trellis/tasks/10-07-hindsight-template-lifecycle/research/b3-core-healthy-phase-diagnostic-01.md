# B3 Healthy minimal phase diagnostic

Owner: `/root/core_independent`. Prepared on 2026-10-13 (Asia/Shanghai).
The root authorized temporary instrumentation only in
`packages/core/src/memory/transitions/transition-template-healthy.test.ts`.
This preparation ran no tests, lint or typecheck. The root owns the next diagnostic slot.
The two selected representatives and original-budget D2 run remain pending.

## Completed whole-suite evidence

`b3-whole-core-tests-01-result.json` records exit 1 after 3761.610 seconds, with all
2417 measured inputs unchanged. The final log reports 522 files (6 failed / 516 passed)
and 4109 cases (31 failed / 4077 passed / 1 skipped).

Healthy accounts for 25 failures among 26 cases and 3464.820 seconds of file time:

| Group | Cases | Final failure |
| --- | ---: | --- |
| Selected and removed full RETURN/REENTRY positives | 2 | Timeout |
| Final lease rollback except selected RETURN | 3 | Timeout |
| All selected/removed REENTRY drift cases | 10 | Timeout |
| All selected/removed RETURN drift cases | 10 | Expected `outcome_unknown`, received `failed` |
| Selected RETURN final lease rollback | 1 | Passed in 48.622 seconds |

The ten RETURN drift failures reached the final status assertion. Their earlier
`injected === true` and complete `after === before` rollback assertions passed.
Source/log references are the original test line 102 and whole log lines 2331-2357,
2886-2959. Vitest grouped errors at shared registration sites; a group's displayed
60000-ms message does not establish that every removed 180-second argument was ignored.

The registered nominal budget is 19 x 60 + 7 x 180 = 2400 seconds (40 minutes).
Synchronous validation and microtask work can delay a real timeout callback, so the
57-minute-45-second file result can exceed that sum. This does not establish a
performance cause or justify a permanent budget change. Earlier isolated selected
and removed results (46.576 and 122.423 seconds) are historical measurements only.

The failed whole-run temporary root remains untouched:
`H:/TakiAgent/.trellis/.runtime/b3-whole-checks/core-tests-01-78638aea306d4d6e8634637615cb8262`.
The original failed artifacts and D2 read-only notes are preserved without rewriting
their historical pending observations into a pass.

## Existing durable state contract

The production path explicitly supports a proven RETURN failure with source recovery:

1. `transition-healthy-execution.ts:75-85` attempts factual abort after a pre-COMMIT
   error while the executor still owns a live lease and signal. An exception alone
   never proves cancellation.
2. `transition-healthy-execution.ts:187-227` requires positive Native abort outcomes
   for every dispatched Bank before sealing any undispatched scope. Prepared REENTRY
   deltas refuse this abort path and retain uncertainty.
3. `memory-transition-abort.ts:20-35` requires no publication receipt, complete
   `release.disposition === "source-aborted"`, no executed queue intent and cancelled
   queued work. With `failed: true`, it persists exactly:

   ```text
   result.kind = transition
   result.receiptId = null
   result.authorityCommitted = false
   result.runtime = source
   result.queue = settled
   result.outcome = failed
   result.errorCode = MEMORY_TRANSITION_UNAVAILABLE
   ```

4. `transition-runtime.ts:102-114` verifies the stored release and selected predecessor
   epoch before reconstructing the source runtime. Publication spec lines 143-146
   explicitly permit this same-epoch fresh instance after complete positive abort;
   old references remain retired.

Accordingly, RETURN drift may correctly finish `failed` after full rollback and a
proven source abort. Final lease exhaustion cannot prove the abort; prepared REENTRY
cannot pretend its deltas were cancelled. Both remain `outcome_unknown`.

The diagnostic must distinguish this from the generic operation exception catch
(`memory-operation-service.ts:171-174`), which also returns `failed` but has null
result and no such proof. No expectation is changed before collecting the complete
resolution, Native outcomes and actual binding metadata. Binding metadata is detached
observation, not an additional authority certificate.

## Temporary instrumentation and non-interference

Exact original source bytes are in `b3-core-healthy-phase-diagnostic-01-before.txt`
(7705 bytes; SHA-256
`6642e91f58ad6b542fe95f84685d25729147cdca266072b646155e67ebb9aa10`).
The instrumented image is `b3-core-healthy-phase-diagnostic-01-source.txt`
(12162 bytes; SHA-256
`c3ec50f5cf768e866b19bf504784dff752438efa42d3403855d36359805480dd`).
The companion JSON records source identities, selected names and exact argument arrays.

- Only selected positive and selected RETURN selection-drift enable the probes.
- Monotonic `performance.now()` surrounds existing setup, preview, submission,
  owner settlement, proof, publication, assertion and close boundaries. Fake Date,
  `h.clock`, production lease/preview TTL, fake Native behavior and 60/180-second
  arguments stay unchanged.
- Synchronous proof/publication spies invoke the original function exactly once with
  the same argument, result and throw. They only collect in-memory timing marks.
  There is no added await, yield, retry or scheduler. The existing drift injection
  and complete before/after database comparison remain intact.
- After owner settlement, the probe saves the complete operation, attempt, receipt,
  checked resolution, raw selection row, detached Local/Hindsight binding state and
  Native per-Bank outcomes already present in `remote.status`. No extra Native call
  or full authority validation is introduced. Observation overhead has separate marks.
- One JSON stderr record is emitted after the existing `h.close()` per representative.
  Its tag is `B3_HEALTHY_PHASE_DIAGNOSTIC`. The diagnostic's original red assertion
  remains and is expected to fail if the existing proven-abort contract is confirmed.
- Static readback confirms all 14 original assertion lines, all 26 registered cases,
  all registration/budget lines and all 16 existing await expressions remain present.
  The specialized fixture and original D2 file retain their pre-diagnostic hashes.

No production, fixture, permanent timeout, dependency or configuration change was made.
This temporary source must be removed after diagnosis using the guarded original image;
any real repair and its verification remain a separately reviewed step.

## Exact proposed serial commands

Run in `H:/TakiAgent`, after the root grants the sole slot. The Healthy pattern matches
only the two selected representatives among the complete 26-name matrix.

```powershell
& 'G:/Roaming/npm/pnpm.cmd' --filter '@taki/core' exec vitest run 'src/memory/transitions/transition-template-healthy.test.ts' --maxWorkers=1 --testNamePattern "(?:preserves full template history across RETURN and REENTRY \(removed=false\)|refuses 'selection' drift after complete 'transition\.return-local' readback \(removed=false\) with atomic rollback)$"
& 'G:/Roaming/npm/pnpm.cmd' --filter '@taki/core' exec vitest run 'src/memory/hindsight/hindsight-capture-sync.test.ts' --maxWorkers=1 --testNamePattern '\(D2\)$'
```

No CLI timeout override is present. Healthy retains explicit per-test limits; D2 retains
Vitest's original 5000-ms default. D2's final whole-run error is a 5000-ms timeout
(5347-ms case duration), replacing the earlier incomplete-log hypothesis without
discarding that earlier note. Its fake 7500-ms admission and eight 2500-ms commits
still exercise real SQLite/hash work; this original single-worker case is the first
discriminator before any further D2 change.

Stage 5B remains pending. No 5C, real-data/model, Git mutation, finish or archive action
is included. The other four old-test repairs remain owned by `/root/native_independent`.
