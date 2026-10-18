# B2 operator method and WebSocket test handoff

## Scope and ownership

The sole source change in this follow-up is
`packages/core/src/server/methods/hindsight-template-methods.test.ts`.
It contains 15 tests using the actual method registrations, dispatcher, local WebSocket
server/client and owned SQLite fixture. Native operations use the existing controlled
`templateNativeFixture`; runtime synchronization remains the existing fixture delegate.
These tests do not substitute for Native HTTP/transaction or real extraction acceptance.

The test file is released to root/Core with SHA-256
`6a72fcfa007e4076af8bba98b14c6e96a6e267ee9c533ee6fe2de05a5b38cf4f`.
The same identity was recorded before and after the passing Vitest and ESLint runs.
No production, fixture, Shared, index, spec, or previously released label/executor file
was changed by this follow-up. The heavy-check slot has been explicitly returned to
root, and Core was notified that this batch's dependency freeze is lifted.

## Verified coverage

| Cases | Behavior |
| --- | --- |
| 2 dispatcher roles | Awaiting/node template reads and authenticated node apply/recover refuse before Native calls or SQLite writes. Awaiting operation admission is exercised through the actual WS pre-auth gate below. |
| 6 hostile inputs | Reject top-level/nested preview snapshots, detail snapshots, status mutation flags, inline apply snapshots and caller recovery executors as `INVALID_PARAMS`, with no producer/SQLite effects. |
| 1 read-only review | Preview, each Bank detail and status expose actual Core-held before-images while only calling Native compatibility/snapshot reads; SQLite `total_changes()` remains unchanged. |
| 1 unknown plan | Status returns the closed `MEMORY_OPERATION_REFUSED` / `MEMORY_TEMPLATE_PLAN_NOT_FOUND` envelope. |
| 1 expired detail | A genuine preview expires at its TTL boundary, with a closed refusal and no additional Native/SQLite work. |
| 2 actual WS roles | Awaiting sockets receive `NOT_AUTHENTICATED` and close; authenticated nodes receive `FORBIDDEN` for all three reads and apply/recover. |
| 2 two-operator recovery paths | Fault before the first/second planned Bank application yields retained unknown/partial outcomes with zero/one receipt. Both operators observe the same original plan, reconnect preserves identity, explicit original-request resubmission past preview expiry returns the existing admission without effects, and explicit same-plan recovery completes the fixed Bank requests. Original generic outcomes remain unchanged and repeated status reads perform no work. |

Reconnection does not automatically replay a command in this harness. The test explicitly
submits the original apply request after reconnect to exercise admission idempotency, and
then separately submits `template.recover` to authorize further work.

## Executed checks and retained failure

All commands ran in `H:/TakiAgent`, serially in the explicitly allocated heavy-check slot.
The `.json` evidence records exact argv, resolved executable, timestamps, real exit code,
and test/source identities before and after each command. The corresponding `.log` files
retain combined stdout/stderr without rewriting historical failures.

| Evidence stem | Actual command and result |
| --- | --- |
| `b2-operator-methods-01-vitest` | `pnpm --filter @taki/core exec vitest run src/memory/hindsight/template-lifecycle/template-rollout.test.ts src/memory/hindsight/template-lifecycle/template-runtime-control.test.ts src/memory/hindsight/template-lifecycle/template-emergency.test.ts src/server/methods/hindsight-template-methods.test.ts --maxWorkers 2` — 4 files, 30 collected, 28 passed, 2 failed; exit 1. The three Core-owned files passed all 15 cases. |
| `b2-operator-methods-02-vitest` | `pnpm --filter @taki/core exec vitest run src/server/methods/hindsight-template-methods.test.ts --maxWorkers 2` — 1 file, 15 collected and passed; exit 0. |
| `b2-operator-methods-03-lint` | `pnpm exec eslint packages/core/src/server/methods/hindsight-template-methods.test.ts` — exit 0, no diagnostics. |

The first failure was a test-injection ordering assumption: fixture `bindings` order differs
from the actual plan order, reversing the expected zero/one receipt outcomes. The only
correction chooses the fault Bank from the genuine preview's ordered Bank summaries and
asserts that this order equals persisted `plan.banks`. Production preview directly projects
`plan.banks`, and the rollout executes that same array. All unknown/partial, original-outcome,
receipt-identity and no-extra-effects assertions remain intact. The initially failed source
identity remains recorded in the first run; its evidence was not overwritten.

The already passing Core tests were not rerun after this isolated operator-test correction.
Their run-one identities and results remain available for Core/root's combined handoff.

## Teardown and remaining gates

Every run ended and reported its real process exit. No hook/cleanup failures were reported.
The test `afterEach` closes all clients, awaits each local WS server's close, then awaits
the owned lifecycle fixture cleanup. There is no active test/lint process from this batch.
No external Native service, original data, user credentials, model calls, new dependencies,
commit, push, finish or archive were used.

Core's next unified typecheck must include this new test file; no duplicate package typecheck
was run here. Root still owns independent B2 review and final source/dependency reconciliation.
This test handoff does not accept all of B2, Home controller/DOM behavior, paired restore,
installed/manual acceptance or the whole Stage 5B task.
