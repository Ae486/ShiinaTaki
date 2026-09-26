# Hindsight Bank and Connection Lifecycle: Degraded Runs, Provisioning and Revalidation

## 1. Scope / Trigger

Use this contract when a change touches what happens under a committed Hindsight authority when a Character has no
ready Bank, the connection settings or API key change, the provider is unreachable, or the runtime stays unbound for a
configuration reason: the memory-unavailable Run, primary witnesses kept for later ingestion, the durable kinds
`bank.provision` and `connection.revalidate`, the automatic lifecycle trigger, `verifiedReconnect` callers and the
`hindsight` section of `memory.authority.status`. Files: `core/memory/hindsight/hindsight-unavailable-run.ts`,
`hindsight-memory-runtime.ts`, `hindsight-memory-subsystem.ts`, `hindsight-runtime-connection.ts`,
`core/memory/hindsight-unbound-run.ts`, `core/memory/hindsight-lifecycle/`, `operations/memory-operation-kind-bank.ts`,
`-kind-connection.ts`, `-lifecycle-settlement.ts`, `operations/memory-hindsight-lifecycle-status.ts`,
`hindsight-runtime-binding.ts` (`replace`), `boot/hindsight-lifecycle-boot.ts`.
Out of scope: template revision, model or `deploymentMode` change (Stage 5); a different provider lineage or disabling
Hindsight as a switch (Stage 4); native Bank delete/reset and backup (Stage 3); queueing behind a busy family (Stage 4).
First activation: [`memory-hindsight-activation.md`](./memory-hindsight-activation.md); operation owner:
[`memory-operations.md`](./memory-operations.md); scheduler: [`memory-replica-sync.md`](./memory-replica-sync.md).

## 2. Signatures

Shared: `packages/shared/src/memory-hindsight-lifecycle-schema.ts`, `memory-authority-status-schema.ts`.

```ts
{ kind: "bank.provision", characterId }              // characterId max 160; Core derives the native Bank id
{ kind: "connection.revalidate", expectedEpochId }
MemoryBankProducerRef = { kind: "bank", origin: "operator" | "automatic", characterId, nativeBankId, templateRevision,
  admittedEpochId, configFingerprint, phase: "reserved" | "probing" | "applying" | "syncing" | "completed" };
MemoryConnectionProducerRef = { kind: "connection", origin, epochId, fingerprintBefore: Digest | null,
  fingerprintAfter: Digest | null, phase: "reserved" | "validating" | "verifying-banks" | "recording" | "rebinding" | "completed" };
MemoryBankResult = { kind: "bank", characterId, nativeBankId, readiness: "ready" | "syncing" | "failed" };
MemoryConnectionResult = { kind: "connection", outcome: "unchanged" | "rebound" | "binding_unavailable", fingerprint };
MemoryHindsightStatusSection = { connection: { config: "ready" | "disabled" | "unconfigured",
  drift: "none" | "config_changed" | "unreviewed", admittedAt }, banks: [{ scope, characterId, nativeBankId,
  readiness: "ready" | "syncing" | "provisioning" | "failed" | "not_provisioned", errorCode }],
  actions: { revalidate: boolean, provision: CharacterId[] } };
MemoryRuntimeUnavailableReason += "connection_disabled" | "config_changed";
HINDSIGHT_ERROR_CODES += "HINDSIGHT_BANK_OCCUPIED" | "HINDSIGHT_CONNECTION_DISABLED";
MemoryHindsightLifecycleErrorCode = MemoryReplicaErrorCode + MEMORY_AUTHORITY_MISMATCH | MEMORY_RUNTIME_UNAVAILABLE
  | HINDSIGHT_LIFECYCLE_INTERRUPTED | HINDSIGHT_LIFECYCLE_INTERNAL_ERROR;
```

Core: `createHindsightLifecycleService(deps)` -> `{ authority, bankFacts, live, runtime, revalidateBlocker, revalidated,
provision, revalidate, stopRequested, stop }`; `createHindsightLifecycleTrigger({ db, logger })` -> `{ onUnavailable,
bind }`; `HindsightRuntimeBinding.replace(epochId)`; composition `replaceHindsightBinding(epochId)`;
`createHindsightUnavailableRun({ epoch, characterId, persona })`; `hindsightUnboundReason(snapshot, live)`;
`hindsightRevalidateBlocker(db, { live, runtime })`. `MemoryOperationsRuntime` carries `configFingerprint`,
`deploymentMode` and `driftReason()`. `submit(request, { origin })` defaults to `operator`; only the trigger passes
`automatic`. Migration 050 adds nullable `hindsight_connection_state.reviewed_deployment_mode` (CHECK against the Shared
modes); `HindsightConnectionRepo.save(snapshot, expectedRevision, reviewedDeploymentMode?)` and `reviewed()`.
Core-internal: never projected into the Shared setup snapshot.

## 3. Contracts

### Degrade vs refuse (R1)

A memory-unavailable Run has no memory tools, no automatic recall, the base prompt without its memory section
(`MEMORY_UNAVAILABLE_SYSTEM_PROMPT`), a persona-only assembly and a snapshot with every capability `false` and
`vectorRetrieval: "unavailable"`; provider `hindsight`, lineage and epoch ids stay those it was admitted under. It makes
no network call and is never a Local or Legacy fallback. Every such Run reaches `onUnavailable({ characterId, reason })`.

| State | Where decided | Result |
| --- | --- | --- |
| Character has no verified B3 row (`routedBanks()` undefined) | `hindsight-memory-runtime.ts` `captureRun` | degrade `bank_not_ready` |
| admission sync failed (not integrity/authority/request-id/cancellation) or still running at the admission budget `min(requestTimeoutMs, floor(chatAckMs / 2))`, and no capability evidence | `synchronizeHindsightCapture` (`hindsight-capture-sync.ts`) | degrade `admission_unavailable` |
| same, with capability evidence | same | partial Run on the readable replica with the in-Run recall fallback; the Bank catches up in the background |
| every Bank synced and no evidence | same | refuse `HINDSIGHT_APPLICATION_ADMISSION_UNAVAILABLE` |
| `MEMORY_INTEGRITY_ERROR` / `MEMORY_AUTHORITY_MISMATCH` / `MEMORY_REQUEST_ID_CONFLICT` or cancellation during the sync | same | refuse (rethrow; integrity refusals logged at error) |
| bound runtime, live config changed / not ready | subsystem `captureRun` via `driftReason()` | degrade `config_changed` / `connection_disabled` |
| same, observed after an incomplete admission sync (the sync guards fail as `MEMORY_AUTHORITY_MISMATCH`) | `synchronizeHindsightCapture` via `driftReason()` | degrade `config_changed` / `connection_disabled` (no refusal log) |
| bound runtime, epoch or lineage changed; missing Global Bank | `driftReason()` / `routedBanks()` | refuse (`MEMORY_AUTHORITY_MISMATCH` / `HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH`) |
| unbound, live config not ready, binding code in `DISABLED_CODES` | `hindsightUnboundReason` | degrade `connection_disabled` |
| unbound, live config ready, code `HINDSIGHT_TEMPLATE_CONFLICT` or `HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE` | same | degrade `config_changed` |
| unbound for any other code (integrity, unknown construct/start failure), stopped, other epoch, unreadable live config | same | refuse `MEMORY_RUNTIME_UNAVAILABLE` |

- `DISABLED_CODES` (`hindsight-unbound-run.ts`) is only the connection guard's own codes:
  `HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE`, `MEMORY_AUTHORITY_MISMATCH` (from `start()` after a disable) and
  `HINDSIGHT_TEMPLATE_CONFLICT`. Disabling the connection never turns an integrity failure into a degraded chat.
- The unbound capture re-reads the marker (`readMemoryAuthoritySelection`, receipt re-verified) before admitting, so a
  real marker or lineage break still refuses.
- Construction refuses `HINDSIGHT_TEMPLATE_CONFLICT` when any verified row's template revision differs from
  `desiredTemplateRevision`; boot records binding `unavailable` and Core keeps serving (degraded chat, not an abort).
- `authority_mismatch` is reported only for a real epoch/lineage mismatch; the enable flag is never an authority switch.

### Witnesses and exactly-once ingestion (R2)

- A primary commit under drift or while unbound is witnessed through the marker-routed ledger
  (`witnessHindsightPrimaryCommit`); it is never logged and dropped.
- Background ingestion/curation returns before any Utility model call for a Character without a routed Bank
  (`characterRouted()`), leaving its witnesses in the source ledger. Its flush answers `retryable_failure` /
  `MEMORY_FLUSH_INCOMPLETE`, never `not_required`, so uncovered Timeline rows are kept.
- Once the Bank is routed or the binding rebinds, ordinary ingestion consumes each witness exactly once (the S2b
  same-epoch `previousCommit` check).

### `bank.provision` (R5)

- Admission (synchronous, side-effect free): lifecycle service present, `refuseWhileExclusiveFamilyBusy`, a published
  runtime whose `driftReason()` is `none` (a throw counts as drift), a Character id within the Bank identity bounds, a
  verified Global row, and the Bank not already verified and replica-bound. Every miss is `MEMORY_OPERATION_UNSUPPORTED`
  with no row. The ref freezes the Global row's template revision, the runtime's epoch and fingerprint and the native id.
- Execution guards are local and make zero native calls: live config not ready -> `HINDSIGHT_CONNECTION_DISABLED`;
  Global/ref/verified-row revision differs from the live desired revision -> `HINDSIGHT_TEMPLATE_CONFLICT`; fingerprint or
  native id moved, or drift -> `HINDSIGHT_STATE_CONFLICT`; runtime gone, other epoch or scheduler not started ->
  `MEMORY_RUNTIME_UNAVAILABLE`.
- Occupancy (phase `probing`) only when the scope has no B3 row of ours: native
  `GET /v1/default/banks/{id}/stats`; any of `total_nodes`, `total_documents`, `total_observations`,
  `pending_operations` > 0 -> `HINDSIGHT_BANK_OCCUPIED`, no PUT, no row. A row of ours (any status) skips the probe.
- Phase `applying`: dry-run unless the row is verified (a rejection writes a `failed` row and throws), then the
  unchanged `applyHindsightBank`. It writes only this scope's row; other Banks keep serving.
- Phase `syncing`: `requestManual(bankId, "full")` + one `tick()`. `ready` only when `lastSuccessAt >= requestedAt` and
  `hindsightReplicaBound` for the epoch; otherwise `syncing` with the Bank's `errorCode`, `lastError()` or
  `HINDSIGHT_REPLICA_SYNC_FAILED`. A re-submit is idempotent.

### `connection.revalidate` (R6)

- Admission: lifecycle service present, not busy, marker `hindsight` with `epochId === expectedEpochId` (else
  `MEMORY_OPERATION_UNSUPPORTED`). A disabled connection is admitted with `fingerprintAfter: null` so the row names
  `HINDSIGHT_CONNECTION_DISABLED`; `fingerprintBefore` is the published runtime's fingerprint or null.
- Local refusals before any native call: marker/epoch moved -> `MEMORY_AUTHORITY_MISMATCH`; not ready ->
  `HINDSIGHT_CONNECTION_DISABLED`; live fingerprint differs from `fingerprintAfter` -> `HINDSIGHT_STATE_CONFLICT`; the
  revalidate blocker below -> its code.
- `validating`: `admitHindsightApplication` with the epoch's lineage (different lineage ->
  `HINDSIGHT_REPLICA_LINEAGE_MISMATCH`, old binding kept). `verifying-banks`: export and verify the template of every
  verified Bank, writing no row. `recording`: save the new reviewed fingerprint, compatibility and the live
  `deploymentMode` in one snapshot UPDATE (never `markAllPending`), then the admission evidence for (epoch, fingerprint).
- Rebind: runtime available on the same epoch and already on this fingerprint -> `verifiedReconnect()`, outcome
  `unchanged`. Otherwise phase `rebinding` and `replaceHindsightBinding(epochId)`: `replace` builds the new draft while the
  old one stays published, swaps publication, awaits `old.stop()` (a failing stop is logged, never undoes the swap), then
  starts the new one. A construct/start failure withdraws both, leaves binding `unavailable` with its code, is logged,
  and returns `binding_unavailable`; the activation card then offers `recoverBinding`.
- Revalidate blocker (`hindsightRevalidateBlocker`, shared by producer, trigger and status): Global row not verified ->
  `HINDSIGHT_STATE_CONFLICT`; its revision differs from the desired one -> `HINDSIGHT_TEMPLATE_CONFLICT`; the persisted
  reviewed mode differs from the live mode -> `HINDSIGHT_STATE_CONFLICT`. With a NULL (pre-050) mode, only a runtime built
  on the reviewed fingerprint supplies the reference mode; else only an unchanged reviewed fingerprint passes (fail closed).
- Reviewed-mode writers: setup validate (`compatible`) and apply (`configured`) pass the connection's mode; revalidate
  `record()` passes the live mode. A `save` without a mode keeps the stored one only while the fingerprint is unchanged,
  else NULL — a mode never outlives the fingerprint it vouches for.

### Settlement, cancel and boot (R9)

| Situation | Settlement |
| --- | --- |
| provision `ready` / revalidate `unchanged` or `rebound` | `completed`, phase `completed` |
| provision first sync not bound | `failed` + replica code, result readiness `syncing` |
| revalidate `binding_unavailable` | `failed` / `runtime_unavailable` + code, result outcome `binding_unavailable` |
| refusal codes (`TEMPLATE_CONFLICT`, `BANK_OCCUPIED`, `CONNECTION_DISABLED`, `STATE_CONFLICT`, `REPLICA_LINEAGE_MISMATCH`, `MEMORY_AUTHORITY_MISMATCH`) | `failed` / `producer_refused`, no result |
| `HINDSIGHT_LIFECYCLE_INTERRUPTED` (service stop mid-call) | `failed` / `producer_incomplete` |
| stopping service before claim | `failed` / `runtime_unavailable` / `HINDSIGHT_LIFECYCLE_INTERRUPTED` |
| setup deadline (`setupTimeoutMs`) | `failed` / `HINDSIGHT_TIMEOUT` |
| restart, provision row open | `completed` iff the row is verified and replica-bound, else `outcome_unknown` / `producer_incomplete` |
| restart, revalidate row open | `completed` iff reviewed fingerprint == `fingerprintAfter`, its admission evidence exists and the published runtime is on it; else `outcome_unknown` |

Claim is one macrotask after admission (`claimLifecycle`); cancel only while `admitted`. `observeBoot` is read-only and
never redispatches; without a lifecycle service it defers to the generic `core_restart` reconciliation.

### Family and single-flight (R9)

`hindsight-lifecycle` is the fourth member of `EXCLUSIVE_MEMORY_FAMILIES`; both lifecycle kinds, and every setup, Local
and activation kind, call `refuseWhileExclusiveFamilyBusy` before any service call. A rebind never swaps under a running
provisioning. Shutdown stops the lifecycle service with Local onboarding and activation before `memoryRuntime.stop()`.

### Automatic triggers (R8, owner Q1-A / Q2-A)

- `bank_not_ready` -> `bank.provision` keyed by (Character, published runtime fingerprint). `config_changed` ->
  `connection.revalidate` keyed by (epoch, live fingerprint), only when the live config is ready and the revalidate
  blocker returns null (lineage, `deploymentMode` and template revision unchanged). Other reasons submit nothing.
- The once-guard is the persisted rows (`automaticLifecycleAttempted`): any `automatic`-origin row for the key, whatever
  its outcome, blocks another automatic submit, across restarts. Operator rows never count. A failed automatic attempt
  waits for the operator's 创建 Bank / 重新校验连接.
- Submits go through the same kinds and admission. A refusal (busy family, changed state) creates no row, is logged,
  and the Run stays degraded; nothing is queued. The trigger is late-bound (`bind` after the operation owner exists) and
  never throws into the Run.

### Verified reconnect callers (R7, G13)

Exactly two: a revalidation whose runtime is already on the new fingerprint, and the subsystem after a foreground
capture that admitted and synced every routed Bank while some `automatic` Bank has `retryDueAt` set with an
availability `errorCode`. Never from the scheduler's own drain, scheduled runs or WS/browser events.
`verifiedReconnect()` itself does not catch: the subsystem caller logs `HINDSIGHT_REPLICA_SCHEDULE_STALE` and the Run
continues; in the revalidate caller a throw settles the operation `failed` after the fingerprint was already recorded.

### Status section and actions (R3, R4)

- `hindsight` is non-null iff marker `hindsight` (schema refine; that authority also always names epoch and lineage),
  readable while the runtime is unavailable, and never probes the network. An unreadable live config reads
  `unconfigured`.
- `drift`: `config_changed` when the bound runtime says so; `none` when the reviewed fingerprint is null or equals the
  live one; otherwise `unreviewed` if the bound runtime has no drift (boot after an edit), else `config_changed`.
  `admittedAt` is the admission evidence for (epoch, live fingerprint).
- Banks: every B3 row (verified -> `ready` if replica-bound else `syncing`; open `bank.provision` -> `provisioning`;
  `failed` / `not_provisioned` with the row's code) plus Timeline Characters without a row (`nativeBankId: null` when the
  id cannot map). Max 256.
- Actions: none while any exclusive family is open. `revalidate` = config ready, blocker null, and drift not `none` or
  reason `not_installed` / `connection_unavailable` / `config_changed`. `provision` = Characters `not_provisioned` or
  `failed` with a native id, only while the runtime is available.
- B3 `configured` requires a verified Global row, at least one verified Character row and compatibility; other
  Character rows may be pending or failed.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| provision: no runtime, drift, unmappable id, no verified Global, Bank already ready | `MEMORY_OPERATION_UNSUPPORTED`; no row |
| either kind while any of the four families is open | `MEMORY_OPERATION_BUSY` + `activeOperationId` |
| provision template conflict | `failed` / `HINDSIGHT_TEMPLATE_CONFLICT`; zero native calls |
| occupied native Bank, no B3 row | `failed` / `HINDSIGHT_BANK_OCCUPIED`; no PUT, no row |
| dry-run/import/verify failure | `failed` row for that scope; other Banks keep serving |
| revalidate disabled / mode or template change / other lineage | refused with its code; binding, reviewed fingerprint and mode kept |
| revalidate health or version failure | `failed` with the closed code; no reviewed state or Bank row written |
| replacement fails to build or start | `failed` / `runtime_unavailable`; binding `unavailable`; chat refused; `recoverBinding` offered |
| scheduler `armTimer` throws (e.g. `banks()` refused under drift) | recorded as `lastError()`; no escaped rejection |

## 5. Good / Base / Bad Cases

- Good: `mika` first chats after activation -> degraded reply, witness kept, one automatic `bank.provision` -> `ready`;
  the next Run recalls Global + `mika` and the degraded turn is ingested once.
- Base: key rotation -> `config_changed`, degraded Runs, one automatic revalidate rebinds; the old scheduler stops once.
- Bad: revalidating a deployment-mode change after a restart because the rebuilt runtime carried the new mode.

## 6. Tests Required

- `hindsight-lifecycle/hindsight-lifecycle-journey.test.ts`: AC1-AC6 (provision journey, refusals, occupancy, dry-run
  and first-sync failures, drift + rebind, in-flight Run across `replace`, failed replacement, disabled/mode/template/
  lineage refusals, cross-restart mode cases, pre-050 row, health failure, reconnect callers, automatic triggers, busy,
  D87 journey). `operations/memory-operation-kind-lifecycle.test.ts`: admission matrix, four-family busy both ways,
  pre-claim cancel, both `observeBoot`s. `hindsight-unbound-run.test.ts`, `memory-authority-status.test.ts`,
  `memory-hindsight-lifecycle-status.test.ts`, migration 050, connection repo, Shared schema tests, isolated boot
  (head 050, zero fetches).

## 7. Wrong vs Correct

Wrong: any unbound code degrades once the connection is disabled.

```ts
if (live && live.state !== "ready") return "connection_disabled";
```

Correct: only the connection guard's own codes degrade; integrity and unknown failures keep refusing.

```ts
if (live && live.state !== "ready") return DISABLED_CODES.has(binding.code) ? "connection_disabled" : null;
```

## Common mistakes (found this stage)

- Swallowing a refused primary witness under drift (log and drop) instead of the marker-routed witness.
- Letting a scheduler rearm failure escape as an unhandled rejection instead of `lastError()`.
- Degrading every unbound state once the operator disables the connection, masking an integrity failure.
- Using the published runtime as the deployment-mode reference after a restart rebuilt it on unreviewed settings;
  the persisted reviewed mode (050) is the reference and NULL fails closed.
- Reusing one native verification id after a recapture (see the activation spec's derivation rule).

## Known limits

- `MEMORY_AUTHORITY_MISMATCH` is overloaded (disable drift vs real mismatch at `start()`); under a non-ready config it
  degrades, and the marker re-read still refuses a real break.
- Provision is admitted while drift is `unreviewed` (runtime bound on live settings after a boot-time edit).
- Occupancy ignores `failed_operations`. D86 and D88 remain open (`docs/deferred-decisions.md`).
