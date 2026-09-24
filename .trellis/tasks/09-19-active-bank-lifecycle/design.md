# Stage 2c design

Source of truth for file:line grounding: [research/stage2c-seams.md](research/stage2c-seams.md) §2 (primitives), §3
(gaps), §5 (contracts). Rulings: [grill.md](grill.md). This file fixes structure and seams per wave.

## 1. Shared contracts

- New `memory-hindsight-lifecycle-schema.ts`:
  - wave A: `HindsightBankReadinessSchema` (`ready | syncing | provisioning | failed | not_provisioned`),
    `MemoryHindsightStatusSectionSchema` = `{ connection: { config: "ready"|"disabled"|"unconfigured", drift:
    "none"|"config_changed"|"unreviewed", admittedAt: Timestamp|null }, banks: [{ scope, characterId|null,
    nativeBankId, readiness, errorCode|null }], actions: { revalidate: boolean, provision: string[] } }`;
  - wave B: request arms `{ kind: "bank.provision", characterId }`, `{ kind: "connection.revalidate", expectedEpochId }`,
    producer refs and results per research §5, lifecycle error codes.
- `memory-authority-status-schema.ts`: `hindsight: section | null` with superRefine (non-null iff mode `hindsight`);
  `MemoryRuntimeUnavailableReasonSchema` + `connection_disabled`, `config_changed`.
- `hindsight-connection-schema.ts`: `HINDSIGHT_BANK_OCCUPIED`, `HINDSIGHT_CONNECTION_DISABLED`.
- `hindsight-setup-schema.ts`: relaxed `configured` refine (R4).
- `memory-operation-schema.ts` (wave B): kinds, unions, error union, explicit per-kind producer table (not exported).
- `index.ts`: dense named re-exports only; wave A <= 2 lines, wave B <= 2 lines; re-count against 500 each wave.

## 2. Wave A — degrade path, witnesses, truthful status (no new producer)

- `hindsight/hindsight-unavailable-run.ts`: `createHindsightUnavailableRun({ epoch, reason })` -> `CapturedMemoryRun`
  with no tools, empty assemble, no prompt, all-false capability snapshot (grill ruling).
- `hindsight-memory-runtime.ts`: `synchronizeForCapture` classifies — Bank not ready for the Character (no verified
  pair) -> degraded; availability failure with no evidence for the current fingerprint -> degraded; integrity codes
  rethrow.
- `hindsight-memory-subsystem.ts`: `assertConnection` refusal from drift/disabled -> degraded capture (not a throw);
  `initializeBaseline` still runs; `recordPrimaryCommitted` under refusal witnesses via `witnessHindsightPrimaryCommit`
  (G11) instead of logging and dropping.
- `hindsight-runtime-connection.ts`: expose `driftReason(): "none" | "config_changed" | "connection_disabled"` and
  per-scope readiness helpers; construction refuses `desiredTemplateRevision` != verified rows' revision with a closed
  code (binding stays observable as unavailable per the S2b boot path).
- `hindsight-replica-scheduler.ts`: `armTimer` catches and records `lastError` (G12).
- `operations/memory-hindsight-lifecycle-status.ts`: pure read building the section from marker, B3 rows, live config
  fingerprint vs runtime-captured vs B3 snapshot, admission evidence, open lifecycle rows (none until wave B), replica
  state, Timeline Characters without rows; `actions` = `{ revalidate: false, provision: [] }` in wave A.
- `operations/memory-authority-status.ts`: include the section; map drift/disabled to the new reasons.

## 3. Wave B — producers, rebind, reconnect, automatic triggers

- `memory/hindsight-lifecycle/hindsight-lifecycle-service.ts`: `provision({ characterId, signal, checkpoint })` and
  `revalidate({ epochId, signal, checkpoint })` over `setupTargets`/`dryRunTemplates`, `applyHindsightBank`,
  compatibility validate, `admitHindsightApplication`, admission-evidence repo, connection repo, scheduler
  `requestManual`/`verifiedReconnect`, and the composition `replaceHindsightBinding` seam.
- `hindsight-lifecycle/hindsight-bank-occupancy.ts` + `hindsight-client.ts` `bankStats(bankId)` (grill occupancy rule).
- `operations/memory-operation-kind-bank.ts`, `memory-operation-kind-connection.ts` mirroring
  `memory-operation-kind-hindsight.ts` (deferred claim, `observeBoot`); `memory-operation-kinds.ts` registry rows;
  `memory-operation-contract.ts` family + `lifecycle?` context; `memory-operation-service.ts` passes it.
- `hindsight-runtime-binding.ts` `replace(epochId)`: build new draft while old stays published, swap, await
  `old.stop()`, `new.start()`; failure -> unavailable with code. `runtime-selector.ts` / `runtime-composition.ts` expose
  `replaceHindsightBinding`.
- Subsystem G13 callback: after a foreground capture that admitted and synced every routed Bank, if any automatic Bank
  is in availability backoff, call `scheduler.verifiedReconnect()` once.
- Automatic triggers (only if the owner picks Q1-A / Q2-A): a late-bound submitter in `main.ts` invoked by the degraded
  capture with a per (Character|epoch, fingerprint) once-guard persisted in the operation rows (a prior failed row for
  the same key blocks automatic retry).
- `boot/hindsight-lifecycle-boot.ts` composes the service; `main.ts` wiring + shutdown order.
- Status `actions` become Core-derived: `revalidate` when drift/unavailable and no open exclusive family;
  `provision` = Characters in `not_provisioned | failed`.

## 4. Wave C — Home

- `memory-authority-state.ts`: readiness rows, labels for the two reasons and both kinds.
- `memory-authority-card.tsx`: readiness block, 创建 Bank (per Character) / 重新校验连接 from `hindsight.actions`
  through the generic controller `submit`; ids only in diagnostics.
- `memory-authority-fixtures.ts`, `use-memory-operations.ts`; `index.md`.
