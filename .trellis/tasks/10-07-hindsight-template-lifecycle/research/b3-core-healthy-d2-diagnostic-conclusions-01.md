# B3 Healthy and D2 diagnostic conclusions

Owner: `/root/core_independent`. Both authorized original-budget diagnostic commands
have ended. Their source recorder found all 1599 inputs unchanged in each run, and
both owned temporary directories were empty before removal. No check is currently
running for this owner. The Healthy instrumentation stays frozen pending the root's
next source window; the permanent patch below is only a research proposal.

## Confirmed findings

| Diagnostic | Result | Boundary |
| --- | --- | --- |
| `b3-core-d2-default-diagnostic-01` | Exit 1; default 5000-ms timeout; 23.194-second wrapper; 1 failed / 9 skipped | Single-worker isolation did not remove the timeout. No assertion-completion result exists yet. |
| `b3-core-healthy-phase-diagnostic-01` | Exit 1; 146.023-second wrapper; 2 failed / 24 skipped | Selected positive timed out; selected RETURN selection drift retained its expected red status assertion. |

The drift case proves a complete safe failure: the non-null transition result has
`receiptId:null`, `authorityCommitted:false`, `runtime:source`, `queue:settled`,
`outcome:failed`, and `MEMORY_TRANSITION_UNAVAILABLE`. Its durable resolution has
`release.disposition:source-aborted`; both Native Bank outcomes are `aborted` /
`source_resumed`. There is no publication receipt, and the original Hindsight epoch
remains selected and published. Earlier full-row rollback assertions passed.
This is the existing factual abort path, not the generic `failed` / null-result catch.

Full results, operation/attempt identities, resolutions, Native outcomes and marks are
in `b3-core-healthy-phase-diagnostic-01-observed.json` (SHA-256
`bb33d3ee09907736e0f903c5d28012144de2f6e421952442a33b038c8936a7c0`).

## Timeout and clock causality

The positive case was reported timed out at 79.164 seconds, shortly after REENTRY
publication ended at 79.137 seconds. Its callback nevertheless continued until
125.858 seconds. The subsequently started drift callback completed and emitted its
record first (log line 4); the positive callback emitted later (line 32).
This establishes overlap after timeout; the positive's late terminal status is not
an uncontaminated normal execution result.

The corresponding code path explains the late lease-loss symptom:

1. The Healthy harness injects `h.clock` into the driver (`memory-transition-healthy-fixtures.ts:63,75`).
2. `transition-runtime.ts:30` creates the queue executor without a `now` override.
3. `transition-intent-executor.ts:26` therefore uses `new Date().toISOString()`;
   its first execution check at line 38 calls `requireTransitionLease`.
4. `memory-transition-repo.ts:89-97` rejects time at or after the saved lease deadline.
5. The test's `afterEach` restores real Date after timeout, while the original callback
   is still active. The saved lease ends on October 1; real wall time is October 13.

The late positive result was committed REENTRY with a receipt, two activated Banks,
published Hindsight binding and `outcome_unknown` in `settling`, logged as
`MEMORY_TRANSITION_LEASE_LOST`. This is consistent with that teardown clock change.
The actual Date value at the throw was not instrumented, so the exact clock value is
an inference grounded in code and timing, not a captured measurement. Do not classify
it as an independent production defect or claim the positive completed successfully.

## Measured phase durations

All numbers below are seconds; the final positive REENTRY settlement interval is
contaminated by the timeout and overlapping case.

| Phase | Positive RETURN | Positive REENTRY | RETURN selection drift |
| --- | ---: | ---: | ---: |
| Preview | 0.565 | 0.954 | 0.662 |
| Synchronous submit | 1.265 | 1.314 | 1.015 |
| Submit return to proof entry | 29.323 | 33.316 | 29.978 |
| Proof | 0.873 | 1.023 | 0.882 |
| Publication | 1.504 | 2.004 | 1.048 |
| Publication return to owner settlement | 4.287 | 46.698 (contaminated) | 2.077 |

Positive setup was 2.607 seconds; drift setup was 3.689 seconds and its full callback
was 39.432 seconds. Diagnostic state observation was only a few milliseconds. The
dominant pre-timeout interval precedes proof; this coarse probe does not identify
which candidate/Native/validation substage accounts for it.

## Small permanent assertion proposal

`b3-core-healthy-return-minimal-proposal-01.patch.txt` is an unapplied diff against
the exact pre-instrumentation image (SHA-256
`7b569920a9ba6a73f24e4a7e4028eee37ae1c977c45b2729f3d28d2492b22da3`).
It keeps the full-row rollback and all case names/budgets. Only the RETURN drift
branch requires the non-null failed transition result and a matching stored
`source-aborted` resolution using existing `toMatchObject` and `readTransitionResolution`.
REENTRY and independent final-lease tests retain `outcome_unknown`.
Existing proof-contract tests already check release hashes and all-Bank membership;
the proposal adds no helper, proof reimplementation, Native matrix or binding validator.

## Proposed next measurements: not yet executed

The root accepted this next step in principle and will explicitly release both the
source window and sole check slot after the old-test owner finishes. Until then all
source/spec/script files remain frozen. The next measurements use fresh recorder
suffixes and run serially:

1. Change only the selected positive's effective explicit local timeout from 60000
   to 180000 in the existing instrumented registration. Removed positive remains
   180000; every other budget, assertion, clock and fixture stays unchanged. Run
   this one positive case alone, with no drift case following it.
2. Run the unchanged D2 case alone with a CLI 30000-ms measurement envelope. Its
   7500-ms fake admission and exact-once binding assertions remain unchanged.

```powershell
python '.trellis/tasks/10-07-hindsight-template-lifecycle/research/run-b3-core-source-check.py' 'healthy-positive-180s-measurement-01' 'H:/TakiAgent' 'G:/Roaming/npm/pnpm.cmd' '--filter' '@taki/core' 'exec' 'vitest' 'run' 'src/memory/transitions/transition-template-healthy.test.ts' '--maxWorkers=1' '--testNamePattern' 'preserves full template history across RETURN and REENTRY \(removed=false\)$'
python '.trellis/tasks/10-07-hindsight-template-lifecycle/research/run-b3-core-source-check.py' 'd2-30s-measurement-01' 'H:/TakiAgent' 'G:/Roaming/npm/pnpm.cmd' '--filter' '@taki/core' 'exec' 'vitest' 'run' 'src/memory/hindsight/hindsight-capture-sync.test.ts' '--maxWorkers=1' '--testNamePattern' '\(D2\)$' '--testTimeout=30000'
```

Neither measurement is approval of a permanent timeout change. After measurements,
coordinate removal of temporary instrumentation and apply only the agreed permanent
fix. Lint/typecheck were not allocated to this diagnostic window; final corrected
source still needs the root-managed quality gate. Stage 5B remains pending.

## Follow-up completion

The above pending steps subsequently completed under separate root authorizations;
their original proposed state and failed diagnostic evidence are preserved.
The isolated 180-second positive passed in 59.776 seconds, with both RETURN and
REENTRY fully completed and no error log. The original D2 with a 30-second CLI
measurement envelope passed in 3.493 seconds with all original assertions intact.

Root reviewed and approved `b3-core-healthy-capture-final-proposal-01.patch.txt`.
The final source removes all probes, adds only the existing result/resolution checks
for proven RETURN abort and sets the approved local test budgets. Guarded application
changed only those two test files among 2417 maintained inputs.

- Complete Healthy/capture-sync: `b3-whole-core-healthy-capture-tests-01-result.json`,
  exit 0, 36/36 cases, 1515.516 seconds.
- Core typecheck: `b3-whole-core-healthy-capture-typecheck-01-result.json`,
  exit 0, 39.454 seconds.
- Both checks retained 2417 unchanged inputs, no fixture leftovers and removed TEMP.
  No additional test or typecheck was run after this release.
- Root's subsequent Healthy spec wording update is documentation only; final lint
  and combined Stage 5B acceptance remain root-owned.

The old full-Core temporary root is no longer pending cleanup. Root's separate
`b3-whole-core-tests-01-cleanup-readback-01.json` records its bounded removal while
preserving the original failed result bytes. This reviewer did not delete that root.
