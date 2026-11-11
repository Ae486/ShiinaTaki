# Phase 2 wave 2b - committed policy review notifications

## Scope and result

The notification increment runs in `H:/TakiAgent`, `main`, HEAD `ba5be72` under the
session-scoped `08-09-memory-operations-ui` task. It preserves inherited dirty work
and the completed Home slice. No Git writes, dependency changes, credentials,
original data, Native/PostgreSQL stack or paid model calls were performed.

Home already listens to `memory.replica.changed` through `memory.operations.subscribe`
and coalesces dirty reads. The producer gap was that schedule saves and first saved
curator results did not publish into that channel. They now use one optional
`onPolicyReviewChanged(bankId)` port through the existing runtime composition.

The production chain is:

`PolicySchedule.save / policy-work first saveResult or terminal transition`
-> successful existing save/atomic boundary
-> subsystem callback
-> MemoryRuntimeInput callback supplied by main
-> existing connection subscription publish({bankId})
-> registered memory.operations.subscribe
-> memory.replica.changed
-> Home dirty refetch
-> registered memory.authority.status over the current Core producer evidence.

`main.ts` constructs the existing channel before runtime composition and still
passes the same instance to operation and replica method registration. The
composition spread forwards the callback into every newly constructed/replaced
Hindsight subsystem. At subsystem stop entry, its mutable callback reference is
cleared before producers are stopped or awaited. A late shutdown save can retain
durable recovery evidence without publishing a stale runtime hint.

## Failure cases established before implementation

- A rejected/uncommitted journal or schedule write must not notify.
- Claim/prompt/prepare and idempotent saved-result replay must not notify.
- A first saved result must notify while a later model response is still held.
- Completed/superseded journal work must notify after the original atomic boundary;
  a fresh authority read must show current terminal counts.
- Pending/running/paused/error/idle schedule saves must reach operator observers.
- Stop entry must suppress hints from the retired runtime's later drain.
- Multiple subscribers, one dead sink, disconnect cleanup and reconnect must use
  the registered channel and fresh Core read rather than stored UI state.

## Owned delta

Production files:

- `packages/core/src/db/hindsight-policy-work-repo.ts`: first-save flag inside the
  existing result branch; notify only after claimed/atomic returns; terminal
  completed/superseded transitions notify after the same boundary.
- `packages/core/src/memory/hindsight/hindsight-policy-schedule.ts`: notify after
  the existing successful repository save.
- `packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts`: share the
  callback between work and schedule owners, clear it at stop entry.
- `packages/core/src/memory/runtime-composition.ts`: optional input port, forwarded
  through the existing constructor spread.
- `packages/core/src/main.ts`: earlier construction and reuse of the existing
  replica channel; publish only `{bankId}`.

Tests/fixtures: extended `hindsight-policy-work-repo.test.ts`,
`hindsight-policy-schedule.test.ts`, `hindsight-policy-schedule-wiring.test.ts`;
added `hindsight-policy-review-notifications.test.ts`. With leader approval, only
optional callback signature/forwarding changed in
`hindsight-runtime-composition-fixtures.ts` and `hindsight-policy-curator-fixtures.ts`.
Updated the five relevant source folder indexes and module contracts. No D105
runner, Bank service, writer, publication, Desktop, Shared or template code changed
in this owned increment.

Pre-edit copies are under
`G:/taki-codex-work/tmp-p2w2b-notifications/baseline`; the owned comparison is
`owned-delta.diff` in the same artifact directory. This comparison is against the
inherited working copy, rather than HEAD, so it excludes earlier dirty work.

## Verification

Windows PowerShell, Node 24.18.0 / pnpm 10.22.0 / Vitest 4.1.10. All Node checks
ran serially with `NODE_OPTIONS=--max-old-space-size=1536` and
`TEMP=TMP=G:/taki-codex-work/tmp-p2w2b-notifications`. The check slot was coordinated
with the leader; no parallel heavy check or Native/PostgreSQL stack ran.

| Command | Result / evidence |
| --- | --- |
| `pnpm --filter @taki/core exec vitest run src/db/hindsight-policy-work-repo.test.ts src/memory/hindsight/hindsight-policy-schedule.test.ts src/memory/hindsight/hindsight-policy-schedule-wiring.test.ts src/memory/hindsight/hindsight-policy-review-notifications.test.ts --pool=threads --maxWorkers=1` | 4 files, 33 tests passed; `focused-tests.log` |
| `pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-policy-schedule.test.ts --pool=threads --maxWorkers=1` | 1 file, 16 tests passed after adding the failed schedule-save case and paused-state assertions; `schedule-final-tests.log` |
| `pnpm --filter @taki/core typecheck` | Initial run reported only the new WS fixture's missing required `onPairingCode`; corrected with the existing callback contract. No rerun here: leader requested one combined Core typecheck after D105 integration; `core-typecheck.log` preserves the original failure. |
| Root `pnpm exec eslint` on all 11 owned TS paths listed above | Passed, exit 0 in the worker tool result; exact invocation in `validation-commands.ps1`. No output log was created because ESLint emitted no output. |
| `git diff --check --` all 17 owned paths | Passed, exit 0; Git reported only LF normalization advisories for the five edited indexes. |

The complete commands and environment are retained as `validation-commands.ps1`
in the G: artifact directory. The command script is a reproduction aid; it was
written after the separately recorded checks and was not rerun as another gate.

The loopback test uses the actual composed runtime, repository/curator work,
operation service, `connect`, `memory.operations.subscribe`, `memory.authority.status`
and WS server. It holds a simulated model response after saving two answers,
receives actual socket invalidations on two operator connections despite a throwing
third sink, and reads `running / null eligibility / saved=2` from Core. After release,
it reads completed zero counts and completion timestamps, closes one socket,
checks membership cleanup, authenticates/re-subscribes a replacement and obtains the
same fresh review state. The separate shutdown fixture stops during that held
phase and verifies a durable paused row with no additional notification.

## Cost, tradeoffs and open gates

The increment adds no DB query, state readback, hashing, decoding, schema validation,
timer, polling loop, general database observer or scheduler.changed feedback. It
reuses the existing first-save branch to suppress result replay hints. The added
work per successful mutation is an optional callback and the existing fanout over
connected subscribers. The callback reference is lifetime state, not a cached
authority verdict. Existing validation/admission/COMMIT boundaries are unchanged.

Every successful schedule save can emit an invalidation even if its visible values
match the previous save. No equality reread or extra cached representation is added;
Home's existing dirty coalescing bounds overlapping refetches. Fanout isolates sink
exceptions, remains best effort and has no durable delivery guarantee. Reconnect
recovers truth through current Core status, rather than replaying invalidations.

These tests use real SQLite and real loopback WS with simulated Native and model
providers. They do not prove real Native/model concurrent review, provider process
crash recovery, installed build behavior, owner UX acceptance or original-data
activation. Those existing wave-2b/manual gates remain open. The final combined
Core typecheck passed after D105 integration and the final test edit; evidence is
`G:/taki-codex-work/tmp-p2w2b-convergence/core-typecheck-final.log`. The initial
fixture type error above is preserved as failed-attempt evidence, not an open
failure. The leader's bounded final review covers this small combined stage.
