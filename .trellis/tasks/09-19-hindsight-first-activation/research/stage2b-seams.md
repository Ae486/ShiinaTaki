# Research: Stage 2b first-activation seams (PR03 + A10/A11/A12/A38, case C03)

- **Query**: production start/resume/activate orchestration for an existing Local instance's first Hindsight activation
- **Scope**: internal (Core/Shared/Desktop at `main` `d6278e3`; native patch read from `H:/hindsight/TAKI_PATCHES.md` only)
- **Date**: 2026-09-23

## Index

1. B4 substrate map — every primitive, signature, tables, reachability (§1)
2. PR03 custody, Local -> Hindsight — what happens today to groups/witnesses across COMMIT (§2)
3. Fence and drain coverage — Local writer inventory vs. the Legacy-only fence (§3)
4. Operation surface recommendation — kind, family, producer ref, phases, results, codes, reads (§4)
5. Recovery classification — pre/post-COMMIT, restart, lost reply, duplicate submit (§5)
6. Home seams — cards/controllers/ws-client, settings, smallest guided path (§6)
7. Isolation and test substrate — doubles, fixtures, C03 journey, manual residue (§7)
8. Wave split A/B/C + Home and the closed failure matrix (§8)
9. Caveats / not found

Conventions: paths are relative to `H:/TakiAgent`; `core/` = `packages/core/src`, `shared/` = `packages/shared/src`,
`ui/` = `apps/desktop/src`. Tables are named exactly as in the migrations. Nothing below was executed.

## Numbered gap list (severity)

| # | Sev | Gap (evidence) |
| --- | --- | --- |
| G1 | high | No production coordinator. `promoteHindsightWithFence`, `prepareHindsightCurrentBank`, `importHindsightCurrentBank`, `verifyHindsightCurrentBank`, `fetchHindsightCurrentBaseline`, `HindsightCutoverRunRepo.create/acquireLease/captureCoverage/markReady` and `promoteHindsightAuthority` have only test callers; `core/server/methods/hindsight-cutover-methods.ts:21-33` registers `memory.hindsight.cutover.status/verify` reads only (A12). |
| G2 | high | The composition fence is Legacy-only and already retired after Legacy -> Local (`core/memory/legacy-migration/legacy-migration-runner.ts:74`, `core/memory/runtime-composition.ts:114`); `fence.quiesce` on a retired fence throws `MEMORY_AUTHORITY_FENCED` (`memory-authority-fence.ts:27`), so `promoteHindsightWithFence` cannot be reused as-is. `createCanonicalLocalSubsystem` (`core/memory/canonical-local-subsystem.ts:22`) receives no fence; Local writers are only DB-epoch guarded. Any Local write between coverage capture and COMMIT yields `HINDSIGHT_LOCAL_COVERAGE_STALE` at promotion (A38/A11). |
| G3 | high | No in-process rebind after COMMIT. `selectMemoryRuntime` (`core/memory/runtime-selector.ts:33-65`) has `bindCanonical`/`recoverCanonical` only; `current()` in `runtime-composition.ts:119-123` is `hindsight ?? local.current() ?? legacy`, so after `promoteHindsightAuthority` the published Local subsystem keeps serving captureRun/assemble/maintenance/flush (writes fail `MEMORY_AUTHORITY_MISMATCH`, reads keep using retired state); `operations()` stays `null`; `memory.authority.status` says `not_installed`. Hindsight construction failure at boot has no `onBootUnavailable` path (`bootCanonical` only, `runtime-selector.ts:90-97`): Core boot aborts. |
| G4 | high | PR03: post-COMMIT primary evidence has no consumer. (a) `runtime-composition.ts:76` routes `recordPrimaryCommitted` to `(scope.hindsight ?? local.current())`; before a successful bind the Local path throws in `canonical-local-ingestion.ts:66-69` and is swallowed at `canonical-local-subsystem.ts:58-61`. (b) A custody group opened under Local (`assigned_epoch_id` = Local epoch, `core/db/primary-memory-custody-repo.ts:97-106`) that finalizes after COMMIT throws in `finalize()` (`:128-143` -> `canonical-ingestion-source-repo.ts:69-72` -> `assertCanonicalLocalAuthority`), stays `open` with `producer_settled=1`; `reconcile()` (`:42-50`) rethrows and is only called by Local paths. (c) Groups opened after COMMIT are header-only (`currentLocalCandidate` returns null under `hindsight`) and never adopted (`:182-185`). (d) Unconsumed Local witnesses (`canonical_memory_primary_commits.ingestion_span_id IS NULL`) and pending Local spans are stranded: Hindsight's `previousCommit` (`core/db/hindsight-ingestion-source-repo.ts:66-83`) only runs on a re-commit and throws `MEMORY_AUTHORITY_MISMATCH` for an incomplete Local span. `promoteHindsightAuthority` checks none of this. |
| G5 | medium | No transition refusal in `runtime-composition.ts:70-75 captureRun`; a Run captured during the interval gets Local tools that fail closed post-COMMIT, not the structured unavailable/transition refusal S2a promised for committed-but-unbound state. |
| G6 | medium | Family isolation: `setup` kinds and the direct `memory.hindsight.validate/setup/disable` RPCs (`core/server/methods/hindsight-setup-methods.ts:33-41`) are not excluded during an open activation; `disable` has no authority check (`hindsight-setup-service.ts:158-166`). `memory.tidy` (`tidy.runNow`) and `writeMemory` (image descriptions, `core/main.ts:200-207`) stay open. |
| G7 | medium | Contract cannot express the kind: `MemoryOperationKindSchema` closed; `superRefine` maps any non-`local.`/`setup.` prefix to producer kind `replica` (`shared/memory-operation-schema.ts:95`); `MemoryOperationErrorCodeSchema` lacks B4/D78 codes; `ui/.../memory-authority-state.ts:51 KIND_LABEL: Record<MemoryOperation["kind"], string>` fails typecheck until extended; `shared/index.ts` has 21 non-comment lines of headroom (479/500 under `eslint.config.js:52`). |
| G8 | medium | Bank coverage is a manual prerequisite: promotion needs `hindsight_bank_setup` == coverage Bank set (`core/db/hindsight-authority-repo.ts:139-149`, `hindsight-local-bank-binding.ts:26-37`); `setup.apply` provisions Global + one Character per call (`hindsight-setup-stages.ts:12-17`); D86 lazily creates `canonical_memory_banks` rows -> `HINDSIGHT_BANKS_INCOMPLETE` with no in-operation producer. |
| G9 | medium | Lease/identity: `hindsight_cutover_runs.run_id` must equal the B2 migration run id (`hindsight-cutover-run-repo.ts:111-126`); the lease re-acquires only for the same owner or after expiry (`:128-141`); TTL is caller-chosen (B2 uses 600 s with per-source renewal). A crash mid-import blocks resume until expiry unless the owner id is stable across boots. |
| G10 | low | `core/db/structured-memory-block-repo.ts:31-34 replace` has no epoch guard: an in-flight Local tidy pass can write `taki_memory_blocks` after COMMIT (Blocks are in the coverage manifest, `hindsight-local-coverage-reader.ts:44-48`). |
| G11 | low | Boot evidence: the only join from an operation to `hindsight_authority_activation_receipts` is a Core-minted `transaction_id`/`hindsight_epoch_id` reserved at admission (S2a `activationTransactionId` pattern); a corrupt hindsight marker throws `MEMORY_INTEGRITY_ERROR` inside `selectMemoryRuntime` (`legacy-activation-repo.ts:29-44`) and aborts boot with no observable state. |

## 1. B4 substrate map

| Primitive (file:line) | Takes -> returns | Reachability today | Authority tables / receipts written |
| --- | --- | --- | --- |
| `createHindsightCutoverRunRepo(db)` -> `{create, acquireLease, renewLease, releaseLease, captureCoverage, markReady, status, verify}` (`core/db/hindsight-cutover-run-repo.ts:13-36`) | `create({runId, expectedPredecessorEpochId, now})` requires `memory_migration_runs` phase `activated`/`completed` with that epoch, inserts `hindsight_cutover_runs` (`importing/running`) and captures+selects the initial manifest; `acquireLease({runId, owner, now, expiresAt})` -> `HindsightCutoverLease {runId, owner, fence, expiresAt}`; `captureCoverage({lease, now})` -> new manifest version, resets `config_fingerprint`/`checkpoint_set_digest`; `markReady({lease, configFingerprint, checkpointSetDigest, now})`; `status(runId)` -> `HindsightCutoverStatus`; `verify({runId, expectedRevision, expectedEpochId})` -> `HindsightCutoverVerifyResult` | `status`/`verify` via `memory.hindsight.cutover.*` (`core/boot/hindsight-setup-boot.ts:47`); mutations: tests only | `hindsight_cutover_runs`, `hindsight_cutover_local_coverage`, `hindsight_local_coverage_manifests` (037) |
| `createHindsightLocalCoverageRepo(db)` `{capture, read, selected, compareCurrent, assertCurrent, readForPreparation}`; `selectHindsightLocalCoverage`; `reserveHindsightLocalWriter(db, epochId)` (`core/db/hindsight-local-coverage-repo.ts:34-49,150,162-168`) | capture hashes `canonical_memory_banks/sources/units/policy/unit_sources/derived` + `taki_memory_blocks` + the epoch row (`hindsight-local-coverage-reader.ts:25-55`); witness/cursor/span tables are NOT part of the manifest | internal | immutable manifests; `reserve...` is a same-transaction UPDATE on `canonical_memory_authority_state` requiring reason `initial-local` |
| `requireHindsightLocalCoverage(db, {runId, readyBinding?, now?})`, `hindsightLocalCoverageBlockingCode`, `readHindsightLocalCoverageStatus` (`core/db/hindsight-local-coverage-guard.ts:18-54`) | with a D78 capture present the B2 catch-up branch is skipped and `requireHindsightCurrentCutover` runs | internal (promotion, markReady, verify) | none |
| `captureHindsightCurrentLocal(db, {lease, manifestId, expectedEpochId, now})` -> `HindsightCurrentCapture` (`core/db/hindsight-current-capture-repo.ts:17-36`) | idempotent per manifest | tests / via prepare | `hindsight_current_captures` (039) |
| `fetchHindsightCurrentBaseline({bankId, ttlSeconds, client, context})` -> `HindsightCurrentBaseline {metadata, pages}` (`core/memory/hindsight/hindsight-current-orchestrator.ts:76-84`) | native `POST /ext/taki-memory/banks/{id}/snapshots` + pages (`hindsight-current-client.ts:60-64`); `metadata.manifest.bankGeneration` is the Bank generation the preparation must use | tests only | none |
| `prepareHindsightCurrentBank(db, {...captureInput, sourceBankId, providerLineage, bankGeneration, baseline, supersede?})` -> `HindsightPreparedCurrentBank {preparationId, request | null, gaps, ...}` (`core/db/hindsight-current-preparation-repo.ts:16-44`) | requires a `verified` `hindsight_bank_setup` row for the Local Bank's scope (`HINDSIGHT_TEMPLATE_NOT_VERIFIED`) and an otherwise empty target Bank (`prepareCurrentBaseline`, `hindsight-current-baseline.ts:22-55`, else `HINDSIGHT_CURRENT_TARGET_CONFLICT`); `providerLineage` = B3 `compatibility.providerLineage` | tests only | `hindsight_current_preparations` |
| `importHindsightCurrentBank({db, preparationId, client, context})` -> `HindsightCurrentImportEvidence` (`hindsight-current-orchestrator.ts:21-41`) | reads historical result first (`GET .../current-state-transfers/{op}`), POSTs only if `result_not_found`; refusals persist an immutable invalidation and throw `HINDSIGHT_CURRENT_NATIVE_REFUSED:<reason>`; `HINDSIGHT_CURRENT_PREPARATION_GAPS` when `request` is null | tests only | `hindsight_current_import_evidence`, `hindsight_current_native_invalidations` |
| `verifyHindsightCurrentBank({db, preparationId, lease, verificationId, replicaEpochId, client, context, now})` -> `{status, evidence | null}` (`:43-74`) | prepare/advance the finite candidate; on `complete` fetches evidence + snapshot pages and calls `saveHindsightCurrentVerification` (`core/db/hindsight-current-verification-repo.ts:20-52`) which publishes the raw replica (`hindsight-current-replica-publication.ts:12-44`) | tests only | `hindsight_current_verification_candidates`, `hindsight_current_verification_evidence`, `hindsight_replica_staging_runs/records`, `hindsight_replica_records`, `hindsight_replica_checkpoints` |
| `requireHindsightCurrentCutover(db, {manifest, now?})`, `hasHindsightCurrentCapture(db, runId)`, `requireHindsightCurrentCheckpointRetention` (`core/db/hindsight-current-cutover-guard.ts:16-69`); `requireHindsightCurrentNativeState(db, {preparationId, candidateId?})` (`hindsight-current-invalidation-repo.ts:60`); `readHindsightCurrentStatus(db, runId)` -> `HindsightCurrentStatus` (`hindsight-current-status-repo.ts:15`) | proof validation per Bank incl. dispositions and published snapshot equality | internal / status | none |
| `hindsightCheckpointSetDigest(banks)`; `promoteHindsightAuthority(db, {lease, predecessorEpochId, hindsightEpochId, transactionId, configFingerprint, checkpointSetDigest, banks:[{bankId, templateDigest, checkpoint}], now})` -> `{selection, hindsightEpochId, predecessorEpochId}` (`core/db/hindsight-authority-repo.ts:22-48,270`) | one synchronous transaction: `reserveHindsightLocalWriter`, predecessor reason `initial-local`, source run receipt join, ready cutover row under the lease, connection `configured` + fingerprint + lineage, exact `hindsight_bank_setup` set, checkpoints/staging/visible replica equality, coverage current | `promoteHindsightWithFence` (unused, `hindsight-authority-promotion-service.ts:10-18`) | closes Local epoch, inserts `canonical_memory_authority_epochs` (`hindsight`, `planned-switch`), moves `canonical_memory_authority_state`, `hindsight_authority_activation_receipts`, `hindsight_authority_bank_receipts`, `memory_authority_selection` (`mode='hindsight'`), `hindsight_cutover_runs` -> `activated/completed` |
| `readMemoryAuthoritySelection(db)` (`core/memory/legacy-migration/legacy-activation-repo.ts:17-44`) | for `hindsight` mode joins receipt + cutover run + bank receipts + active epoch; throws `MEMORY_INTEGRITY_ERROR` otherwise | every read | none |
| B3: `createHindsightSetupService` `{status, validate, setup, disable, llmHealth}` (`core/memory/hindsight/hindsight-setup-service.ts:38-44`); kinds `setup.validate/apply` (`core/memory/operations/memory-operation-kind-setup.ts`) | `validate`/`setup`/`llmHealth` require marker `canonical-local` (`:259`); `setup({characterId})` targets Global + that Character (`hindsight-setup-stages.ts:12-17`, native PUT bank / import dry-run+apply / export verify, `hindsight-bank-setup.ts:28-49`) | `memory.hindsight.*` RPCs + operation kinds | `hindsight_connection_state` (phase/revision/config_fingerprint/compatibility_json), `hindsight_bank_setup` (scope, canonical_identity, external_bank_id, template_digest, status) |
| Client: `createHindsightClient({endpoint, resolveApiKey, transport?})` -> `HindsightClient` incl. current-state, native-result, application methods (`hindsight-client.ts:72-84,133`) | production factory: `core/boot/hindsight-setup-boot.ts:40` and `hindsight-runtime-connection.ts:56` | — | — |
| Runtime: `createHindsightMemorySubsystem(input)` -> `{engine, maintenance, memoryFlush, tidy, writeMemory, snapshot, state, ingestion, curator, scheduler, start, stop, captureRun, recordPrimaryCommitted}` (`hindsight-memory-subsystem.ts:37-76`); `createHindsightRuntimeConnection` (`:23-63`, needs `authorityEpoch(epochId).providerId==='hindsight'` and `resolveHindsightConfig(...).state==='ready'`); `createHindsightRuntimeState` (`hindsight-runtime-state.ts:39-66`, no network); B5 `scheduler.start()` = `ensureBank/recover/requestCatchUp` (`hindsight-replica-scheduler.ts:65-75`, owner `hindsight:<epochId>`) | constructed only at boot when the marker is `hindsight` (`runtime-selector.ts:39-40`) | first `captureRun` synchronizes (`hindsight-memory-runtime.ts:52-75`, network); Hindsight ingestion needs `hindsight_replica_sync_checkpoints` for the new epoch (`hindsight-ingestion-guard.ts:26-37`) | `hindsight_replica_sync_schedule`, D77 tables 042-047 |
| Composition: `composeMemoryRuntime` (`runtime-composition.ts:55-99`) `{selected, memory, fence, custody, snapshot, bindingSnapshot, operations, captureRun, recordPrimaryCommitted, autoMemory, compaction, tidy, writeMemory, start, stop, memoryRoot, recoverLocalBinding, migrationRunner}`; `createLocalRuntimeBinding` (`local-runtime-binding.ts:36-65`) | S2a pattern to mirror: draft -> install -> publish -> start; `recoverLocalBinding(epochId)` = receipt proof + `custody.reconcile()` + `selected.recoverCanonical` | `core/main.ts:179-186,341,381-383,531,546` | — |
| Operation owner: `createMemoryOperationService({db, live, setup, local?, bootId, onChanged, logger})` (`memory-operation-service.ts:52-71`); handler contract `{family, admit, execute({request, producer, ctx, running, tryClaim, checkpoint}), observe?, observeBoot?, cancel?}` (`memory-operation-contract.ts:56-67`); registry `MEMORY_OPERATION_KINDS` (`memory-operation-kinds.ts:16-22`); evidence helpers (`memory-operation-local-evidence.ts`); `readMemoryAuthorityStatus` (`memory-authority-status.ts:29-49`) | `memory_operations` (048) has no kind CHECK; family single-flight index | `memory.operations.*`, `memory.authority.status` | `memory_operations` |

Existing harness for the whole chain: `core/db/hindsight-current-state-repo.test.ts:144-162` (prepare -> import -> candidate ->
verification -> markReady -> verify -> promote), `hindsight-authority-repo.test.ts`, `hindsight-authority-promotion-service.test.ts`.

## 2. PR03 custody, Local -> Hindsight direction

Current mechanics (all verified in source):

- Chat opens a custody group before the first primary append (`core/agents/chat-agent.ts:202-204`), appends members in the same
  transaction (`primary-memory-custody-repo.ts:69-79`), finalizes once in `finally` (`chat-agent.ts:237`), and separately fires
  `onPrimaryCommitted` (`:327,332`) -> `memoryRuntime.recordPrimaryCommitted` (`core/main.ts:381`).
- Under marker `canonical-local` the group is assigned to the Local epoch; under `hindsight` it is unassigned (`:97-106`).
  `finalize` writes whole-group Local witnesses only when `assigned_epoch_id` is set (`:135-138`); it never writes Hindsight
  witnesses. Hindsight witnesses come only from the callback path (`hindsight-ingestion.ts:69-71` ->
  `hindsight-ingestion-source-repo.ts:44-64`, table `hindsight_ingestion_primary_commits`, cursors `hindsight_ingestion_cursors`).
- Local ingestion consumes witnesses by epoch (`canonical-ingestion-source-repo.ts:132-138`); every Local read/write asserts the
  active Local epoch (`canonical-memory-maintenance-storage.ts:30-37`). After `promoteHindsightAuthority` every Local witness,
  cursor and span call throws `MEMORY_AUTHORITY_MISMATCH`.
- Hindsight `previousCommit` treats a completed Local span as history (returns true) and an incomplete one as
  `MEMORY_AUTHORITY_MISMATCH`; carried rows are processable below the Hindsight baseline (`pendingEntries` has no lower bound,
  `assertCovered` any seq).

What breaks at each point:

| Moment | Open/unfinalized Local group | Finalized-but-unconsumed witnesses | Late chat commit |
| --- | --- | --- | --- |
| Interval (fence armed, marker still Local) | members keep appending; finalize writes Local witnesses (fine) | accumulate with `ingestion_span_id IS NULL`; ingestion must be fenced or coverage goes stale | witnessed Locally; no consumer until COMMIT decides |
| COMMIT | `finalize` after COMMIT throws -> group `open`, `producer_settled=1`, never reconciled (G4b) | stranded (G4d) | callback -> Local subsystem -> swallowed (G4a) |
| Failed target binding | as above, plus `local.current()` still published -> callbacks keep hitting the retired Local path | stranded | dropped until repair |
| Restart either side | pre-COMMIT: Local boots, `reconcile()` finalizes dead groups Locally (fine); post-COMMIT: Hindsight boots, dead Local-assigned groups are never reconciled, unassigned post-COMMIT groups never adopted | stranded | witnessed only if the callback reached a bound Hindsight subsystem |

"Durably preserve for the resulting epoch" (recommended, mirrors S2a `assignPrimaryCandidate`/`relocateUnconsumed`):

1. Inside the promotion transaction: refuse if any Local span for the predecessor epoch is not `complete` (`MEMORY_INGESTION_INCOMPLETE`);
   copy every `canonical_memory_primary_commits` row with `ingestion_span_id IS NULL` into `hindsight_ingestion_primary_commits`
   (same `timeline_seq/entry_id/entry_digest/committed_through_seq/run_id`, epoch = new Hindsight epoch);
   insert `hindsight_ingestion_cursors` per Character with `through_seq=0`, `eligibility_start_seq=tail+1`
   (carried rows are late-below-baseline sources, the spec-allowed class); update `primary_memory_groups`
   `assigned_epoch_id` for `open`/`finalized` groups of the predecessor to the new epoch.
2. `finalize()` routes by the assigned epoch's provider: `local` -> `canonical-ingestion-source-repo`, `hindsight` ->
   `hindsight-ingestion-source-repo.recordPrimaryCommitted` (requires only an active hindsight epoch, `hindsight-ingestion-guard.ts:19-24`).
   `currentLocalCandidate` returns the hindsight epoch under marker `hindsight` so new groups are assigned, not header-only.
3. `previousCommit` checks a same-epoch Hindsight prior before the Local prior (idempotent carried replay).
4. `composition.recordPrimaryCommitted` routes by the durable marker, not by the in-memory subsystem: marker `hindsight` ->
   direct repo write (subsystem-independent), so a callback between COMMIT and bind (or after a failed bind) is never dropped.
   With step 2 in place the callback becomes a notification; keep it for the existing Hindsight cadence trigger.

"Refuse new source commitments during the interval" (alternative): gate `captureRun` for the whole interval and require
zero open Local groups/unconsumed witnesses at COMMIT. It needs no carry code but blocks chat for the D78 import +
certificate duration (native maintenance, minutes on real Banks). Either way the pre-capture drain (§3) is mandatory.

## 3. Fence and drain coverage (A38)

Legacy admission fence: `createMemoryAuthorityFence` (`memory-authority-fence.ts:14-36`) counts admissions, `quiesce` drains
then fences, `retire` is irrevocable; wrapped around the Legacy engine/tools (`fenced-memory-engine.ts:12-38`), Legacy
maintenance (`bootstrap.ts:105-108`) and Legacy flush (`memory-flush-port.ts:107`). Nothing Canonical Local passes through it.

Canonical Local writers (production) and what reaches them today:

| Writer | Path | Epoch guard | Fence |
| --- | --- | --- | --- |
| Foreground memory tools in a captured Run | `canonical-local-runtime.ts:47-48,55-56` -> coordinator -> `local-memory-provider` -> `canonical-memory-repo.ts:65-158` | yes (`assertActiveEpoch`) | none |
| `writeMemory` (image descriptions) | `runtime-composition.ts:80` -> `canonical-local-subsystem.ts:51` -> `writeCanonicalObservedMemory` | yes | none |
| Background ingestion (Write Gate + extraction, model calls) | `autoMemory.onTurnCompleted` -> `maintenance.run` (`canonical-local-subsystem.ts:44-50`) -> `canonical-local-ingestion.ts:57-61` (per-Character chains `:46-54`, no `settle()`) | yes | none |
| Tidy (model + Block writes) | same maintenance hook and `memory.tidy` -> `tidy.runNow` (`runtime-composition.ts:78-79`) | records yes; Blocks NO (`structured-memory-block-repo.ts:31-34`) | none |
| Retention sweeper | `startSweeper` (`canonical-local-subsystem.ts:39-43`, `enabled: epoch match`) | yes + pre-check | none |
| Compaction flush | `publishedFlushPort(current)` (`runtime-composition.ts:163-170`) -> `ingestion.flushPort` -> `ingestion.run` | yes | none (`MemoryFlushOutcome` already has `MEMORY_AUTHORITY_FENCED`) |
| Custody finalize / baseline init | `primary-memory-custody-repo.ts:128-143`, `captureRun` -> `initializeBaseline` | yes | none |
| B2 runner, onboarding exclude | Legacy-only (`publishMigrationCandidate` requires marker `legacy-markdown`) | — | n/a |
| B3 setup / `disable`, `setup.*` kinds | change promotion preconditions, not memory rows | `validate/setup` require Local; `disable` none | none (G6) |

What "quiesce + drain + retire old executables + no automatic reopen" needs for Local -> Hindsight:

- A Local write fence (same shape as `MemoryAuthorityFence`, write-only) installed by the Local subsystem draft: wrap
  provider mutations (retain/edit/invalidate/restore/copy/policy), `writeEntry`, `maintenance.run`, `tidy.maybeRun/runNow`,
  `createBackgroundTools`, `retentionSweep` `enabled()`, and `flushPort.prepareRetirement` (return `retryable_failure`
  `MEMORY_AUTHORITY_FENCED`). Reads (`assemble`, recall, `createTools`) stay open; a fenced tool write returns the structured
  `MEMORY_AUTHORITY_FENCED` to the model. Expose `settle()` on `CanonicalLocalIngestion` (mirror `createHindsightIngestionLifetime`,
  `hindsight-ingestion.ts:50-57`) and use `autoMemory.settle()` (`auto-memory.ts:116`) plus the compaction pass settle for the drain.
- Drain order: fence writes -> `autoMemory.settle()`/ingestion settle -> forced Local ingestion `run` for every Character with a
  pending span or unprocessed witnesses (model calls; the only way to get `no pending span` before capture) -> `captureCoverage`.
  Any later coverage staleness is a refusal, not a retry loop.
- Retire on COMMIT: fence `retire()`, `local.stop()` (disposes the retention worker, `local-runtime-binding.ts:63`), selector
  `state.current` swap, composition `hindsight` set; held Local tool closures fail closed via the DB guard; Block writes are
  stopped by the fenced tidy pass (G10).
- Reopen only on positive pre-commit evidence: mirror `retireUnlessLegacy` (`legacy-migration-runner.ts:83-88`) with
  `mode === "canonical-local" && epochId === predecessor`.
- Restart pre-COMMIT: boot does not re-fence (an abandoned operation must not freeze Local); the resumed operation re-fences,
  `assertCurrent` on the selected manifest, and recaptures explicitly when stale (new manifest version, old D78 evidence immutable).

## 4. Operation surface recommendation

Reuse Stage 1/2a names and shapes; everything below is additive.

- Kind: `hindsight.activate` (one kind, U1 = one confirmation), family `hindsight-activation`. Request
  `{ kind: "hindsight.activate", source: { mode: "new", setupRevision, expectedEpochId } | { mode: "resume", runId } | { mode: "recover", epochId } }`.
  `recover` mirrors `local.onboard.activate` on a committed run: binding repair only, never a second promotion.
- Admission (synchronous, side-effect free, like `memory-operation-kind-local.ts:87-105,136-145`): marker `canonical-local` for
  `new`/`resume` (`hindsight` + receipt tx match for `recover`); `ctx.live() === null`; `setup.status()` phase `configured`,
  `compatibility !== null`, `configFingerprint` equals the live fingerprint (`hindsightConnectionFingerprint`); no active row in
  families `setup` and `local-onboarding` (`repo.activeInFamily`); B2 run id = `memory_migration_activation_receipts.run_id`
  joined by `verifyCanonicalLocalReceipt`; every `canonical_memory_banks` row of the epoch has a `verified` B3 row
  (`readHindsightLocalBankBinding`), else refuse with the missing scopes. Mint `hindsightEpochId`, `transactionId`,
  per-Bank `replicaEpochId`/`verificationId` (UUIDs) into the producer ref before execution; claim via `tryClaim` after one macrotask.
- Producer ref `{ kind: "hindsight", runId, hindsightEpochId, transactionId, configFingerprint, manifestId | null,
  progress: { phase, bankCount, preparedBankCount, importedBankCount, verifiedBankCount, carriedWitnessCount }, banks: [{ nativeBankId, scope, replicaEpochId, verificationId, preparationId | null }] }`;
  phases `reserved | draining | capturing | preparing | importing | verifying | ready | committing | binding | completed`.
  `checkpoint()` after every durable step (each D78 primitive is its own transaction).
- Result `{ kind: "hindsight", runId, outcome: "activated" | "binding_unavailable" | "prerequisite_blocked", epochId | null, runtimeAvailable, blocking: [] }`.
- Error codes: new closed `MemoryHindsightActivationErrorCode` = `HindsightErrorCode` ∪ `HINDSIGHT_PREDECESSOR_STALE`,
  `HINDSIGHT_SOURCE_RUN_NOT_COMPLETED`, `HINDSIGHT_CUTOVER_LEASE_LOST` (from `LEASE_LOST`), `HINDSIGHT_LOCAL_COVERAGE_STALE`,
  `HINDSIGHT_LOCAL_COVERAGE_MISSING`, `HINDSIGHT_LOCAL_COVERAGE_LIMIT_EXCEEDED`, `HINDSIGHT_CURRENT_TARGET_CONFLICT`,
  `HINDSIGHT_CURRENT_PREPARATION_GAPS`, `HINDSIGHT_CURRENT_NATIVE_REFUSED`, `HINDSIGHT_CURRENT_VERIFICATION_INCOMPLETE`,
  `HINDSIGHT_CURRENT_IMPORT_MISSING`, `HINDSIGHT_CURRENT_VERIFICATION_MISSING`, `HINDSIGHT_CURRENT_REPLICA_STALE`,
  `HINDSIGHT_BANKS_INCOMPLETE`, `HINDSIGHT_TEMPLATE_NOT_VERIFIED`, `HINDSIGHT_CONNECTION_NOT_VERIFIED`, `HINDSIGHT_PROVIDER_LINEAGE_MISMATCH`,
  `HINDSIGHT_CHECKPOINT_MISSING`, `HINDSIGHT_CHECKPOINT_STALE`, `HINDSIGHT_CHECKPOINT_SET_STALE`, `HINDSIGHT_MANIFEST_STALE`,
  `HINDSIGHT_REPLICA_NOT_PUBLISHED`, `HINDSIGHT_PROMOTION_CONFLICT`, `MEMORY_QUIESCENCE_TIMEOUT`, `MEMORY_INGESTION_INCOMPLETE`,
  `MEMORY_AUTHORITY_MISMATCH`, `MEMORY_RUNTIME_UNAVAILABLE`, `HINDSIGHT_ACTIVATION_INTERRUPTED`, `HINDSIGHT_ACTIVATION_INTERNAL_ERROR`.
  Map like `localErrorCode` (`memory-operation-local-evidence.ts:35-43`); unknown -> `HINDSIGHT_ACTIVATION_INTERNAL_ERROR` + `outcome_unknown`.
- Reasons/refusals: existing `MemoryOperationReason` and `MemoryOperationRefusalReason` suffice; add no new reason.
- `observeBoot` (read-only): receipt with matching `transaction_id` -> `committedSettlement` from the Hindsight binding
  snapshot; no receipt and marker `canonical-local` with the epoch -> `outcome_unknown/producer_incomplete` + `resume`
  (phase from `hindsight_cutover_runs`); marker `hindsight` with another tx, or unreadable -> `outcome_unknown/commitment_unknown`.
- Reads: add `memory.activation.status` (operator-only, strict) returning `{ authority, runtime, setup: { phase, revision, configured }, prerequisites: { banks: [{ scope, localBankId, nativeBankId | null, verified }], blocking: [] }, run: { runId, phase, status, lease, currentState: HindsightCurrentStatus | null, receipt: { transactionId, epochId, committedAt } | null } | null, custody: { openGroups, unconsumedWitnesses, pendingSpans }, operation, actions: { activate, resume, recoverBinding, cancelOperationId }, observedAt }`
  derived like `readLocalOnboardingStatus` (`local-onboarding-status.ts:21-58`). Invalidate through the existing
  `memory.operations.changed` push (Home already refetches on it); no second subscription, saving `shared/index.ts` lines.
  `memory.authority.status` needs no schema change: after COMMIT it reports `authority.mode=hindsight` and a truthful
  `runtime.unavailableReason` (`not_installed` until bound); extend `unavailableReasonOf` only if new codes appear.
- Frozen S2a contracts that cannot express this: `superRefine` producer inference (`memory-operation-schema.ts:95-97`) must
  learn the `hindsight.` prefix; `MemoryOnboardingActionsSchema` stays untouched (Local card unchanged).

## 5. Recovery classification

| Situation | Durable evidence today | Classification / next action | Missing |
| --- | --- | --- | --- |
| Pre-COMMIT failure (drain/capture/prepare/import/verify) | `hindsight_cutover_runs` phase/status/lease, `hindsight_current_*` evidence, marker Local, no receipt | `failed` with the closed code; Local stays; `resume` continues from persisted evidence (D78 replay is idempotent) | operation row + phase checkpoint (§4); fence release proof |
| Post-COMMIT bind failure | receipt + marker `hindsight`, `hindsight_cutover_runs` `activated/completed` | `failed/runtime_unavailable` with result `binding_unavailable`; `recover` repairs binding only | `bindHindsight`/`recoverHindsightBinding`, Hindsight binding snapshot (G3) |
| Restart before COMMIT | run row + evidence; marker Local; lease possibly held by the dead owner | `outcome_unknown/producer_incomplete`; explicit `resume`; Local runtime boots normally | stable lease owner or bounded TTL (G9); no auto-dispatch by design |
| Restart after COMMIT | receipt/marker verified by `readMemoryAuthoritySelection` at boot | boot selects Hindsight; `observeBoot` -> `completed/activated` or `failed/binding_unavailable` | boot-unavailable path for Hindsight (G3/G11) |
| Marker `hindsight`, receipt/tx mismatch or unreadable | — | `outcome_unknown/commitment_unknown`; fail closed, never Local/Legacy | none beyond §4 |
| Lost reply | `memory_operations` row | client discovers via `memory.operations.list`/`memory.authority.status.operations`; never resubmits | none (S2a controller rule) |
| Duplicate submit | family index | `MEMORY_OPERATION_BUSY` + `activeOperationId` | none |
| Late primary commit across COMMIT | custody members + witnesses per §2 | processed once by the resulting epoch | §2 steps 1-4 |

## 6. Home seams

- Stage 1 card: `ui/windows/home/pages/operations/memory-authority-card.tsx` (authority/runtime/setup lines, Bank blocks,
  active operations), view model `memory-authority-state.ts:57-93` (`KIND_LABEL` must grow), controller
  `memory-operations-controller.ts:126-153` (`submitSync`/`cancel` only; add a generic `submit(request, key)`), hook
  `use-memory-operations.ts`, ws wrapper `ui/lib/ws-client-memory-operations.ts:24-60`.
- S2a card: `local-onboarding-card.tsx`, `local-onboarding-actions.ts` (Core-derived allow checks), `local-onboarding-controller.ts`
  (subscribe-before-read, coalesced refetch, no replay), `use-local-onboarding.ts`, `ui/lib/ws-client-memory-onboarding.ts`.
  Its guidance under `hindsight` is the single line "已有记忆权威" (`local-onboarding-card.tsx:86`).
- There is no Hindsight setup page: `TAKI_HINDSIGHT_*` knobs are ordinary Settings entries under `advanced`
  (`ui/windows/home/pages/settings/config-groups.ts:72`); `memory.hindsight.validate/setup` have no Home producer.
- Smallest guided existing-instance path: one new card `hindsight-activation-card.tsx` (+ `hindsight-activation-state.ts`,
  `use-hindsight-activation.ts`) on the Operations page, fed by `memory.activation.status` (add one method to
  `ws-client-memory-operations.ts`) and reusing `memory-operations-controller` for submit/refetch. It shows setup phase and
  Bank prerequisites, offers `校验连接`/`应用配置` (existing `setup.validate`/`setup.apply` kinds) while not configured, and one
  `启用 Hindsight` button (U1) once `actions.activate`; progress phases, committed-but-unavailable with `恢复运行时`, and
  `继续` after interruption. Do not extend the Local card; extending the Stage 1 card is the fallback if a second card is refused.

## 7. Isolation and test substrate

Deterministic substitutes that exist:

- `createHindsightClient({ endpoint, resolveApiKey, transport })` with an in-memory transport (`hindsight-current-orchestrator.test.ts:18-28`);
  real bounded HTTP via `withHindsightHttpServer`/`withOpenHindsightResponse` (`core/testing/hindsight-http-test-fixture.ts`).
- `hindsightRuntimeFixture()` (`core/testing/hindsight-runtime-composition-fixtures.ts:41-82`): real SQLite, B3 rows, D77 app +
  native double (`runtimeClient` `:121-162`, routes: health/version/compat/recall + application methods), `compose()`/`subsystem()`.
  It seeds the Hindsight marker by SQL (`seedHindsightAuthority` `:91-108`) — unusable for C03's "no marker edits" journey, but its
  client double is the right injected `hindsight.client` for the post-COMMIT runtime.
- D78 wire builders: `currentStateFixture`, `currentSnapshotFixture`, `currentImportFixture`, `currentMaintenanceFixture`
  (`core/db/hindsight-current-fixtures.ts:31-167`) produce exact result/pages/certificate bodies from a prepared request.
- Real Local epoch through registered operations: `createLocalOnboardingHarness` (`core/memory/local-onboarding/local-onboarding-fixture.ts:36-77`),
  `createLegacyMigrationFixture`; real composition Legacy -> Local: `runtime-activation-failure.test.ts:30-64`.
- Models: `scriptedGenerateModel`/`failingGenerateModel` (`core/testing/mock-language-model.ts`); boot smoke pattern
  `.trellis/tasks/archive/2026-09/09-19-local-onboarding-operation/research/isolated-process-check.mjs`.

C03 journey (temp SQLite/files, zero real Hindsight, zero real model): compose with `hindsight: { source, secrets, client }`
where `client` is a transport double answering `/health`, `/version`, `/ext/taki-memory/version`, `PUT /v1/default/banks/{id}`,
`POST .../import?dry_run`, `GET .../export`, operation status, `POST .../snapshots` + pages, current-state transfers/result/
mappings and cutover verifications/verify/pages, computing bodies from the POSTed request with the D78 builders; onboard Local
(`local.onboard.prepare`/`activate`), retain through a captured Run with a scripted model, run `setup.validate` + `setup.apply`
through the owner, submit `hindsight.activate`, then assert marker/receipts/bank receipts, `operations() !== null`,
`memory.authority.status.runtime.available`, a captured Hindsight Run (application sync via the fixture app double), carried
witnesses, and call counts. Inject faults with `vi.spyOn` on `hindsight-authority-repo`/`hindsight-memory-subsystem` exports (the
`runtime-activation-failure.test.ts:16` pattern) for pre/post-COMMIT failure, reopen the DB with a new `bootId` for restart,
and drop the submit reply for the lost-reply case. Extend, do not duplicate: `memory-operation-kind-local.test.ts` ->
new `memory-operation-kind-hindsight.test.ts`; `runtime-activation-failure.test.ts` (Local -> Hindsight cases);
`runtime-selector.test.ts`; `runtime-composition.test.ts`; `hindsight-authority-repo.test.ts` (custody carry);
`primary-memory-custody-repo.test.ts` + `chat-agent-primary-custody.test.ts` (Hindsight-assigned finalize);
`memory-authority-status.test.ts`; Shared `memory-operation-schema.test.ts`; Desktop `memory-authority-state.test.ts`,
`memory-operations-controller.test.ts`, new card tests.

Not provable automatically (batch for the owner): native finite-maintenance semantics on a real PostgreSQL Hindsight (the
2026-09-10 D78 real-data run is separate evidence), model quality of the pre-capture drain, real endpoint/credential custody on
Windows, the chat pause/fenced-write experience during a real activation, and the Home path on a live session.

## 8. Recommended wave split and failure matrix

| Wave | Ownership (files) | Gate |
| --- | --- | --- |
| A — substrate + contracts | Shared: `memory-hindsight-operation-schema.ts` (kind/request/producer/result/error), `memory-activation-schema.ts` (status), `memory-operation-schema.ts` (enum + superRefine), `index.ts` (compact exports). Core: `memory/hindsight-activation/hindsight-activation-service.ts` (create/lease/drain/fence/capture/prepare/import/verify/markReady/promote with checkpoints, resume from persisted evidence), `memory/canonical-local-write-fence.ts` + `canonical-local-subsystem.ts`/`canonical-local-ingestion.ts` (`settle`, fence hooks), `db/hindsight-activation-custody.ts` (witness/cursor/group carry inside `promoteHindsightAuthority`), `db/primary-memory-custody-repo.ts` (provider-routed finalize, hindsight candidate), `db/hindsight-ingestion-source-repo.ts` (`previousCommit`), `testing/hindsight-activation-transport.ts` | service test drives the full chain on temp SQLite with the transport double; custody carry + fence tests green; no composition change yet |
| B — rebind + operation kind + boot | Core: `runtime-selector.ts` (`bindHindsight`, `recoverHindsight`, boot-unavailable for hindsight), `runtime-composition.ts` (`bindHindsight`, `recoverHindsightBinding`, marker-routed `recordPrimaryCommitted`, transition refusal in `captureRun`, `hindsightBindingSnapshot`), `operations/memory-operation-kind-hindsight.ts` + `memory-operation-kinds.ts` + evidence helper, `memory/hindsight-activation/hindsight-activation-status.ts`, `server/methods/memory-activation-methods.ts`, `operations/memory-authority-status.ts`, `main.ts` (service construction, family guard for setup RPCs, shutdown order), `hindsight-setup-service.ts` (`disable` authority check) | C03 journey test through registered operations incl. lost reply, restart both sides, bind failure, no redispatch; isolated boot smoke |
| C — Home | `ui/lib/ws-client-memory-operations.ts` (status method), `pages/operations/hindsight-activation-{card,state,actions}.ts(x)`, `use-hindsight-activation.ts`, `memory-operations-controller.ts` (generic submit), `memory-authority-state.ts` (labels), `operations-page.tsx`, `index.md` files | desktop tests + build; card renders every state from fixtures |

Failure matrix (condition -> required result):

| Condition | Required result |
| --- | --- |
| Marker not `canonical-local` (`new`/`resume`), or `recover` without a matching receipt | admission refusal `MEMORY_OPERATION_UNSUPPORTED`; no row |
| Setup phase != `configured`, null compatibility or fingerprint drift | admission refusal `MEMORY_OPERATION_UNSUPPORTED`; mid-run `failed/HINDSIGHT_CONNECTION_NOT_VERIFIED`, Local stays |
| Local Bank without a verified B3 row (or extra B3 row) | `completed/prerequisite_blocked` listing scopes, or refusal before capture; never `HINDSIGHT_BANKS_INCOMPLETE` after native writes |
| Active `hindsight-activation`, `setup` or `local-onboarding` row; direct `memory.hindsight.*` RPC during activation | `MEMORY_OPERATION_BUSY` + `activeOperationId` / `HINDSIGHT_STATE_CONFLICT` |
| Quiesce timeout | `failed/MEMORY_QUIESCENCE_TIMEOUT`; fence released only after positive Local marker check |
| Pending Local span cannot drain | `failed/MEMORY_INGESTION_INCOMPLETE`; retryable; Local intact |
| Coverage stale between capture and COMMIT | `failed/HINDSIGHT_LOCAL_COVERAGE_STALE`; `resume` recaptures explicitly; old evidence immutable |
| Non-empty target Bank / unsupported subtype | `failed/HINDSIGHT_CURRENT_TARGET_CONFLICT` or `_PREPARATION_GAPS` with gaps in result; nothing submitted |
| Native refusal (`target_conflict`, `ownership_drift`, …) | invalidation persisted; `failed/HINDSIGHT_CURRENT_NATIVE_REFUSED`; `resume` refuses that preparation |
| Lost import/verification response | `resume` replays the persisted result; exactly one native POST |
| Network/timeout/503/parse failure | `failed/HINDSIGHT_UNREACHABLE|HINDSIGHT_TIMEOUT|HINDSIGHT_RESPONSE_INVALID`; no drift observation |
| Verification candidate not complete | `failed/HINDSIGHT_CURRENT_VERIFICATION_INCOMPLETE`; `resume` advances the same candidate |
| `LEASE_LOST` | `failed/HINDSIGHT_CUTOVER_LEASE_LOST`; evidence preserved; no writes after loss |
| Restart before COMMIT | `outcome_unknown/producer_incomplete` + `resume`; Local boots normally; no auto-dispatch |
| COMMIT ok, bind fails | `failed/runtime_unavailable` with `binding_unavailable`; Local retired; `recover` repairs only |
| Restart after COMMIT | Hindsight selected; `observeBoot` reconstructs from receipt; never re-promotes |
| Marker `hindsight`, receipt/tx mismatch or unreadable | `outcome_unknown/commitment_unknown`; fail closed, no fallback |
| Duplicate submit / lost reply | `MEMORY_OPERATION_BUSY` / discovery via list; no resubmission |
| Cancel before claim / after claim / terminal | `cancelled_before_claim` / `MEMORY_OPERATION_RUNNING` / `MEMORY_OPERATION_SETTLED` |
| Chat turn during the interval | Run admitted; Local memory writes return structured `MEMORY_AUTHORITY_FENCED`; primary commit durably witnessed and carried at COMMIT |
| Shutdown during activation | no new claim; stop at a Bank boundary with `HINDSIGHT_ACTIVATION_INTERRUPTED`; never inside COMMIT; resumable |

## Caveats / Not found

- No test, build or process was run; line numbers are from the working tree at `d6278e3`.
- The native side was read from `H:/hindsight/TAKI_PATCHES.md:314-366` only; routes match `hindsight-current-client.ts`.
- `hindsight_cutover_runs` lease TTL and owner stability (G9) are open engineering choices; B2's 600 s + renewal is the precedent.
- A drain of pending Local spans requires model calls in production; in tests a scripted gate (`skip`) keeps it deterministic.
- Genuine product choice (not decided by source): during the interval, keep chat usable with memory writes fenced (§2 carry
  design, recommended) versus refuse new Runs until COMMIT (simpler, blocks chat for minutes on real Banks).
