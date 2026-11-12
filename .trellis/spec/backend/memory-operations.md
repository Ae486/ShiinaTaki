# Durable Memory Operations

## 1. Scope / Trigger

Use this contract when a manual/automatic memory operation must outlive its Home reply: Local tidy/index rebuild, Hindsight setup
validation/application, manual replica synchronization, and every later long-running memory operation (first
activation, Bank provisioning and connection revalidation, transitions, backup, upgrade). One Core-owned owner in `core/memory/operations/` admits, executes,
observes and settles operations over the existing producers (B3 setup service, B5 scheduler, D77 writes). It never
becomes a second scheduler, recovery loop, or authority writer.

## 2. Signatures

Shared: `packages/shared/src/memory-operation-schema.ts`, `memory-authority-status-schema.ts`.

```ts
MEMORY_OPERATION_METHODS = { submit: "memory.operations.submit", status: "memory.operations.status",
  list: "memory.operations.list", cancel: "memory.operations.cancel", subscribe: "memory.operations.subscribe",
  changed: "memory.operations.changed" };
MEMORY_AUTHORITY_METHODS = { status: "memory.authority.status" };
MemoryOperationKind = "tidy" | "setup.validate" | "setup.apply" | "replica.sync" | "local.onboard.prepare" | "local.onboard.activate"
  | "hindsight.activate" | "bank.provision" | "connection.revalidate" | "backup.capture" | "backup.admit" | "backup.verify"
  | "transition.return-local" | "transition.reenter-hindsight" | "transition.emergency-local"
  | "template.apply" | "template.recover" | "index.rebuild" | "candidate.prepare" | "candidate.inspect" | "candidate.resume";
MemoryOperationState = "admitted" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "outcome_unknown";
MemoryOperationReason = "core_restart" | "producer_refused" | "producer_failed" | "cancelled_before_claim" | "runtime_unavailable"
  | "producer_incomplete" | "commitment_unknown";
MemoryOperationRefusalReason = "MEMORY_OPERATION_NOT_FOUND" | "…_BUSY" | "…_RUNNING" | "…_SETTLED" | "…_UNSUPPORTED" | "…_BANK_UNKNOWN"
  | "MEMORY_OPERATION_REQUIRED";
MemoryOperationErrorCode = MemoryReplicaErrorCode | MemoryLocalErrorCode | MemoryHindsightActivationErrorCode
  | MemoryHindsightLifecycleErrorCode | MemoryBackupErrorCode | MemoryTransitionErrorCode | MemoryTemplateErrorCode | HindsightCandidateErrorCode;   // arms agree on kind
```

Producer and result arms are tied to the kind by the explicit, non-exported `PRODUCER_KIND` table in
`memory-operation-schema.ts` (never a name-prefix guess; a kind without a row fails typecheck):

| Kind | Producer / result `kind` | Family |
| --- | --- | --- |
| `setup.validate`, `setup.apply` | `setup` | `setup` |
| `replica.sync` | `replica` | `replica:<bankId>` |
| `tidy` | `tidy` | `tidy` (Global single-flight, Character-bound request) |
| `index.rebuild` | `index` | `index` |
| `local.onboard.prepare`, `local.onboard.activate` | `local` | `local-onboarding` |
| `hindsight.activate` | `hindsight` | `hindsight-activation` |
| `bank.provision` | `bank` | `hindsight-lifecycle` |
| `connection.revalidate` | `connection` | `hindsight-lifecycle` |
| `backup.capture`, `backup.admit`, `backup.verify` | `backup` | `hindsight-backup` |
| `transition.return-local`, `transition.reenter-hindsight`, `transition.emergency-local` | `transition` | `memory-transition` |
| `template.apply`, `template.recover` | `template` | `hindsight-template` |
| `candidate.prepare`, `candidate.inspect`, `candidate.resume` | `candidate` | `hindsight-candidate` |

Transition storage and explicit recovery follow [Memory Transition Durable Protocol](./memory-transitions.md).
W1 originally left the optional transition driver uncomposed. Healthy and emergency drivers now follow their
registered producer contracts; an unavailable driver still refuses. A producer return value alone cannot settle a
transition; the adapter reads durable evidence.

Core: `createMemoryOperationService({ db, live, setup, local?, hindsight?, lifecycle?, backup?, templates?, candidates?,
transition?, tidy?, searchIndex?, bootId, onChanged, logger })` ->
`{ submit(request, admission?), status, list, recent, latest(family), cancel, wait, stop }`; kind handlers implement
`{ family(request), admit(request, ctx, { origin }) -> producerRef, execute({ request, producer, ctx, running, tryClaim, checkpoint, updateProducer })
-> settlement | null, observe?(operation, ctx), observeBoot?(operation, ctx), cancel?(operation, ctx) }` and are
registered once in `memory-operation-kinds.ts`. `running()` is a notification; `tryClaim(): boolean` is the repo CAS
admitted -> running and the only claim proof. `checkpoint(producer)` / `updateProducer(producer)` persist producer checkpoints independently of `result`.
`composeMemoryRuntime(...).operations()` is the live accessor to the selected Hindsight subsystem
(`MemoryOperationsRuntime`: `epochId`, `configFingerprint`, `deploymentMode`, `scheduler` (including `started`/`start`/`stop`),
`writeFence` (`quiesce`/`release`, used only by backup capture), `banks()`, `assertConnection()`, `driftReason()`,
`pendingSummary()`), or `null` under Local authority or while unbound.
`readMemoryAuthorityStatus({ db, live, binding?, hindsightBinding?, liveConnection, lifecycle?, setup, operations, backup? })`
produces `MemoryAuthorityStatus`.

Home authority/onboarding/activation/template status facades share one `createMemoryStatusObserver` per Core lifetime.
Following `memory-authority-validation.md`, it reads current control identity and actual binding state inside the same
SQLite read transaction. It does not reconstruct historical publication evidence or retain a verification cache.
Binding state comes from the current detached publication metadata, including
revision, lifetime, flush availability and the current Hindsight template hold. Returned selections/bindings are never
retained. Only the RPC facades pass explicit observed selections. Actual admission/settlement/binding proof boundaries
use the live owner's full verification ports; COMMIT and independent DB/copy validation retain full readers.
Ordinary Hindsight connection guards check their bound current identity and consumed-data constraints as defined in
`memory-authority-validation.md`; a status DTO is not an authority credential.
Template status observation is removed from composition inputs before constructing producer dependencies.
Regression evidence must cover current status identity, known-invalid binding unavailability, replacement/stop/hold
behavior and independent full verification. Actual registered RPC bursts establish timing; isolated projection tests do
not establish Home responsiveness or optimize deeper Hindsight connection/recovery guards.

`createMemoryStatusObserver.readRuntime()` collects selection, detached bindings and the read-only Hindsight
runtime projection inside one SQLite read transaction. The connection observation checks stopped state, current
authority identity, hold, template selection and configuration before the evidence projection checks checkpoint floors.
Original `driftReason`, `assertConnection`, Bank reads and scheduler status retain every current identity/connection
guard and bound checkpoint floor. The observation port cannot dispatch work or enter an operation context.
Scheduler observation reuses ordinary Bank validation/order and status projection, rereading schedule rows and
current replica checkpoints. Pending summaries and parent-write counts retain their separate producers. Runtime
guard failures preserve existing unavailable reasons and null evidence; unreadable current identity throws.
Successful connection/template guards retain the bound selection identity even if checkpoint, scheduler or Pending evidence
is unreadable. Such evidence failure makes authority details unavailable without suggesting that a bound template
needs recovery; it reports `evidence_invalid`. A failed connection/template guard itself still clears the bound identity.
No result, selection or availability verdict survives the read. The snapshot ends before `operations.list/recent`,
because list may settle open operations and publish changes. Template producer settlement and recovery admission
retain their full verification boundary through the live owner. Known-invalid selected authority is explicitly
unavailable and cannot be hidden by a template hold or configuration-degraded Run.
Regression evidence covers result truthfulness, independent full validation, current checkpoint/order,
binding replacement/stop/hold, current identity refusal, diagnostic availability after proof failure and the settlement boundary.
Actual Home initial/reconnect requests must all finish without error UI; isolated helper timing is insufficient.

Storage: migration 048 `memory_operations` (STRICT) with the partial unique index
`memory_operations_active_family(family) WHERE terminal_at IS NULL`.

## 3. Contracts

- A Local tidy operation remains running across its admitted backlog's batches. The producer owns per-batch limits
  and Utility queue yielding; the operation owner only persists progress and final truth. Completing a batch is not
  a terminal transition. Later arrivals can remain pending when the finite admitted backlog completes.

- One operation family may have one non-terminal row: `setup` for both setup kinds, `replica:<bankId>` per Bank, and
  global `tidy` because Characters share Global memory/Blocks. A
  conflicting `submit` is refused `MEMORY_OPERATION_BUSY` with the active `operationId`; nothing is queued silently.
- Identity and producer references are Core-minted at admission (`operationId`, `authorityEpochId`, `admittedAt`,
  setup `attemptId`/`revisionBefore`). Clients never supply state; a lost reply, closed window or replacement client
  neither cancels, completes nor replays an operation. `status`/`list` return the same truth to every operator.
- Settlement is derived from what the producer persisted: a setup kind settles from the returned snapshot
  (`phase === "failed"` -> `failed` with `latestError.code`); `replica.sync` requests the manual run, awaits one
  scheduler `tick()`, then reads its exact durable manual request. Migration 051 stores request identity, captured
  lease/run/fence and terminal diagnostics independently of the latest Bank status. That request's `succeeded`,
  `failed` or `waiting` outcome settles the operation; timestamps and process-global supervisor errors never attribute work.
  An operation the producer has not settled stays open; `observe()` classifies it on the next read. Never fabricate
  success, `0 pending`, health or completion.
  A scheduler admission error can occur after its queue transaction commits (during status projection). Read the
  exact request before classifying refusal: an existing request keeps its factual state, and unreadable evidence
  stays unresolved. Likewise, receipt-read failure after execution is not a producer-failure receipt.
- `waiting` is a terminal operation outcome permitted only for `replica.sync` with an exact producer `requestId`,
  replica result, a next action and no failure reason/error. It ends this synchronization check and releases the
  operation family while the accepted Native work remains unfinished. Preserve the previous `lastSuccessAt` as
  history, never as evidence that the waiting attempt succeeded. Normal and boot observation read the same exact
  request; later runs cannot update that immutable outcome. Home shows waiting and the automatic/manual next action.
- Cancellation is stage-aware: `replica.sync` may be cancelled only before the scheduler claims it (repo
  `cancelManual(bankId, requestId)` atomically cancels the exact queued request and clears its pending pointer,
  including while a previous run holds the same Bank); a claimed request refuses
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
- `tidy` requests carry a Character. Its producer reference holds the admitted authority and content-free progress
  `{ edits, steps, reviewed, remaining: number | null }`; its result holds the complete validated tidy outcome.
  Nonterminal result remains null. Publish progress via `Database.afterCommit` so a nested mutation rollback also
  discards the notification. Restart retains known progress and classifies the operation outcome_unknown.
- `composeMemoryRuntime().installTidySubmit()` binds automatic Local requests after owner construction, before serving
  work. The kind calls raw runNow; raw execution never recurses through submission. Compatibility memory.tidy submits
  or joins only the same Character and authority and awaits `wait(operationId)` without another execution.
- `list({ kind?, characterId?, includeTerminal, limit })` filters in SQL before limiting. Home reads the latest matching
  tidy even after unrelated operation history exceeds the global recent limit. Busy replies may identify another
  Character's shared flight; they do not make that result belong to the requesting Character.
- The operation owner's lifecycle is reused for Legacy/Hindsight manual tidy without changing their producer semantics.
  Those producers may not provide intermediate progress; admitted does not prove execution has not started. Display
  known counts as confirmations, and do not imply zero work from an absent/initial report.
- `MemoryAuthorityStatus` separates authority (marker), runtime availability (closed reason), setup snapshot,
  per-Bank replica sync status, per-Bank Pending summary plus the count of unfinished D77 parent writes, and
  operations. `replica`/`pending` are `null` unless Hindsight is the authority and the runtime is available; the
  `hindsight` lifecycle section is non-null exactly under marker `hindsight`, also while the runtime is unavailable
  ([`memory-hindsight-lifecycle.md`](./memory-hindsight-lifecycle.md) §3 "Status section and actions").
  `derivedFreshness` is the literal `"unknown"` while D79-D82 are open. `memory.status` stays the Local maintenance read.
- Manual request admission, claim, cancellation and terminal outcome share the scheduler's SQLite transactions.
  Claims carry `manualRequestId`; later automatic/manual runs cannot overwrite the request's immutable outcome.
  A supervisor error before claim can settle only the exact queued request attempted for that Bank, while clearing
  that request so it cannot execute after a failed operation. If persistence fails, the request stays unresolved.
- Adding a kind = one handler file + one registry row + Shared request/result arms. Handlers call live producers; they
  do not own timers, leases or retry loops.
- Family `local-onboarding` (both `local.onboard.*` kinds): `admit` is synchronous and side-effect free; the producer
  ref is persisted before execution; claim is deferred one macrotask and taken by `tryClaim`, so a pre-claim cancel
  wins the CAS and no producer side effect happens. A kind's `observeBoot` runs read-only before the generic foreign-row
  reconciliation: outcomes provable from the durable receipt/run are reconstructed, everything else becomes
  `outcome_unknown` with `commitment_unknown` (COMMIT not provable) or `producer_incomplete` (run never published) and
  an explicit recovery action. Replica boot observation reads exact request outcomes even without a live runtime;
  legacy refs without `requestId` and unfinished requests keep the `core_restart` unknown fallback. Setup retains that fallback. The
  full producer, custody and binding contract is [`memory-local-onboarding.md`](./memory-local-onboarding.md).
- Family `hindsight-activation` (`hindsight.activate`, source modes `new` / `resume` / `recover`) follows the same
  deferred-claim and `observeBoot` rules; its producer, custody and rebind contract is
  [`memory-hindsight-activation.md`](./memory-hindsight-activation.md).
- Family `hindsight-lifecycle` (`bank.provision`, `connection.revalidate`) follows the same deferred-claim and
  read-only `observeBoot` rules; its producers, automatic triggers and status actions are
  [`memory-hindsight-lifecycle.md`](./memory-hindsight-lifecycle.md).
- Family `hindsight-backup` (`backup.capture`, `backup.admit`, `backup.verify`) is operator-only: no automatic trigger
  or agent tool submits it. It follows the same deferred-claim rule. Its `observeBoot` settles an admit whose route-b
  pair is already sealed `completed`. Every other open row becomes `outcome_unknown` / `producer_incomplete`, after a
  capture's partial dir is quarantined or an admit's claimed ZIP is returned to the inbox. Its producer, store, routes
  and status section are [`memory-hindsight-backup.md`](./memory-hindsight-backup.md).
- `setup`, `local-onboarding`, `hindsight-activation`, `hindsight-lifecycle` and `hindsight-backup` are mutually
  single-flight: every setup, Local, activation, lifecycle and backup kind calls `refuseWhileExclusiveFamilyBusy`
  (`EXCLUSIVE_MEMORY_FAMILIES` in `memory-operation-contract.ts`) at admission, so an open row in any of the five
  refuses the others `MEMORY_OPERATION_BUSY` naming that row. The per-family unique index alone cannot express this,
  because the five are different families.
- Admission carries a Core-stamped origin: `submit` defaults to `{ origin: "operator" }` (every WS submission); only the
  automatic lifecycle trigger passes `automatic`, and lifecycle producer refs persist it for the once-guard. Clients
  never supply an origin.

### Historical compatibility and remaining observation limits

- Pre-051 schedule/operation rows remain readable, without invented request IDs or retroactive attribution. Legacy
  internal manual requests keep their existing coalescing behavior; tracked operation requests refuse conflicting
  pending requests and cannot be overwritten or cancelled by an unqualified legacy call.

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
These UI rules do not change producer attribution, authority or the historical compatibility rules below.

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
| scheduler drain threw before a manual claim | only an exact persisted request failure settles; otherwise unresolved |
| exact replica request settled `waiting` | terminal waiting operation; family released; no fabricated Native completion |
| waiting on another kind, or without exact replica evidence/next action | reject the contradictory operation state |
| production `memory.migration.stage/resume/verify/exclude/activate` | `MEMORY_OPERATION_REFUSED` / `MEMORY_OPERATION_REQUIRED`; only dryRun/status/exceptions reads remain |
| Core restart with a non-terminal `local.onboard.*` row | `observeBoot` classifies from the receipt; otherwise `outcome_unknown` / `commitment_unknown` or `producer_incomplete` |
| submit any setup / Local / activation / lifecycle / backup kind while another of the five families is open | `MEMORY_OPERATION_BUSY` + that row's `activeOperationId` |
| subscription is rejected, has an invalid ACK, or reaches its request deadline | Read/setup failure; discard only the failed attempt; explicit demand can retry on the same connection; never settle or replay a mutation |
| push, explicit refresh or hide/show occurs while subscription ACK is pending | Zero status reads before accepted membership; one covering baseline afterward; hidden pages retain only a dirty obligation |
| an expired subscription attempt receives a late ACK after retry began | Native RPC identity discards the old reply; current subscription promise, status read ownership and mutation state remain unchanged |
| tidy UI loses its submit response or is recreated | Query the existing operation; never resubmit automatically |
| a known partial tidy result is returned | Outer failed retains the full partial outcome, committed counts and next action |
| Local edit progress cannot persist or the operation is already terminal | Roll back the affected edit and publish nothing from that transaction |

## 5. Good / Base / Bad Cases

- Good: Home submits `replica.sync`, closes; a second client lists the operation, sees `completed` after the tick, and
  the Bank status shows the new `lastSuccessAt`.
- Good: Native has accepted every outstanding write; this manual attempt ends `waiting`, survives reopen with its
  original request, and a later sync may be admitted without rewriting that evidence.
- Base: manual mode (`automatic=false`) fails a run; the operation ends `failed` / `explicit_retry_required`, the card
  offers Retry with the Bank's `retryKind`, and nothing retries by itself.
- Bad: marking `completed` because `pendingManualKind` became null; polling `memory.authority.status`; caching authority
  or progress in the Home counter cache; adding a per-kind offline queue.

## 6. Tests Required

- Shared: state/terminal invariants, request/result unions, `replica`/`pending` null rule, refusal reasons.
- Waiting: only replica operations may use the terminal state; exact request settlement, changed notification,
  family release, later-run independence and restart observation agree through registered operation/status methods.
- Core db: migration 048 fresh and from 047, lineage/reopen matrix, single-flight index conflict, `reconcileForeign`,
  `cancelManual` both branches.
- Core service: real temporary SQLite with a fake scheduler; submit -> tick -> terminal push without a later read;
  busy refusal; cancel before/after claim; restart reconciliation with a second `bootId`; setup kinds via the existing
  setup-service doubles; fan-out and `onClose` cleanup.
- Core setup: interrupted-phase reconciliation and failed-validate evidence clearing; existing setup tests unchanged.
- Desktop: view-model fixtures for Local / Hindsight / failed / unavailable; controller serialization, coalesced
  refetch, retired-client results ignored; card render states.
- Isolated Core boot on a non-default port through the current head migration with clean SIGINT exit whenever
  composition changes.
- Local kinds: claim race / pre-claim cancel, `retry` resolving the reserved run from the prior row, boot observation
  (unknown stays unknown, no run created), terminal rows immutable after a later binding repair
  (`memory-operation-kind-local.test.ts`).
- Activation kind: exclusive-family single-flight and the direct setup RPC refusals (`memory-operation-kind-hindsight.test.ts`).
- Lifecycle kinds: admission matrix, four-family busy in both directions, pre-claim cancel, both `observeBoot`s
  (`memory-operation-kind-lifecycle.test.ts`); Shared producer-table cases (`memory-operation-schema.test.ts`).
- Backup kinds: family registration, settlement with the mismatch in the result, restart and pre-claim cancel
  (`memory-operation-kind-backup.test.ts`); capture and admit journeys including busy with the other four families
  (`memory-operation-kind-backup-capture.test.ts`, `-admit.test.ts`).
- Desktop setup recovery: rejected and invalid ACKs and actual native RPC deadlines permit same-connection explicit
  retry; concurrent demand shares pending/accepted membership; a late expired ACK cannot replace the new attempt.
- Desktop ordering: pending ACK plus pushes, manual refresh and hide/show produces no early read and one later
  baseline; hidden/pre-hide reads cannot publish; setup failure neither loops nor settles a concurrent mutation.
- Tidy: real Local runtime plus owner/RPC/subscriptions, automatic and compatibility joins, fresh queued view,
  transaction/notification rollback, restart after a committed edit, filtered latest result, and rendered recovery
  after page recreation. Scripted models establish mechanics; real-model judgment and human acceptance are separate.

## 7. Wrong vs Correct

Wrong: infer completion from the request flag.

```ts
if (state.pendingManualKind === null) settle({ state: "completed" });
```

Correct: classify only from the exact persisted request outcome.

```ts
await scheduler.tick();
const request = scheduler.request(requestId);
if (request?.state === "succeeded") return completed(request);
```
