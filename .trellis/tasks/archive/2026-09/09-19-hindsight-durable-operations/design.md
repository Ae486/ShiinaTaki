# Stage 1 technical design — durable memory operations

Companion to [prd.md](prd.md). Verified seams: [research/stage1-seams.md](research/stage1-seams.md).
Names below are the contract; an implementer may only rename with a recorded reason in `implement.md`.

## 1. Shared contracts (`packages/shared/src`)

New file `memory-operation-schema.ts` (strict zod, no parallel interfaces):

```ts
export const MEMORY_OPERATION_METHODS = {
  submit: "memory.operations.submit", status: "memory.operations.status", list: "memory.operations.list",
  cancel: "memory.operations.cancel", subscribe: "memory.operations.subscribe", changed: "memory.operations.changed",
} as const;
export const MemoryOperationKindSchema = z.enum(["setup.validate", "setup.apply", "replica.sync"]);
export const MemoryOperationStateSchema = z.enum(["admitted", "running", "completed", "failed", "cancelled", "outcome_unknown"]);
export const MemoryOperationReasonSchema = z.enum([
  "core_restart", "producer_refused", "producer_failed", "cancelled_before_claim", "runtime_unavailable",
]);
export const MemoryOperationRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("setup.validate"), expectedRevision }),
  z.strictObject({ kind: z.literal("setup.apply"), expectedRevision, characterId, managedReceipt: HindsightManagedDeploymentReceiptSchema.optional() }),
  z.strictObject({ kind: z.literal("replica.sync"), bankId, syncKind: MemoryReplicaRunKindSchema }),
]);
export const MemoryOperationProducerRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("setup"), attemptId: Id.nullable(), revisionBefore, revisionAfter: revision.nullable() }),
  z.strictObject({ kind: z.literal("replica"), bankId, admittedAt: Timestamp }),
]);
export const MemoryOperationResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("setup"), phase: HindsightSetupPhaseSchema, revision, latestError: HindsightSetupErrorSchema.nullable() }),
  z.strictObject({ kind: z.literal("replica"), errorCode: MemoryReplicaErrorCodeSchema.nullable(),
    nextAction: z.enum(["automatic_retry_scheduled", "explicit_retry_required"]).nullable(), lastSuccessAt: Timestamp.nullable() }),
]);
export const MemoryOperationSchema = z.strictObject({
  operationId: z.uuid(), kind: MemoryOperationKindSchema, state: MemoryOperationStateSchema,
  reason: MemoryOperationReasonSchema.nullable(), authorityEpochId: Id.nullable(), request: MemoryOperationRequestSchema,
  producer: MemoryOperationProducerRefSchema.nullable(), result: MemoryOperationResultSchema.nullable(),
  errorCode: z.string().min(1).max(96).nullable(),           // closed producer codes only (HindsightErrorCode | MemoryReplicaErrorCode)
  createdAt: Timestamp, updatedAt: Timestamp, terminalAt: Timestamp.nullable(),
}).superRefine(/* terminal <=> terminalAt; running/admitted => result null; outcome_unknown => reason non-null */);
export const MemoryOperationSubmitParamsSchema = z.strictObject({ request: MemoryOperationRequestSchema });
export const MemoryOperationSubmitResultSchema = z.strictObject({ operation: MemoryOperationSchema });
export const MemoryOperationStatusParamsSchema = z.strictObject({ operationId: z.uuid() });
export const MemoryOperationListParamsSchema = z.strictObject({ includeTerminal: z.boolean().default(false), limit: z.int().min(1).max(50).default(20) });
export const MemoryOperationListResultSchema = z.strictObject({ operations: z.array(MemoryOperationSchema).max(50) });
export const MemoryOperationCancelParamsSchema = z.strictObject({ operationId: z.uuid() });
export const MemoryOperationChangedSchema = z.strictObject({ operation: MemoryOperationSchema });
```

New file `memory-authority-status-schema.ts`:

```ts
export const MEMORY_AUTHORITY_METHODS = { status: "memory.authority.status" } as const;
export const MemoryRuntimeUnavailableReasonSchema = z.enum(["authority_mismatch", "connection_unavailable", "stopped", "not_installed"]);
export const MemoryAuthorityStatusSchema = z.strictObject({
  authority: z.strictObject({ mode: z.enum(["legacy-markdown", "canonical-local", "hindsight"]), epochId: Id.nullable(), providerLineageId: z.uuid().nullable() }),
  runtime: z.strictObject({ providerId: z.enum(["legacy-markdown", "local", "hindsight"]), available: z.boolean(), unavailableReason: MemoryRuntimeUnavailableReasonSchema.nullable() }),
  setup: HindsightSetupSnapshotSchema,
  replica: z.array(MemoryReplicaSyncStatusSchema).max(256).nullable(),
  pending: z.array(z.strictObject({ bankId: Id, summary: PendingMemorySummarySchema, parentWritesPending: z.int().min(0) })).max(256).nullable(),
  operations: z.strictObject({ active: z.array(MemoryOperationSchema).max(50), recent: z.array(MemoryOperationSchema).max(20) }),
  derivedFreshness: z.literal("unknown"),
  observedAt: Timestamp,
}).superRefine(/* replica/pending null <=> authority.mode !== "hindsight" || !runtime.available */);
```

Existing `MemoryReplicaErrorCodeSchema`, `HindsightSetupSnapshotSchema`, `PendingMemorySummarySchema` are reused.
`HindsightErrorCodeSchema` (`hindsight-connection-schema.ts`) gains `HINDSIGHT_SETUP_INTERRUPTED`. Export the new
names from `packages/shared/src/index.ts` (named re-exports; stay under the 500-line ESLint limit — trim nothing else).
Update `packages/shared/src/index.md`. Operator-only surface: no Rust mirror, standalone `*-schema.test.ts`, not
`protocol-fixtures.test.ts`.

## 2. Core storage

Migration `048-memory-operations.ts` (STRICT, additive):

```sql
CREATE TABLE memory_operations (
 operation_id TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 family TEXT NOT NULL,                 -- 'setup' | 'replica:<bankId>' (single-flight key)
 state TEXT NOT NULL,
 reason TEXT,
 authority_epoch_id TEXT,
 request_json TEXT NOT NULL CHECK(json_valid(request_json)),
 producer_json TEXT CHECK(producer_json IS NULL OR json_valid(producer_json)),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 error_code TEXT,
 owner_boot_id TEXT NOT NULL,          -- process boot identity; used by restart reconciliation
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, terminal_at TEXT
) STRICT;
CREATE UNIQUE INDEX memory_operations_active_family ON memory_operations(family) WHERE terminal_at IS NULL;
CREATE INDEX memory_operations_recent ON memory_operations(terminal_at DESC);
```

`packages/core/src/db/memory-operation-repo.ts`: `insertAdmitted`, `transition(operationId, expectedState, patch)`
(CAS on `state`), `get`, `listActive`, `listRecent(limit)`, `reconcileForeign(bootId)` (all non-terminal rows whose
`owner_boot_id !== bootId` -> `outcome_unknown`/`core_restart`), `activeInFamily(family)`. The partial unique index
is the single-flight guard; an `INSERT` conflict maps to `MEMORY_OPERATION_BUSY` with the active id from
`activeInFamily`. Register in `db/index.md` and `db/migrations/index.md` + `index-list.ts` + lineage tests.

Scheduler repo addition (`hindsight-replica-scheduler-repo.ts`): `cancelManual(bankId): MemoryReplicaSyncState`
— CAS mutate that sets `pendingManualKind: null` only when `state.run === null`; throws
`HINDSIGHT_REPLICA_BUSY` otherwise. Expose it through the scheduler as `cancelManual(bankId)`.

## 3. Core operation owner (`packages/core/src/memory/operations/`)

Files (each <= 300 lines, header INPUT/OUTPUT/POS, `index.md`):

- `memory-operation-kinds.ts` — the closed registry: `Record<MemoryOperationKind, MemoryOperationKindHandler>` where
  `handler = { family(request), producerRef(request, ctx), execute(request, ctx): Promise<Settlement>, cancel?(request, ctx) }`.
  `Settlement = { state: "completed" | "failed"; result; errorCode }`. New stages add a handler file and one row here.
- `memory-operation-kind-setup.ts` — `setup.validate` / `setup.apply`: `family="setup"`; `execute` calls
  `HindsightSetupService.validate/setup`; settlement from the returned snapshot: `phase==="failed"` ->
  `failed` + `latestError.code`, else `completed`; `HindsightError` thrown before persistence -> `failed` /
  `producer_refused` with its code. No cancel handler.
- `memory-operation-kind-replica.ts` — `replica.sync`: `family="replica:"+bankId`; `execute`:
  1. `runtime = live()` (null or `!scheduler.started()` -> refuse at admission with `MEMORY_OPERATION_UNSUPPORTED`;
     `started()` is a new one-line getter on the scheduler); validate `bankId` against `runtime.banks()`;
  2. `admittedAt = now()`; `scheduler.requestManual(bankId, syncKind)`;
  3. `await scheduler.tick()` exactly once. A started scheduler drains the manual claim in that tick (a drain already
     in progress loops again because `requestManual` set `rerun`), so the Bank state is settled when it resolves;
     if the state still shows `run !== null || pendingManualKind !== null`, keep the row `running` and let
     `status()` re-read the Bank state through `refresh()` (a handler hook that re-classifies from persisted state);
  4. classify: `lastSuccessAt >= admittedAt` -> `completed`; else `errorCode = state.errorCode ?? scheduler.lastError()`,
     `failed` with `nextAction`.
  `cancel`: `scheduler.cancelManual(bankId)`; `HINDSIGHT_REPLICA_BUSY` -> refuse `MEMORY_OPERATION_RUNNING`.
- `memory-operation-service.ts` — `createMemoryOperationService({ db, repo, kinds, live, authority, bootId, now, onChanged })`:
  `submit(request)`: authority epoch from `readMemoryAuthoritySelection`; insert `admitted` (busy -> refuse); mark
  `running`; start `execute` detached under a per-service `AbortController` (`stop()` aborts and awaits settlement);
  every transition goes through `repo.transition` then `onChanged(operation)`. `status(id)`, `list(...)`,
  `cancel(id)`: `admitted`/`running` + handler.cancel -> `cancelled`/`cancelled_before_claim`; otherwise refuse.
  Constructor runs `repo.reconcileForeign(bootId)` and publishes each reconciled row. `MEMORY_OPERATION_NOT_FOUND`,
  `MEMORY_OPERATION_BUSY`, `MEMORY_OPERATION_RUNNING`, `MEMORY_OPERATION_UNSUPPORTED` (kind needs Hindsight runtime
  in Local mode, or vice versa) are the closed service errors.
- `memory-authority-status.ts` — `readMemoryAuthorityStatus({ db, live, setup, operations, now })` producing
  `MemoryAuthorityStatus`: authority from the selection marker; runtime via `live()` + `assertConnection()` in
  try/catch mapped to the closed reason; `setup = setupService.status()`; when Hindsight and available:
  `replica = scheduler.status()`, `pending = banks.map(b => ({ bankId, summary: state.pending.summary(ref), parentWritesPending: state.writes... }))`
  (use the existing `HindsightMemoryWriteRepo.pending` input; count only); else both `null`.

Runtime composition seam (`runtime-composition.ts`): add to the returned object
`operations: () => scope.hindsight ? { scheduler: scope.hindsight.scheduler, state: scope.hindsight.state, banks: () => scope.hindsight.state.runtime.banks(), assertConnection: scope.hindsight.state.runtime.assertConnection } : null`
— a live accessor (resolves the current subsystem on every call), never a captured reference. Local mode returns
`null`; the status read still works (replica/pending null).

## 4. Core server surface

- `server/memory-operation-subscriptions.ts` — clone of the timeline fan-out keyed by a single channel (no
  characterId): `subscribe(connection, sink)`, `unsubscribe`, `publish(operation)`.
- `server/methods/memory-operation-methods.ts` — registers submit/status/list/cancel/subscribe (`roles: ["operator"]`,
  strict params, result schemas parsed before return). Service errors map to `appException(HINDSIGHT_REFUSED | INTERNAL_ERROR, ..., { reason })`
  unless `ErrorCodeSchema` already has a better fit — check before adding a new code; if a code is added it is one
  `MEMORY_OPERATION_REFUSED`. `subscribe` uses `ctx.notify(MEMORY_OPERATION_METHODS.changed, { operation })` and
  `ctx.onClose(unsubscribe)`.
- `server/methods/memory-authority-status.ts` — the read method.
- `main.ts` wiring: after `composeHindsightSetup` returns the setup service and after `composeMemoryRuntime`, build
  `createMemoryOperationService` and register the methods next to `memoryStatusMethod`; call `operations.stop()` in
  shutdown before `memoryRuntime.stop()`. `bootId = randomUUID()` per process (or reuse an existing boot identity if
  one already exists in `main.ts` — check before adding).

## 5. Setup fixes (`hindsight-setup-service.ts`, `hindsight-setup-boot.ts`)

- New `reconcileInterruptedSetup(deps, now)` in a sibling module `hindsight-setup-recovery.ts`: if `read().phase`
  is busy, persist `{ phase: "failed", latestError: <HINDSIGHT_SETUP_INTERRUPTED projection>, attemptId: null }`
  and, for every Bank row not in `verified`/`pending`/`failed`, `upsert({ ...row, status: "pending", operationIds: [] , lastError: null })`
  (check `HindsightBankSetupProjectionSchema` for the exact status enum; touch only intermediate statuses).
  `composeHindsightSetup` calls it once before registering methods; log one info line with the previous phase.
- `persistFailure` in `validate` (only) additionally sets `compatibility: null`. `setup` failure keeps its current
  behavior (its evidence was already re-checked at admission).
- `hindsight-errors.ts` / `hindsight-setup-errors.ts`: add `HINDSIGHT_SETUP_INTERRUPTED` (retryable, nextAction
  retry) following the existing code table.

## 6. Home slice (`apps/desktop/src`)

- `lib/ws-client-memory-operations.ts` (new sibling, to keep `ws-client-methods.ts` under the baseline) with typed
  wrappers: `memoryAuthorityStatus()`, `memoryOperationSubmit(request)`, `memoryOperationStatus(id)`,
  `memoryOperationList()`, `memoryOperationCancel(id)`, `memoryOperationsSubscribe(handler)` (memoized per
  connection like `config.subscribe`). Wire into `WsClient` the same way existing method groups are attached; add
  the `memory.operations.changed` route in `ws-client-routes.ts`.
- `windows/home/pages/operations/memory-authority-state.ts` — pure view model: `MemoryAuthorityStatus` ->
  `{ headline, setupLine, banks: [{ label, lastSuccess, lastAttempt, nextDue, error, nextAction, retryKind }], pending, active }`.
  Unknown stays unknown ("unknown", never "0").
- `windows/home/pages/operations/use-memory-operations.ts` — controller in the MCP-controller shape: `status`
  (fetched from Core, not persisted), `busy` (serialized mutation), `submitSync(bankId, kind)`, `cancel(id)`,
  subscription install on client ready + refetch on every `changed` push and on client replacement; results from a
  retired client are ignored via the generation guard.
- `windows/home/pages/operations/memory-authority-card.tsx` — renders the view model with `PageCard`,
  `LabeledRows`, badges and action buttons; states: loading, Local, Hindsight available, Hindsight unavailable,
  failed Bank with Retry, active operation with Cancel (admitted only).
- `operations-page.tsx` mounts the card above the existing maintenance cards. Update `pages/operations/index.md`
  and `lib/index.md`.

## 7. Failure and refusal matrix

| Condition | Result |
| --- | --- |
| submit while a same-family operation is non-terminal | refuse `MEMORY_OPERATION_BUSY` + active `operationId` |
| submit `replica.sync` in Local authority or unavailable runtime | refuse `MEMORY_OPERATION_UNSUPPORTED` / settle `failed` `runtime_unavailable` (refuse when known at admission) |
| submit `setup.*` while authority is Hindsight | producer refuses (`HINDSIGHT_STATE_CONFLICT`) -> `failed` / `producer_refused` |
| unknown Bank id | refuse `INVALID_PARAMS`-class error before admission |
| cancel admitted `replica.sync` | `cancelled` / `cancelled_before_claim`; `pendingManualKind` cleared |
| cancel claimed/running | refuse `MEMORY_OPERATION_RUNNING`; nothing changes |
| cancel setup operation | refuse `MEMORY_OPERATION_RUNNING` |
| Core restart with non-terminal rows | `outcome_unknown` / `core_restart`; published to subscribers on first subscribe? No — published only on transition; reopened Home reads `list`. |
| Core restart with busy setup phase | `failed` / `HINDSIGHT_SETUP_INTERRUPTED`; Banks intermediate -> pending |
| failed validate | `compatibility: null`, phase `failed`; later `setup`/`llmHealth` refuse |
| status read while runtime throws `MEMORY_AUTHORITY_MISMATCH` | `runtime.available=false`, `authority_mismatch`, replica/pending null, read succeeds |
| scheduler drain throws (DB) during manual run | `failed` with `scheduler.lastError()` code |

## 8. Tests

- Shared: schema round-trips, invalid state/terminal combinations, `replica/pending` null rule.
- Core db: migration 048 fresh + upgrade-from-047; repo CAS, single-flight index conflict, `reconcileForeign`;
  `cancelManual` CAS both branches.
- Core service: real temporary SQLite; fake scheduler that exposes `requestManual/tick/status/lastError/cancelManual`
  with programmable outcomes; setup kind against the existing setup-service test doubles; restart reconciliation by
  constructing a second service with a new bootId on the same DB; subscription fan-out + onClose.
- Core setup: interrupted-phase reconciliation preserving fingerprint/lastSuccessfulPhase and resetting Bank rows;
  failed validate clears compatibility and later setup refuses; existing `hindsight-setup-service.test.ts` unchanged.
- Core status: Local and Hindsight fixtures, unavailable runtime path.
- Desktop: view-model fixtures for each state; controller serialization/refetch/retired-client tests in the
  `mcp-controller.test.ts` style; card render tests.
- Isolated Core boot on `TAKI_WS_PORT` non-default: migrations 1..48 applied, `ws server listening`, SIGINT exit 0,
  process tree killed afterwards.

## 9. Rollout / rollback

Additive migration only; no authority marker or setup semantics change except the two documented fixes. Rollback
is a revert of the commit set; the 048 table can stay empty. No live Hindsight, model or original-data operation is
part of verification.
