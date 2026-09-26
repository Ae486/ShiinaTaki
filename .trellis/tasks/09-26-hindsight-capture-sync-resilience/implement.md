# Implement: Hindsight capture sync resilience (D1-D3)

## Root causes (confirmed in source at HEAD 23c5110; line numbers are pre-change)

- D1: `hindsight-memory-runtime.ts:82-89` (`synchronizeForCapture`) degraded only availability codes and rethrew
  everything else. The bind loop `hindsight-application-sync-runner.ts:127-131` had no conflict handling, so a durable
  refused receipt (`HindsightApplicationRefusal`, `hindsight-application-binding-runner.ts:160-163`) whose
  `expected_native` came from the stale pull (`:86-95`) failed the whole sync. Native consolidation that bumps a unit's
  revision between Core's pull and its binding commit is a normal race, so `chat.send` returned -32603.
- D2: binding commits one unit per pass (`hindsight-application-binding-runner.ts:73`, `limit: 1`) followed by an
  incremental pull (`hindsight-application-sync-runner.ts:127-131`). Foreground mode has no deadline
  (`hindsight-runtime-bank-service.ts:68-73`) and its queued waiter only observes cancellation (`:106-117`); capture
  awaited all routed Banks serially. Ack latency was therefore linear in new native units.
- D3: `server/method-registry.ts:97-103` returned -32603 for a non-`JSONRPCErrorException` throw without logging.

## Fix

- R2: `hindsight-application-sync-runner.ts:134-158` `bindPasses`: a refused binding receipt with
  `native_version_conflict` / `artifact_conflict` re-pulls (`incremental`) and rebinds; at most
  `BIND_CONFLICT_RETRIES = 3` consecutive conflicts (`:29`), then the run fails with the closed code. Lives in the sync
  runner, so foreground, background and scheduled syncs all benefit.
- R1/R3: new `hindsight-capture-sync.ts` `synchronizeHindsightCapture` replaces `synchronizeForCapture`:
  - Admission budget = `min(requestTimeoutMs, floor(chatAckMs / 2))` (leader ruling, closes the ack-vs-budget gap):
    `requestTimeoutMs` is `TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS` (default 10000, captured with the connection; a change
    drifts the connection until revalidate), `chatAckMs` is the effective `TAKI_CHAT_ACK_TIMEOUT_MS` resolved from
    ConfigSource at every capture (invalid/unset -> 15000). Defaults give 7500 ms. The reader is composed in
    `hindsight-memory-subsystem.ts` (`admissionBudgetMs`) and passed to the runtime as `admissionBudgetMs()`; each HTTP
    call of the sync keeps its `requestTimeoutMs` allowance. No new knob.
  - Banks sync serially in foreground mode under an owner `AbortController`. Caller cancellation is forwarded only
    within the budget; afterwards the sync is detached but still owned and tracked by the Bank service (`active`,
    settled by `stop()`/`settle()`), so binding is never abandoned. Later syncs reuse the durable intent-digest request
    ids/receipts, so there is no duplicate commit.
  - Outcomes per Bank: still running at budget -> `deferred` (`HINDSIGHT_DEADLINE_EXCEEDED`); cancelled -> rethrow;
    `MEMORY_INTEGRITY_ERROR` / `MEMORY_AUTHORITY_MISMATCH` / `MEMORY_REQUEST_ID_CONFLICT` -> `refused`, rethrow;
    anything else -> `degraded`. Unknown internal errors degrade because publication is atomic and guarded, so a
    degraded Run cannot observe a half-written replica.
  - Any unsynced Bank makes the Run `partial` (readable replica, in-Run recall fallback) when capability evidence
    exists, or a memory-unavailable Run (`admission_unavailable`) when it does not.
  - A detached Bank that later fails reports `background_failed`.
- `hindsight-memory-provider-context.ts:136` exports the existing classifier as `hindsightMemoryErrorCode` (was the
  private `publicCode`) so capture reuses one failure taxonomy.
- `hindsight-memory-runtime.ts:65` calls it; new `onSync` input. `hindsight-memory-subsystem.ts:110` `logCaptureSync`
  logs each event once: error for `refused`, warn otherwise; closed code only, never a raw message.
- R4: `method-registry.ts:110` `internalError` logs `{ method, code }` once at error, where `code` is the message only
  if it is CONSTANT_CASE, else the error class. Params, bodies and free text are never logged; `JSONRPCErrorException`
  is not logged. Used for handler throws and `onInvalidParams` throws. `main.ts:223` passes the Core logger.
- Test fixture: `hindsight-policy-curator-fixtures.ts` now answers a stale artifact/native CAS with a durable refused
  receipt (as native does) instead of a plain Error.
- W2 is not regressed: `hindsight-writer-fence.ts:42-44` still keeps Run capture (and its sync) open during a backup
  capture; the fence and its tests are unchanged and pass in the full Core run.

## Timing relation

Closed in this task: the admission wait can no longer exceed the client's `chat.send` ack deadline (`chatAckMs`,
default 15000, `packages/shared/src/timing-policy-schema.ts:61`), since it is at most half of it whatever
`TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS` (up to 120000) is set to. The other half covers the rest of admission (cold step-5
ack was about 7.5 s).

## Tests

- `hindsight-capture-sync.test.ts` (new, transport double via `hindsightRuntimeFixture`):
  - D1: native consolidation races one binding commit -> 1 refused `native_version_conflict` receipt, re-pull, 1
    completed commit, full Run, no sync log, replica at the remote head.
  - R2 -> R1: 4 consecutive conflicts -> partial Run with tools + automatic recall, one warn `degraded`
    `HINDSIGHT_APPLICATION_NATIVE_VERSION_CONFLICT`; a later sync converges with exactly 1 completed commit.
  - R1: an arbitrary `TypeError` during the pull -> partial Run, warn `MEMORY_INTERNAL_ERROR`, raw message never logged.
  - Integrity: corrupted event hash -> capture rejects with a closed code, one error `refused` log, replica unchanged.
  - D2/R3: 8 pending units, 2.5 s per commit -> capture resolves exactly at the 7500 ms default budget with some but not all
    units bound; a second Run queued behind it is bounded the same way; after timers drain every unit is bound with
    exactly 8 completed commits and 0 refusals (no duplicate effect).
  - Budget clamp, through real ConfigSource: request 60000 + default ack -> 7500; request 5000 -> 5000; request 60000
    + ack 9000 -> 4500 (capture pending at budget-1, resolved at budget).
  - Live change: ack changed from default to 6000 on a running subsystem -> the next capture resolves at 3000.
- `hindsight-foreground-recall-lifetime.test.ts`: the unseeded cold capture test now asserts the bound (resolves at
  the 7500 ms admission budget as `admission_unavailable` with two `deferred` logs; every HTTP allowance stays 10000),
  then background completion and a next Run that recalls
  both Banks.
- `method-registry.test.ts`: closed-code failure logged once with method + code; free-text `TypeError` logs only
  `TypeError` (no message/params); `JSONRPCErrorException` not logged.

## Gates

- `pnpm typecheck`: pass (all packages).
- `pnpm lint`: pass (one `max-params` finding in the new file fixed).
- Tests: Core 415 files / 3323 passed, 1 skipped; Shared 60 / 540; Desktop 113 / 646. All green in the full run.
- `git diff --check`: clean (the only warning is the pre-existing CRLF note on `08-09-hindsight-memory-provider/task.json`,
  not touched by this task).
- Isolated boot (`09-25-hindsight-backup-restore/research/isolated-process-check.mjs`): passed, migrations 1..50, 0
  attempted fetches, clean SIGINT exit.

## Native smoke rerun

Run before the leader's budget clamp, so the admission budget was the 10000 ms request timeout (with the clamp and
default config it is 7500 ms; a rerun was not required for that change).
`node .trellis/tasks/09-25-hindsight-native-smoke/research/native-smoke.mjs`: result `passed`, steps 1-8 and 6b all
passed. Evidence in `research/smoke-rerun/` (moved from the harness's evidence dir, which was then restored with
`git checkout`). Isolation held: offline HF/transformers, loopback-only egress guard with no refused egress, non-default
ports, pg0 under temp and removed, no processes left.

| Step | Before (2026-09-25 run 6) | After |
| --- | --- | --- |
| 5 chat ack | 7383 ms | 7518 ms |
| 6b attempt 1 | -32603 `HINDSIGHT_APPLICATION_NATIVE_VERSION_CONFLICT` (message lost) | ack 10140 ms |
| 6b attempt 2 | ack 28298 ms | ack 1071 ms |
| 6b attempt 3 | ack 964 ms | ack 1008 ms |

Step 6b's first turn hit the budget: two warn `deferred` `HINDSIGHT_DEADLINE_EXCEEDED` logs (global and mika Banks),
the background binding finished without a `background_failed` log, and the next turns acked in about 1 s. The native
conflict race did not occur in this run (it is timing-dependent), so the R2 retry path is proven by the transport-double
tests rather than by this smoke. The two `MEMORY_PROVIDER_MAINTENANCE_FAILED` warnings for mika were already present in
the original smoke and are outside this task.
