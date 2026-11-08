# P1-Z: accepted Native writes resume polling independently of delivery failures

## 1. Outcome — done

Implemented the leader's row and Bank retry rules within the assigned boundary. An accepted row with
`HINDSIGHT_PENDING_REMAINS` now selects the first existing retry rung at least as large as its age since
`acceptedAt`, capped at six hours. A failed scheduled run requests the earliest active-epoch Pending row retry
only after failure settlement has cleared `run`. Attempt counters, `forceRetry`, operation identities, terminal
transitions and failed-run reporting are preserved. [source packages/core/src/db/pending-memory-transition.ts:78]
[source packages/core/src/memory/hindsight/hindsight-replica-run-execution.ts:86]
[source packages/core/src/db/hindsight-replica-schedule-state.ts:68]

For Journey 13's supplied sequence, acceptance at **17:22:07.194 UTC** and the pending read at
**17:22:07.249 UTC** imply both the row and Bank become due at **17:23:07.249 UTC**. Because the recorded Native
operation finished at 17:22:08.083, expected settlement is around **17:23:07 UTC plus the existing recovery and
pull time**, within the recorded 17:27:08 harness deadline if there is no new fault or competing Bank delay.
This is an expectation from the supplied timestamps and verified scheduling behavior, not a rerun result.
[inference] [source packages/core/src/db/pending-memory-transition.ts:78]
[run artifact .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-07T17-09-42.645Z/core-pending-restart.log]

The reported Pending failure was confirmed in the saved Core log and result. The retained database and Native
timeline were not re-derived. No Core, Native, PG, Home or journey process was started.
[run artifact .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-07T17-09-42.645Z/result.json]

## 2. Changes

| File | Purpose |
| --- | --- |
| `packages/core/src/db/pending-memory-transition.ts` | Restart only accepted `HINDSIGHT_PENDING_REMAINS` polling by elapsed acceptance age; preserve the existing attempt ladder otherwise. |
| `packages/core/src/db/hindsight-replica-scheduler-repo.ts` | Expose `nextPendingRetryAt(bankId)` as one aggregate read over that Bank's nonterminal Pending phases in the active Authority Epoch. Move the existing manual-request admission handler intact into a named local function, keeping construction/wiring separate from its mutation logic. |
| `packages/core/src/memory/hindsight/hindsight-replica-run-execution.ts` | After successful `fail`, read that time and call the existing `requestRetry`; never arm against an active run's lease. |
| `packages/core/src/db/pending-memory-repo.test.ts` | Add five cases for two/five failed deliveries, stuck-operation decay, unaccepted Pending retries and accepted non-Pending errors, including forced claims. |
| `packages/core/src/memory/hindsight/hindsight-pending-recovery.test.ts` | Add tracked Native recovery with real subsystem/SQLite/checkpoint settlement, and two-row ordering with an early wake that leaves future work unclaimed. |
| `packages/core/src/memory/hindsight/hindsight-replica-scheduler.test.ts` | Add automatic timer delivery after failure with a row time beyond the former lease expiry. |
| `packages/core/src/db/index.md` | Update the scheduler query and Pending transition descriptions. |
| `packages/core/src/memory/hindsight/index.md` | Update the execution owner's post-failure wake contract. |
| `.trellis/spec/backend/memory-replica-sync.md` | Update the requested retry rules and repository signature, including equality, ordering, early wakes and unchanged reporting. |
| This report | Record outcome, checks, costs and remaining real-journey evidence. |

Production module headers were updated. No Shared, prompt/template, journey harness, Memory transition, leader
plan or completed prompt record was edited. The original copies and exact delta, excluding inherited edits,
are retained below. [run artifact G:/taki-codex-work/tmp-z/baseline/]
[run artifact G:/taki-codex-work/tmp-z/p1z.patch]

## 3. Evidence and checks run

Failure modes were listed before tests or production edits:

1. Two failed deliveries contaminate the first accepted poll with the 15-minute rung.
2. A long outage contaminates it with the six-hour rung.
3. A permanently pending Native operation must still decay through the restarted ladder to the cap.
4. Delivery errors and unaccepted rows must retain their attempt ladder and forced-claim semantics.
5. Bank failure must neither overwrite the earlier row time nor shorten a later row time to lease expiry.
6. Two Pending rows must select the earlier time; a premature Bank wake must leave a future row unclaimed and
   return to a future wake rather than immediately repeat.

All test commands ran from `H:/TakiAgent` with PowerShell process-local
`$env:TEMP='G:/taki-codex-work/tmp-z'; $env:TMP=$env:TEMP`, Node **v24.18.0**, pnpm **10.22.0** and Vitest
**4.1.10**. Vitest used `--pool=threads --maxWorkers=2`; no suites were run concurrently with another Vitest run.

Red/green evidence:

- `pnpm exec vitest run packages/core/src/db/pending-memory-repo.test.ts --pool=threads --maxWorkers=2 -t 'polls one minute after acceptance'`:
  red **2 failed** with actual delays **900000** and **21600000 ms**, expected **60000 ms**; after the row change,
  **2 passed**. [run artifact G:/taki-codex-work/tmp-z/row-red.log]
  [run artifact G:/taki-codex-work/tmp-z/row-green.log]
- `pnpm exec vitest run packages/core/src/memory/hindsight/hindsight-pending-recovery.test.ts --pool=threads --maxWorkers=2 -t 'settles the accepted tracked write'`:
  red **1 failed** at Bank due time **00:20:07.800** versus expected **00:06:07.800**, while the corrected row was
  already due in one minute; after Bank wiring, **1 passed**. The test observes the original tracked operation
  become `completed` with native proof and a matching applied checkpoint. [run artifact G:/taki-codex-work/tmp-z/bank-red-tracked.log]
  [run artifact G:/taki-codex-work/tmp-z/bank-green.log]
- An earlier legacy-fixture attempt failed before the target assertion because missing legacy operations correctly
  become `HINDSIGHT_PENDING_OUTCOME_UNKNOWN`. It was replaced with the existing tracked Native fixture; the
  legacy refusal was preserved. That attempt is not counted as valid red evidence for P1-Z.
  [run artifact G:/taki-codex-work/tmp-z/bank-red.log]

Final checks:

```powershell
pnpm exec vitest run packages/core/src/db/pending-memory-repo.test.ts packages/core/src/memory/hindsight/hindsight-pending-recovery.test.ts packages/core/src/memory/hindsight/hindsight-replica-scheduler.test.ts packages/core/src/db/hindsight-replica-scheduler-repo.test.ts packages/core/src/memory/hindsight/hindsight-memory-write-deadline.test.ts --pool=threads --maxWorkers=2
pnpm --filter @taki/core typecheck
pnpm --filter @taki/shared typecheck
pnpm exec eslint packages/core/src/db/pending-memory-transition.ts packages/core/src/db/hindsight-replica-scheduler-repo.ts packages/core/src/memory/hindsight/hindsight-replica-run-execution.ts packages/core/src/db/pending-memory-repo.test.ts packages/core/src/memory/hindsight/hindsight-pending-recovery.test.ts packages/core/src/memory/hindsight/hindsight-replica-scheduler.test.ts
git apply --reverse --check G:/taki-codex-work/tmp-z/p1z.patch
```

- **140 tests passed in five files**. This includes existing restart/reopen, terminal/native-proof, manual-only,
  request identity and foreground write regressions. [run artifact G:/taki-codex-work/tmp-z/focused-final.log]
- Core typecheck initially caught nullable-property narrowing inside the rung-selection callback. Capturing
  `acceptedAt` in a local constant resolved it without a cast; the affected full row suite then passed **28/28**.
  These 28 overlap the 140 and are not additional cases. Final Core and Shared typechecks passed.
  [run artifact G:/taki-codex-work/tmp-z/core-typecheck.log]
  [run artifact G:/taki-codex-work/tmp-z/row-final.log]
  [run artifact G:/taki-codex-work/tmp-z/core-typecheck-verified.log]
  [run artifact G:/taki-codex-work/tmp-z/shared-typecheck.log]
- ESLint initially reported 51 lines in the 50-line scheduler factory. The existing manual-request handler was
  extracted as one cohesive local operation; its validations, clock and transaction path were retained and its
  existing suite passed. Final six-file ESLint passed, with no rule suppression or threshold adjustment.
  [run artifact G:/taki-codex-work/tmp-z/eslint.log]
  [run artifact G:/taki-codex-work/tmp-z/eslint-verified.log]
- Exact-patch reverse checking, scoped `git diff --check`, UTF-8/no-BOM and unchanged LF line endings passed.
  The patch was reviewed against the starting copies, not against HEAD's inherited changes.
  [run artifact G:/taki-codex-work/tmp-z/delta-check.log]

**Existing assertions converted: none.** In particular, the existing scheduler test with no actual Pending rows
continues to expect the ordinary five-minute Bank backoff. The override requires an actual row retry timestamp.
[source packages/core/src/memory/hindsight/hindsight-replica-scheduler.test.ts:106]

No process-spawning suite was needed by these focused checks, and no `EPERM` occurred. No full-suite, Core boot,
Native/PG run, journey or manual acceptance is claimed. Owned fixture databases/schedulers were closed by test
cleanup; only the requested baselines/patch/logs and Node's compile cache remain under the temporary root.

## 4. Trade-offs

- Accepted work is polled sooner after an outage, adding recovery I/O compared with the contaminated backoff.
  Stuck work still reaches six-hour spacing; no new timer, ladder, counter, schema or migration was added.
  Exact equality retains the matching rung, and a delayed poll can skip smaller rungs because the input is age,
  not the number of polls. [source packages/core/src/db/pending-memory-transition.ts:78]
- A `HINDSIGHT_PENDING_REMAINS` run adds one aggregate SQLite query and, when a row time exists, the existing
  retry-request mutation after failure settlement. The query inspects active-epoch Pending rows for one Bank;
  historical epochs and terminal audit rows cannot drive the wake. Failure and retry request remain separate
  synchronous repository transactions, with no intervening await. No large-backlog performance measurement was
  performed. [source packages/core/src/db/hindsight-replica-scheduler-repo.ts:100]
  [source packages/core/src/memory/hindsight/hindsight-replica-run-execution.ts:97]
- The Bank may still wake before a row is due when its own backoff is shorter. That can perform another first
  pull and increment the existing failed-run counters, but does not claim the future row or form a tight loop.
  Manual-only Banks continue to require explicit work. [source packages/core/src/db/hindsight-replica-schedule-state.ts:68]
  [source packages/core/src/memory/hindsight/hindsight-pending-recovery.test.ts:105]
- The scheduler repository now has one additional read method and one extracted existing manual-admission helper.
  This adds a small internal API/indirection cost; the Shared API and manual-request semantics are unchanged.
  [source packages/core/src/db/hindsight-replica-scheduler-repo.ts:37]
  [source packages/core/src/db/hindsight-replica-scheduler-repo.ts:84]

## 5. Open items / UNKNOWN

- **Actual Journey 13 settlement time: UNKNOWN.** The leader must rerun the unchanged journey. The expected due
  time above is not service or real-model acceptance.
- The new tracked test uses the actual subsystem, repositories and proof/checkpoint paths with controlled Native
  methods and a fake Date. The Native fixture publishes synthetic facts when invoked, then withholds completion
  proof until the test reveals it 900 ms later. It proves Core's wait/recovery behavior, not Native worker timing,
  extraction quality, real HTTP/PG behavior or cross-process restart. Existing reopen tests passed independently.
  [source packages/core/src/memory/hindsight/hindsight-pending-recovery.test.ts:54]
- The timer-specific test substitutes only the Pending retry lookup; the two-row recovery test separately uses
  actual Pending rows and SQLite. Their combination does not prove Windows timer precision or freedom from
  serial-Bank backlog in a live run. [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.test.ts:122]
  [source packages/core/src/memory/hindsight/hindsight-pending-recovery.test.ts:105]
- No implementation or required focused check remains open within P1-Z. Independent leader review and real-journey
  acceptance remain separate. No commit, push, task lifecycle command or original-user-data action was performed.

## 6. Anything outside scope noticed

Home still receives `mode: "failed"`, `errorCode: "HINDSIGHT_PENDING_REMAINS"` and increasing
`consecutiveFailures` while Native is merely working. This is the leader's known **phase 3 presentation issue**;
P1-Z deliberately preserves those run-result semantics and makes no UI change.
[source packages/core/src/db/hindsight-replica-schedule-state.ts:79]

No additional verified out-of-scope defect was identified.
