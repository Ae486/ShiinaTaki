# Durable Memory Operations

## 1. Scope / Trigger

Use this contract when an operator-initiated memory operation must outlive its Home reply: Hindsight setup
validation/application, manual replica synchronization, and every later long-running memory operation (first
activation, transitions, backup, upgrade). One Core-owned owner in `core/memory/operations/` admits, executes,
observes and settles operations over the existing producers (B3 setup service, B5 scheduler, D77 writes). It never
becomes a second scheduler, recovery loop, or authority writer.

## 2. Signatures

Shared: `packages/shared/src/memory-operation-schema.ts`, `memory-authority-status-schema.ts`.

```ts
MEMORY_OPERATION_METHODS = { submit: "memory.operations.submit", status: "memory.operations.status",
  list: "memory.operations.list", cancel: "memory.operations.cancel", subscribe: "memory.operations.subscribe",
  changed: "memory.operations.changed" };
MEMORY_AUTHORITY_METHODS = { status: "memory.authority.status" };
MemoryOperationKind = "setup.validate" | "setup.apply" | "replica.sync";
MemoryOperationState = "admitted" | "running" | "completed" | "failed" | "cancelled" | "outcome_unknown";
MemoryOperationReason = "core_restart" | "producer_refused" | "producer_failed" | "cancelled_before_claim" | "runtime_unavailable";
MemoryOperationRefusalReason = "MEMORY_OPERATION_NOT_FOUND" | "…_BUSY" | "…_RUNNING" | "…_SETTLED" | "…_UNSUPPORTED" | "…_BANK_UNKNOWN";
```

Core: `createMemoryOperationService({ db, live, setup, bootId, onChanged, logger })` ->
`{ submit, status, list, recent, cancel, stop }`; kind handlers implement
`{ family(request), admit(request, ctx) -> producerRef, execute({ request, producer, ctx, running }) -> settlement | null,
observe?(operation, ctx), cancel?(operation, ctx) }` and are registered once in `memory-operation-kinds.ts`.
`composeMemoryRuntime(...).operations()` is the live accessor to the selected Hindsight subsystem
(`scheduler`, `state`, `banks()`, `assertConnection()`), or `null` under Local authority.
`readMemoryAuthorityStatus({ db, live, setup, operations })` produces `MemoryAuthorityStatus`.
Storage: migration 048 `memory_operations` (STRICT) with the partial unique index
`memory_operations_active_family(family) WHERE terminal_at IS NULL`.

## 3. Contracts

- One operation family may have one non-terminal row: `setup` for both setup kinds, `replica:<bankId>` per Bank. A
  conflicting `submit` is refused `MEMORY_OPERATION_BUSY` with the active `operationId`; nothing is queued silently.
- Identity and producer references are Core-minted at admission (`operationId`, `authorityEpochId`, `admittedAt`,
  setup `attemptId`/`revisionBefore`). Clients never supply state; a lost reply, closed window or replacement client
  neither cancels, completes nor replays an operation. `status`/`list` return the same truth to every operator.
- Settlement is derived from what the producer persisted: a setup kind settles from the returned snapshot
  (`phase === "failed"` -> `failed` with `latestError.code`); `replica.sync` requests the manual run, awaits one
  scheduler `tick()`, then classifies the Bank state (`lastSuccessAt >= admittedAt` -> `completed`; a claim at or
  after admission with `errorCode` -> `failed` + `nextAction`; unclaimed with a supervisor error -> `failed`).
  An operation the producer has not settled stays open; `observe()` classifies it on the next read. Never fabricate
  success, `0 pending`, health or completion.
- Cancellation is stage-aware: `replica.sync` may be cancelled only before the scheduler claims it (repo
  `cancelManual` is a CAS that clears `pendingManualKind` while `run === null`); a claimed run refuses
  `MEMORY_OPERATION_RUNNING`; setup kinds have no cancel; a terminal row refuses `MEMORY_OPERATION_SETTLED`.
- Restart reconciliation: rows owned by another `bootId` become `outcome_unknown` / `core_restart` when the service is
  constructed. A busy B3 setup phase found at boot becomes `failed` / `HINDSIGHT_SETUP_INTERRUPTED` (retryable), with
  `lastSuccessfulPhase` and `configFingerprint` preserved and intermediate Bank rows returned to `pending`; the next
  setup re-verifies them through the idempotent remote path. Nothing claims the remote effect did not happen.
- A failed `validate` clears `compatibility` and keeps `configFingerprint`, so `setup` and `llmHealth` refuse until a
  new successful validation exists and fingerprint-change detection still marks all Banks pending.
- Every persisted transition is a repo CAS followed by exactly one `onChanged` publication; the server fan-out is
  connection-scoped and removed on close. The composite status is a read (no producer of its own); Home refetches it on
  every `memory.operations.changed` push, on reconnect and on remount — never by polling.
- `MemoryAuthorityStatus` separates authority (marker), runtime availability (closed reason), setup snapshot,
  per-Bank replica sync status, per-Bank Pending summary plus the count of unfinished D77 parent writes, and
  operations. `replica`/`pending` are `null` unless Hindsight is the authority and the runtime is available.
  `derivedFreshness` is the literal `"unknown"` while D79-D82 are open. `memory.status` stays the Local maintenance read.
- A still-queued manual request (`pendingManualKind !== null`) proves the Bank state is not this operation's outcome
  (the claim consumes the request and this owner is its only producer); only then may `lastAttemptAt >= admittedAt`
  attribute a run to the operation. A same-millisecond overlap with a previous run must never settle `completed`.
- Adding a kind = one handler file + one registry row + Shared request/result arms. Handlers call live producers; they
  do not own timers, leases or retry loops.

### T4 retained-page integration

The Home card installs its handler, awaits subscription acknowledgement, then reads Core status.
Pushes, explicit refresh and hide/show during pending setup cannot bypass that acknowledgement; they coalesce
into the subsequent baseline. Failed, invalid or timed-out setup clears only that subscription attempt and
reports a read failure, without settling an in-flight mutation. Explicit demand may retry on the same socket;
accepted membership remains shared and no polling or automatic subscription retry loop is introduced.
Actual page visibility gates disposable status reads; hidden pushes retain one dirty obligation,
and pre-hide reads cannot publish after visibility retirement. Returning reconciles Core truth.
Hiding keeps the operation controller, mutation lock and one terminal outcome; it never replays a mutation.
The card retains readable prior data during refresh or connection loss. Authority epochs, opaque Bank IDs
and operation IDs remain internal request/correlation fields and never become labels, feedback or tooltips.
These UI rules do not change producer attribution, authority or the D84 precision limitations below.

### Known precision limits (recorded 2026-09-19, see deferred-decisions D84)

- `scheduler.lastError()` is process-global: a queued request for Bank B can be settled `failed` with a supervisor code
  produced by Bank A's drain in the same tick — truthful that the scheduler failed, imprecise in attribution.
- Cancelling an unclaimed request while a previous run still holds the Bank is refused `MEMORY_OPERATION_RUNNING`
  (the repo refuses while `run !== null`); the operation itself was not claimed.
- An operation left unclaimed with no supervisor error (for example the scheduler stopped after admission) stays open
  until the next `status`/`list` read re-classifies it, or becomes `outcome_unknown` at the next boot.
- Result-schema parse failures in the method guards rethrow the ZodError as `INTERNAL_ERROR` text, matching the
  existing `hindsight-setup-methods.ts` convention.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| submit while the family has a non-terminal row | `MEMORY_OPERATION_REFUSED` / `MEMORY_OPERATION_BUSY` + `activeOperationId` |
| submit `replica.sync` under Local authority, unavailable runtime or unstarted scheduler | `MEMORY_OPERATION_UNSUPPORTED` at admission |
| unknown Bank id | `MEMORY_OPERATION_BANK_UNKNOWN` before admission |
| setup kind refused by B3 (`HINDSIGHT_STATE_CONFLICT` etc.) | `failed` / `producer_refused` with the Hindsight code |
| cancel before claim | `cancelled` / `cancelled_before_claim`; `pendingManualKind` cleared |
| cancel after claim, or a setup kind | `MEMORY_OPERATION_RUNNING`; producer untouched |
| cancel a terminal row | `MEMORY_OPERATION_SETTLED` |
| Core restart with non-terminal rows | `outcome_unknown` / `core_restart`; no automatic re-dispatch |
| Core restart with a busy setup phase | `failed` / `HINDSIGHT_SETUP_INTERRUPTED`; evidence preserved; Banks -> `pending` |
| status read while the runtime throws | `runtime.available=false` with a closed reason; the read still succeeds |
| scheduler drain threw during a manual run | `failed` with `scheduler.lastError()` |
| subscription is rejected, has an invalid ACK, or reaches its request deadline | Read/setup failure; discard only the failed attempt; explicit demand can retry on the same connection; never settle or replay a mutation |
| push, explicit refresh or hide/show occurs while subscription ACK is pending | Zero status reads before accepted membership; one covering baseline afterward; hidden pages retain only a dirty obligation |
| an expired subscription attempt receives a late ACK after retry began | Native RPC identity discards the old reply; current subscription promise, status read ownership and mutation state remain unchanged |

## 5. Good / Base / Bad Cases

- Good: Home submits `replica.sync`, closes; a second client lists the operation, sees `completed` after the tick, and
  the Bank status shows the new `lastSuccessAt`.
- Base: manual mode (`automatic=false`) fails a run; the operation ends `failed` / `explicit_retry_required`, the card
  offers Retry with the Bank's `retryKind`, and nothing retries by itself.
- Bad: marking `completed` because `pendingManualKind` became null; polling `memory.authority.status`; caching authority
  or progress in the Home counter cache; adding a per-kind offline queue.

## 6. Tests Required

- Shared: state/terminal invariants, request/result unions, `replica`/`pending` null rule, refusal reasons.
- Core db: migration 048 fresh and from 047, lineage/reopen matrix, single-flight index conflict, `reconcileForeign`,
  `cancelManual` both branches.
- Core service: real temporary SQLite with a fake scheduler; submit -> tick -> terminal push without a later read;
  busy refusal; cancel before/after claim; restart reconciliation with a second `bootId`; setup kinds via the existing
  setup-service doubles; fan-out and `onClose` cleanup.
- Core setup: interrupted-phase reconciliation and failed-validate evidence clearing; existing setup tests unchanged.
- Desktop: view-model fixtures for Local / Hindsight / failed / unavailable; controller serialization, coalesced
  refetch, retired-client results ignored; card render states.
- Desktop setup recovery: rejected and invalid ACKs and actual native RPC deadlines permit same-connection explicit
  retry; concurrent demand shares pending/accepted membership; a late expired ACK cannot replace the new attempt.
- Desktop ordering: pending ACK plus pushes, manual refresh and hide/show produces no early read and one later
  baseline; hidden/pre-hide reads cannot publish; setup failure neither loops nor settles a concurrent mutation.
- Isolated Core boot on a non-default port through migration 048 with clean SIGINT exit whenever composition changes.

## 7. Wrong vs Correct

Wrong: infer completion from the request flag.

```ts
if (state.pendingManualKind === null) settle({ state: "completed" });
```

Correct: classify only from the persisted Bank outcome relative to this operation's admission.

```ts
await scheduler.tick();
const state = scheduler.status(bankId)[0];
if (state.lastSuccessAt && Date.parse(state.lastSuccessAt) >= Date.parse(admittedAt)) return completed(state);
```
