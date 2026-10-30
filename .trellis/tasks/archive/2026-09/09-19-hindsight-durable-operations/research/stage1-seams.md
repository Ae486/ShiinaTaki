# Stage 1 seam inventory (verified 2026-09-19 against HEAD 118d87f)

Leader source read of every producer Stage 1 wraps. Paths are repository-relative. Line numbers were read directly;
re-check them before editing because the working tree was committed the same day.

## Producers that already exist (reuse, never duplicate)

| Producer | File | What it gives Stage 1 | Boundary |
| --- | --- | --- | --- |
| B3 setup state machine | `packages/core/src/memory/hindsight/hindsight-setup-service.ts` | `status()/validate()/setup()/disable()/llmHealth()`; persisted phases via `persist()` (revision CAS); `requireIdle()` at `:229` refuses busy phases; `persistFailure()` at `:245` keeps `compatibility`; `requireCurrentCompatibility()` at `:190` admits setup from stored evidence + fingerprint. | Validate/setup/llmHealth require `authorityMode()==='canonical-local'`. `disable()` only changes the phase. Never selects Memory Authority. |
| Setup snapshot repo | `packages/core/src/db/hindsight-connection-repo.ts` | singleton row `hindsight_connection_state`, `read()/save(snapshot, expectedRevision)`. | No boot reconcile; no "clear busy" helper today. |
| Bank setup repo | `packages/core/src/db/hindsight-bank-setup-repo.ts` | `list/get/upsert/markAllPending`. Bank statuses come from `HindsightBankSetupProjectionSchema` (Shared `hindsight-connection-schema.ts`). | Remote Banks are never deleted. |
| Setup composition | `packages/core/src/boot/hindsight-setup-boot.ts` | `composeHindsightSetup({db,config,secrets,registry,logger})` builds the service and registers B3 + B4 read methods. | Called once in `packages/core/src/main.ts:226`, BEFORE `memoryRuntime.start()` at `:498`. |
| B3 RPCs | `packages/core/src/server/methods/hindsight-setup-methods.ts` | `memory.hindsight.status/validate/setup/disable/llm-health`, operator-only, `HindsightError` -> `HINDSIGHT_REFUSED` with `{reason, retryable, nextAction}`. | Keep registered and unchanged. |
| B4 read RPCs | `packages/core/src/server/methods/hindsight-cutover-methods.ts` | `memory.hindsight.cutover.status/verify` by known `runId`. | Read-only; not Stage 1 scope. |
| Replica scheduler | `packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts` | `start/stop/tick/requestManual(bankId, kind)/verifiedReconnect/status(bankId?)/lastError`. `tick()` returns the active drain promise; `requestManual` sets `rerun=true` so a drain in progress loops again. `drain()` catches per-Bank throws into `supervisorRetries` + `this.error`. | Private `cancel` only for the active execution; no per-run public cancel. Manual mode (`automatic=false`) never auto-retries. |
| Scheduler repo | `packages/core/src/db/hindsight-replica-scheduler-repo.ts` | `requestManual` (`pendingManualKind`, full wins), `requestCatchUp`, `recover`, `claim`, `succeed`, `fail`, `list/get`. State JSON is `MemoryReplicaSyncStateSchema`; `save()` is version-CAS. | No `cancelManual`. Stage 1 adds one CAS mutation that clears `pendingManualKind` only while `run === null`. |
| Due evaluation | `packages/core/src/db/hindsight-replica-schedule-state.ts:38` | `replicaScheduleDue`: manual request wins (`trigger:"manual"`), then catch-up, retry, interval. | Pure function; do not change ordering. |
| Runtime Bank service | `packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts` | `synchronize/recover/runner/stop/settle`; per-Bank serialization; renewable foreground leases. | The scheduler's `runner` is `state.service.runner`; do not add another worker. |
| Hindsight subsystem | `packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts` | returns `{engine, maintenance, memoryFlush, tidy, writeMemory, snapshot, state, ingestion, curator, scheduler, start, stop, captureRun, recordPrimaryCommitted}`. `state.pending` (PendingMemoryRepo), `state.writes`, `state.replica`, `runtime.banks()`. | Only reachable through `runtime-composition.ts`, which currently exposes `snapshot()` and not the subsystem. |
| Runtime composition | `packages/core/src/memory/runtime-composition.ts` | `createSelectedSubsystem` keeps `hindsight`/`canonical` getters private to the closure; `composeMemoryRuntime` returns `selected, memory, fence, snapshot, captureRun, ...`. | Stage 1 adds ONE narrow live accessor (design D-S1-1) — never a second scheduler. |
| Runtime connection | `packages/core/src/memory/hindsight/hindsight-runtime-connection.ts` | `assertConnection()` throws `MEMORY_AUTHORITY_MISMATCH` / `MEMORY_OPERATION_CANCELLED`; `banks()` returns verified Banks; `resolveBanks(characterId)`. | Use `assertConnection` for the runtime-availability field of the composite status (try/catch, closed reason). |
| Pending outbox | `packages/core/src/db/pending-memory-repo.ts` | `summary(ref: BankRef): PendingMemorySummary` (pendingCount, nativeConfirmedCount, completedCount, supersededCount, failedCount, unknownCount, cancelledCount); `cancelQueued` only while queued. | Zero `pendingCount` is not zero unresolved work: report failed/unknown separately. |
| D77 parent writes | `packages/core/src/db/hindsight-memory-write-repo.ts` | `pending(input)` lists unfinished parent write jobs. | Count only; do not sum with the outbox. |
| Legacy maintenance read | `packages/core/src/server/methods/memory-status.ts` | `memory.status` returns `windowSlots/summary/auto` for the Local maintenance card. | Leave unchanged; the new composite status is a separate method. |
| On-demand async method family | `packages/core/src/server/methods/memory-migration.ts` | pattern for lazily constructed runner + `safeAsync` + closed reason mapping. | Stage 1 methods follow the same registration shape (`MethodDefinition`, `roles: ["operator"]`, strict params). |
| Push channel pattern | `packages/core/src/server/timeline-subscriptions.ts`, `server/methods/timeline-subscribe.ts` | `Map<key, Map<Connection, sink>>`, `ctx.notify`, `ctx.onClose` unsubscribe. | Clone for `memory.operations.subscribe`; the operation service is the producer. |
| Shared setup contracts | `packages/shared/src/hindsight-setup-schema.ts` | `HINDSIGHT_METHODS`, `HindsightSetupPhaseSchema`, `HindsightSetupSnapshotSchema` (`configured` requires >=2 verified Banks and compatibility). | Reuse; do not redefine. |
| Shared replica contracts | `packages/shared/src/memory-replica-schedule-schema.ts` | `MemoryReplicaRunKindSchema`, `MemoryReplicaSyncStatusSchema`, `MemoryReplicaErrorCodeSchema`, retry delays. | Reuse in the composite status. |
| Shared Pending contracts | `packages/shared/src/pending-memory-schema.ts` | `PendingMemorySummarySchema`, phases. | Reuse. |
| Shared public entry | `packages/shared/src/index.ts` | named re-exports only; ESLint max 500 lines (currently near the limit after D77). | Add only the new named exports; run lint. |
| Home Operations page | `apps/desktop/src/windows/home/pages/operations/{operations-page.tsx,use-operations.ts,operations-state.ts,use-media-clear.ts}` | `useHomeClient()` -> `client` only when `connected`; `useCachedFetch` with schema + persist for legacy counters. | The counter cache is presentation only and is NOT endpoint/profile scoped; it must not hold operation state. |
| Home serialized-mutation pattern | `apps/desktop/src/windows/home/pages/mcp/mcp-controller.ts` (`:53`, `:89`, `:132`) | conflict refetch, generation guard on client replacement, secret path separation. | Clone the controller shape for `use-memory-operations.ts`. |
| Typed client | `apps/desktop/src/lib/ws-client.ts` (289 lines), `ws-client-methods.ts` (244 lines) | where typed RPC wrappers live; `config.subscribe` memoized per connection. | Both files are near the 300-line baseline: add the new wrappers in a sibling module if they would cross it. |
| Migrations | `packages/core/src/db/migrations/index-list.ts` (last: `047-hindsight-memory-writes`) | `Migration = { version, sql }` STRICT tables, `index-list.test.ts` + `lineage-reopen-matrix.test.ts` guard lineage. | Stage 1 allocates `048`. Check lineage before allocating. |

## Boot order facts

`packages/core/src/main.ts`: `composeMemoryRuntime` at `:166` (constructs the selected subsystem, no start),
`composeHindsightSetup` at `:226`, method registrations `:425-458`, `startWsServer` at `:491`, `memoryRuntime.start()` at
`:498` (starts the replica scheduler), shutdown at `:500-514` (`memoryRuntime.stop()` before `server.close()`).
Consequences: boot reconciliation of an orphaned setup attempt can run inside `composeHindsightSetup` (before any
operator request); operation boot reconciliation runs when the operation service is constructed, before methods
are registered.

## Facts that shape the design

- `HindsightSetupSnapshotSchema` refuses `phase:"configured"` without compatibility; setting `compatibility:null` on a
  failed validation therefore requires `phase:"failed"` in the same write (which `persistFailure` already does).
- `requireCurrentCompatibility` compares `hindsightConnectionFingerprint(connection, secret.marker())` with the stored
  fingerprint. Keeping `configFingerprint` on failure preserves the existing "fingerprint changed -> markAllPending"
  behavior in `validate()`; clearing only `compatibility` is enough to refuse setup until a new success.
- `runtime-composition.ts:60` `snapshot()` throws when the selected runtime is unavailable; the composite status must
  catch and report `runtime.available=false` with a closed reason instead of failing the whole read.
- `hindsight-replica-scheduler.ts:92-103` `requestManual` throws `HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED` for unknown
  Banks; Bank identity for operator requests must come from `runtime.banks()` (verified Banks), never from free text.
- A manual run is claimed with `trigger:"manual"` and `pendingManualKind` becomes `null` at claim time
  (`hindsight-replica-scheduler-repo.ts:90`). Completion classification therefore reads the Bank state after
  `await scheduler.tick()`: `run===null && pendingManualKind===null`, then `lastSuccessAt >= admittedAt` => completed,
  otherwise `errorCode`/`nextAction` from the state (or `scheduler.lastError()` when the drain threw).
- Manual mode (`automatic=false`) keeps a failed manual request for inspection (`nextWake` returns null); a Stage 1
  manual operation in that mode ends `failed` with `nextAction:"explicit_retry_required"` and the operator retries.
- The scheduler run budget is `runTimeoutMs` (default 60 s) under a 61 s lease; a long full reconciliation may end
  the manual operation as `failed` with `automatic_retry_scheduled`. That is truthful; do not raise the budget here.
