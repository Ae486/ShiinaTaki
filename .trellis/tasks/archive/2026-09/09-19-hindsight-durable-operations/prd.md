# Durable memory operations, setup recovery and manual sync control (Hindsight closure Stage 1)

## Goal

Give the shipped application one Core-owned owner for long-running memory operations, so an operator can start,
observe, reopen and (where safe) cancel setup validation/application and manual replica synchronization without
losing the operation when the Home reply is lost or Core restarts. Close the two setup reliability gaps found by the
completeness audit (orphaned busy setup, stale compatibility after failed validation) and expose one truthful
composite memory-authority status. This is Stage 1 of the accepted closure route; it builds the durable operation
substrate that first activation (Stage 2), backup (Stage 3), transitions (Stage 4) and the full Home operations
experience (Stage 5) consume.

## Source requirements

- Parent [Hindsight PRD](../08-09-hindsight-memory-provider/prd.md) R5 (manual synchronization, exposed status), R6
  (separate write confirmation states), R9 (actionable diagnostics without silently changing authority).
- Completeness matrix entries A17, A21, A30, A32, A34 (and the status part of A31) in
  [completeness-matrix.md](../09-14-hindsight-integration-completeness-audit/research/completeness-matrix.md).
- Closure plan S1 and acceptance cases C02 (interruption/failed revalidation subcases), C06 (manual mode subcase) and
  C09 (durable operation and multiple observers) in
  [closure-plan.md](../09-14-hindsight-integration-completeness-audit/research/closure-plan.md).
- Accepted plan review [plan-review-2026-09-18.md](../09-14-hindsight-integration-completeness-audit/research/plan-review-2026-09-18.md):
  Stage 1 = "durable operations, setup recovery/current compatibility fixes and basic manual synchronization/control".
  PR03/PR04 contracts (source custody, transition-queue admission) are NOT implemented here; the operation owner must
  leave room for them (closed, extensible operation kinds; sealed operation identity).

## What I already know

- B3 setup, B5 scheduler, Pending recovery and D77 writes are production-wired producers; none has an operator-facing
  durable operation facade (`research/stage1-seams.md`).
- Home Operations consumes only `memory.status` / `memory.tidy` / `media.usage`; there is no Hindsight consumer.
- The whole B6 tree was committed on 2026-09-19 (`588e13e`); gates were green at that checkpoint (typecheck 5/5, lint
  clean, Shared 505, CLI 47, Desktop 548, Core 3055).

## Requirements

### R1. Memory Operation owner (Core)

- One durable `memory_operations` table (migration 048) and one `MemoryOperationService` that admits, executes,
  observes and settles operations. Every operation has a Core-minted `operationId`, a closed `kind`, sealed request
  parameters, the authority epoch at admission, the producer references it wrapped (setup attempt id and revision,
  replica Bank and manual kind), a state in `admitted | running | completed | failed | cancelled | outcome_unknown`,
  a closed reason code, bounded progress/result projections and timestamps.
- Stage 1 kinds: `setup.validate`, `setup.apply`, `replica.sync` (`{ bankId, kind: incremental | full }`). Kinds are a
  registry (one module per kind); later stages add kinds without touching the service.
- Single-flight per family: at most one active `setup.*` operation; at most one active `replica.sync` per Bank.
  A conflicting submit is refused with the active operation's identity, never queued silently.
- A lost reply, a closed Home window or a replacement client never cancels, completes or replays an operation.
  `status(operationId)` and `list()` return the same truth to any authenticated operator connection.
- Cancellation is stage-aware: a `replica.sync` that the scheduler has not claimed is cancelled by clearing the durable
  manual request; a running or claimed operation is refused with `MEMORY_OPERATION_RUNNING`; setup operations are not
  cancellable once remote work started. No cancellation may fabricate an outcome.
- Boot reconciliation: rows left non-terminal by a previous process become `outcome_unknown` with reason
  `core_restart`; the operator inspects the composite status. No automatic re-dispatch.
- Operation transitions are pushed to subscribed operator connections; subscriptions are connection-scoped and
  cleaned on close (server-push pattern).

### R2. Setup reliability fixes (B3)

- Orphaned busy setup: at Core boot, a setup snapshot left in a busy phase (`validating`, `validating-templates`,
  `initializing-banks`, `applying-templates`, `waiting-template-operations`) is reconciled to `failed` with a new
  sanitized error code `HINDSIGHT_SETUP_INTERRUPTED` (retryable, next action "retry"); `lastSuccessfulPhase`,
  `configFingerprint` and existing Bank evidence are preserved. Bank rows left in intermediate statuses are returned
  to `pending` so the next setup re-verifies them remotely through the existing idempotent path. Nothing claims the
  remote effect did not happen.
- Stale compatibility: a failed `validate` clears `compatibility` (keeps `configFingerprint`), so `setup` and
  `llmHealth` refuse until a new successful validation exists. `lastSuccessfulPhase` remains historical.

### R3. Composite memory-authority status (read)

- One operator read `memory.authority.status` returning, in one strict schema: active authority (mode, epoch,
  lineage), selected runtime availability (boolean + closed reason), the B3 setup snapshot, per-Bank replica sync
  status (Hindsight authority only), per-Bank Pending summary plus the count of unfinished D77 parent writes
  (Hindsight only), active and recent operations, and `derivedFreshness: "unknown"`.
- Unknown remains unknown: no lag, age, health or "0 pending" is manufactured where the producer has no evidence.
  Configured is never displayed as active or healthy.
- The existing `memory.status` read is unchanged.

### R4. Minimal Home slice

- The Operations page gains one "Memory authority" card fed by `memory.authority.status` and the operations
  subscription: authority/runtime line, setup phase + last error, per-Bank last success / last attempt / next due /
  error / next action, Pending counts (pending, failed, unknown shown separately), active operations with state.
- Actions: "Sync now" (incremental), "Full reconcile", "Retry" (when the Bank reports `explicit_retry_required`,
  submits `replica.sync` with the Bank's `retryKind`), "Cancel" for an admitted-only operation. No wizard, no
  validate/setup buttons (Stage 2/5).
- Client behavior follows the MCP controller: serialized mutations, refetch of Core truth on reconnect/remount and on
  every operation transition, generation guard on client replacement, no React-cached authority/progress store.

## Acceptance Criteria

- [ ] `memory.operations.submit` for `replica.sync` returns an admitted operation immediately; the same operation is
      readable by `status`/`list` from a second authenticated connection while it runs and after it settles.
- [ ] Submitting a second `replica.sync` for the same Bank while one is active is refused with the active id.
- [ ] After `await scheduler.tick()`, a manual incremental run that succeeded settles `completed`; a failing run
      settles `failed` with the Bank's `errorCode` and `nextAction` (`automatic_retry_scheduled` or
      `explicit_retry_required`); manual mode (`automatic=false`) yields `explicit_retry_required`.
- [ ] `cancel` on an admitted `replica.sync` clears `pendingManualKind` and settles `cancelled`; `cancel` on a claimed
      run is refused with `MEMORY_OPERATION_RUNNING` and the run continues.
- [ ] `setup.validate` / `setup.apply` operations wrap the existing service; a lost reply leaves a `running` row that
      later settles with the resulting setup snapshot revision; the legacy `memory.hindsight.*` RPCs still pass their
      existing tests unchanged.
- [ ] Reopening the Core with a `running` operation row yields `outcome_unknown` / `core_restart`; with a busy setup
      phase yields `failed` / `HINDSIGHT_SETUP_INTERRUPTED` with preserved `lastSuccessfulPhase`/fingerprint and
      intermediate Bank rows returned to `pending`.
- [ ] After a failed `validate`, `setup` and `llmHealth` are refused until a successful `validate`; a successful
      validate with a changed fingerprint still marks all Banks pending.
- [ ] `memory.authority.status` validates against its strict schema in Local mode (replica/pending null) and in
      Hindsight mode (per-Bank sync status and Pending summary present); `derivedFreshness` is the literal `unknown`;
      an unavailable runtime yields `available:false` with a closed reason and the read still succeeds.
- [ ] `memory.operations.subscribe` fans transitions to every subscribed operator connection and drops membership on
      socket close; a replacement connection must subscribe again.
- [ ] Home: the card renders loading, Local, Hindsight-healthy, Hindsight-failed (with retry) and unavailable states
      from schema-validated fixtures; the Sync/Full/Retry/Cancel actions are serialized and refetch status on
      completion; a retired client's late result is ignored.
- [ ] Migration 048 applies on a fresh DB and on a DB at 047; lineage tests and the reopen matrix pass.
- [ ] `pnpm typecheck`, `pnpm lint`, Shared/Core/Desktop test suites and an isolated Core boot (non-default port,
      migrations through 048, clean SIGINT) pass.

## Definition of Done

- Tests colocated for every new module; existing B3/B5 tests unchanged and green.
- Executable contract recorded in `.trellis/spec/backend/memory-operations.md` (new) and the Home card noted in
  `.trellis/spec/frontend/home-window.md`; folder `index.md` files updated for every touched directory.
- Task notes record which matrix entries moved (A17, A21, A30, A32, A34; A31 status only) and what stays open.
- Commit and archive per the owner's 2026-09-19 authorization once implement/check are green.

## Decision (ADR-lite)

- **D-S1-1 One operation owner over existing producers.** Context: A34 needs discovery/resume/observe; B5/B3 already
  own durable execution state. Decision: a thin durable wrapper (`memory_operations` + service + kind registry) that
  calls the live scheduler/setup service and classifies outcomes from their persisted state; runtime composition
  exposes ONE live accessor for it. Consequence: no second scheduler or recovery loop; outcome classification is
  derived, so the wrapper can only report what the producer persisted.
- **D-S1-2 Setup kinds wrap, legacy RPCs stay.** Context: B3 RPCs have tests and no Home consumer. Decision: add
  operation kinds for validate/apply; keep `memory.hindsight.*` registered and unchanged; the service's own
  `requireIdle` serializes both entry points. Consequence: zero regression risk for B3; Home uses the operation path.
- **D-S1-3 Restart yields unknown, not invented failure.** Decision: non-terminal operations become `outcome_unknown`
  (`core_restart`); busy setup phases become `failed` (`HINDSIGHT_SETUP_INTERRUPTED`) because a busy phase can never
  complete once its process died. Consequence: the operator re-runs; Bank/template application is idempotent.
- **D-S1-4 Failed validation clears evidence, keeps identity.** Decision: null `compatibility`, keep
  `configFingerprint`. Consequence: setup refuses until fresh evidence; fingerprint-change detection is preserved.
- **D-S1-5 Status is a read; operations are a channel.** Decision: `memory.authority.status` (read) plus
  `memory.operations.subscribe` (push on transitions). Consequence: Home refetches the read on each push; no dead
  subscription for a producer-less snapshot.
- **D-S1-6 Minimal Home slice.** Decision: one card + four actions on the existing Operations page. Consequence:
  wizard, transitions, backup and upgrade UI remain Stage 2-5 work with their own producers.

## Out of Scope (with owning stage)

- First activation orchestration / wizard, active-Character Bank provisioning, active-provider revalidation/rebind
  (Stage 2; A12, A27, A28, A31 action part).
- Backup/restore artifacts, administration custody path (Stage 3; PR02, A39).
- Healthy return, re-entry, transition queue, emergency takeover, runtime replacement, PR03/PR04 (Stage 4; A35-A38).
- Managed provisioning, model apply/read-back, template overlay lifecycle, upgrade, full Home operations (Stage 5).
- `verifiedReconnect` production trigger (A16): stays unwired; the scheduler's due/retry/catch-up behavior and the
  Stage 1 manual path are the only triggers. Revisit with Stage 2 runtime work or Stage 4.
- Cancelling a claimed replica run (would need a public per-run cancel in the B5 executor).
- D79-D83 remain deferred; the status shows `derivedFreshness: unknown` instead of implying freshness.
- Any authority change, original user data operation, live Hindsight call in tests, push, or remote-Core work.

## Technical Notes

- Seam inventory with verified line references: [`research/stage1-seams.md`](research/stage1-seams.md).
- Technical design: [`design.md`](design.md). Execution plan: [`implement.md`](implement.md).
- Domain terms per `CONTEXT.md`: Memory Authority, Authority Epoch, Memory Replica, Replica Checkpoint, Pending
  Memory, Host-Bound Operation (the memory operation is Core-only; it reuses the same state vocabulary where it fits).
