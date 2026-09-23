# Stage 2b Design: First Hindsight Activation

Date: 2026-09-23. Requirements: [prd.md](prd.md). Grounding: [research/stage2b-seams.md](research/stage2b-seams.md)
(§1 primitives, §2 custody, §3 fence, §4 surface, §5 recovery, §8 matrix — all `file:line` references live there).
Decisions: [grill.md](grill.md). Stage 2a patterns are reused, not re-derived
(`.trellis/spec/backend/memory-local-onboarding.md`, `memory-operations.md`).

## 1. Shape

One coordinator, `core/memory/hindsight-activation/hindsight-activation-service.ts`, is the only caller of the B4/D78
mutation primitives in production. It owns no timers and no second outcome ledger: durable truth is
`hindsight_cutover_runs` + D78 evidence tables + the promotion receipt; the operation row carries only the producer
reference and checkpoints. The kind handler (`operations/memory-operation-kind-hindsight.ts`) is a thin settlement
layer over the service, exactly like `memory-operation-kind-local.ts` over the Local service.

## 2. Contracts (Shared, additive)

- `memory-hindsight-operation-schema.ts`: request `{ kind: "hindsight.activate", source: { mode: "new", setupRevision,
  expectedEpochId } | { mode: "resume", runId } | { mode: "recover", epochId } }`; producer ref `{ kind: "hindsight",
  runId, hindsightEpochId, transactionId, configFingerprint, manifestId | null, progress: { phase, bankCount,
  preparedBankCount, importedBankCount, verifiedBankCount, carriedWitnessCount }, banks: [{ nativeBankId, scope,
  replicaEpochId, verificationId, preparationId | null }] }` with phases `reserved | draining | capturing | preparing |
  importing | verifying | ready | committing | binding | completed`; result `{ kind: "hindsight", runId, outcome:
  "activated" | "binding_unavailable" | "prerequisite_blocked", epochId | null, runtimeAvailable, blocking: [...] }`;
  closed `MemoryHindsightActivationErrorCode` (research §4 list). `memory-operation-schema.ts`: kind enum + `hindsight.`
  prefix in the producer/result `superRefine`; error-code union gains the new enum. No new reasons or refusal codes.
- `memory-activation-schema.ts`: `MEMORY_ACTIVATION_METHODS = { status: "memory.activation.status" }`, strict empty
  params, `MemoryActivationStatusSchema` (research §4 shape) with a `superRefine` tying `actions` to `run`/`authority`.
- `index.ts`: compact named re-exports (one statement per file); stay under the 500-line rule.

## 3. Wave A — substrate: fence, drain, service, custody carry

- **Local write fence** `core/memory/canonical-local-write-fence.ts`: same shape as `MemoryAuthorityFence` but
  write-only (`admit`/`quiesce`/`retire`, structured `MEMORY_AUTHORITY_FENCED`). Installed by the Local subsystem draft
  and threaded into: provider mutations (retain/edit/invalidate/restore/copy/policy), `writeEntry`, `maintenance.run`,
  `tidy.maybeRun/runNow`, background tools, `retentionSweep.enabled()`, `flushPort.prepareRetirement`
  (`retryable_failure`/`MEMORY_AUTHORITY_FENCED`), custody baseline init. `assemble`/recall/`createTools` reads untouched.
  `CanonicalLocalIngestion` gains `settle()` (mirror `createHindsightIngestionLifetime`). Block `replace` gains the
  active-epoch guard.
- **Service** `createHindsightActivationService({ db, client, setup, localRuntime, custody, now?, logger })` ->
  `{ start, resume, recover?, status }` (recover is wave B when it needs the composition):
  `start` = checkpoint(draining) -> fence.quiesce -> `autoMemory.settle()`/ingestion settle -> forced ingestion for
  Characters with pending spans or unprocessed witnesses -> `create` cutover run (run id = B2 run id) + lease (owner
  `hindsight-activation:<operationId>`, 600 s, renewed per Bank boundary and native call) -> `captureCoverage` +
  `captureHindsightCurrentLocal` -> per Bank: `fetchHindsightCurrentBaseline` -> `prepareHindsightCurrentBank` ->
  `importHindsightCurrentBank` -> `verifyHindsightCurrentBank` (checkpoint after each) -> `markReady` -> promotion
  (below) -> return the receipt. `resume` re-fences, `assertCurrent` on the selected manifest, recaptures explicitly when
  stale, skips Banks with persisted evidence (the D78 orchestrator already replays persisted results), and takes over a
  lease whose holder operation is terminal or foreign-boot. `stopRequested` is honoured at Bank boundaries
  (`HINDSIGHT_ACTIVATION_INTERRUPTED`), never inside promotion.
- **Promotion + PR03 carry** `core/db/hindsight-activation-custody.ts` called inside the `promoteHindsightAuthority`
  transaction (extend the repo with a `beforeCommit` hook rather than copying its body): refuse any predecessor Local span
  not `complete` (`MEMORY_INGESTION_INCOMPLETE`); copy unconsumed `canonical_memory_primary_commits` rows into
  `hindsight_ingestion_primary_commits` for the new epoch; insert per-Character `hindsight_ingestion_cursors`
  (`through_seq=0`, `eligibility_start_seq=tail+1`); reassign `open`/`finalized` groups of the predecessor to the new epoch.
  `primary-memory-custody-repo.ts`: `currentLocalCandidate` returns the Hindsight epoch under marker `hindsight`;
  `finalize` routes witnesses by the assigned epoch's provider; `hindsight-ingestion-source-repo.previousCommit` checks a
  same-epoch Hindsight prior before the Local prior. If a new column is needed, add migration 050 (never edit 049).
- **Reopen rule**: pre-COMMIT failure releases the fence only after a positive `mode === "canonical-local" &&
  epochId === predecessor` read (mirror `retireUnlessLegacy`); on COMMIT the fence is retired irrevocably.
- **Test double** `core/testing/hindsight-activation-transport.ts`: in-memory transport for health/version/compat, Bank
  PUT/import dry-run/export, snapshots + pages, current-state transfers/result/mappings, cutover verifications, computing
  bodies from the POSTed request with the D78 builders; counts calls and can fail any route once.
- Gate: a service test drives the full chain on temp SQLite through the double with fault injection per matrix row
  (pre-COMMIT), plus fence and custody-carry tests. Composition and the operation kind are untouched in wave A.

## 4. Wave B — rebind, operation kind, status, wiring

- `runtime-selector.ts`: `bindHindsight(epochId)` / `recoverHindsight(epochId)` and a boot-unavailable path for a
  selected-but-unconstructible Hindsight runtime (observable unavailable state, Core keeps serving). `runtime-composition.ts`:
  `bindHindsight` (draft -> install -> publish -> start, mirror `local-runtime-binding.ts`; on failure dispose and record
  `unavailable`), `recoverHindsightBinding`, `hindsightBindingSnapshot()`, marker-routed `recordPrimaryCommitted`
  (marker `hindsight` -> direct repo write, subsystem-independent), and a `captureRun` refusal (`MEMORY_RUNTIME_UNAVAILABLE`
  structured) when the marker is `hindsight` and no binding is published. Retire Local on COMMIT: fence retire,
  `local.stop()`, selector swap; no automatic reopen.
- Kind handler `memory-operation-kind-hindsight.ts` + evidence helper: admission per PRD R2 (uses `repo.activeInFamily`
  for the three families, `verifyCanonicalLocalReceipt`, `readHindsightLocalBankBinding`), macrotask `tryClaim`,
  checkpoints from service progress, settlement from the receipt/binding snapshot (`activated` | `binding_unavailable`
  as `failed/runtime_unavailable` | `prerequisite_blocked` as `completed`), `observeBoot` from
  `hindsight_authority_activation_receipts` + marker (research §4), pre-claim cancel only. Setup kinds' admission refuses
  while an activation row is open; `memory.hindsight.validate/setup/disable` refuse `HINDSIGHT_STATE_CONFLICT` likewise
  and `disable` refuses under marker `hindsight`.
- Read `memory/hindsight-activation/hindsight-activation-status.ts` -> `readHindsightActivationStatus` and
  `server/methods/memory-activation-methods.ts` (operator-only, deadline interactive); `memory-authority-status.ts`
  consumes the Hindsight binding snapshot so `runtime` is truthful before bind.
- `main.ts`: construct the service with the production client factory, register the kind and method, shutdown order
  activation stop (no new claims, Bank-boundary checkpoint) -> memory runtime stop -> operations stop. Keep the edit to
  wiring lines; logic lives in the new modules.
- Gate: the C03 journey through registered operations on temp SQLite (`local-onboarding-fixture` for the Local epoch,
  the transport double, scripted models) including lost reply, restart on both sides of COMMIT (new `bootId`), bind
  failure + recover, no redispatch; isolated boot smoke with the kind registered.

## 5. Wave C — Home

- `ui/lib/ws-client-memory-operations.ts`: add the `memory.activation.status` method; `memory-operations-controller.ts`:
  generic `submit(request, key)`; `memory-authority-state.ts`: labels for the new kind.
- New `pages/operations/hindsight-activation-{card,state,actions}.ts(x)` + `use-hindsight-activation.ts`, mounted on the
  Operations page; refetch on `memory.operations.changed`, reconnect, remount, visibility; Core-derived actions only;
  accepted vs completed rendered distinctly; receipt hashes in diagnostics. Local and Stage 1 cards unchanged.
- Gate: Desktop tests (card states from fixtures, controller submit/race/timeout) + build.

## 6. Rollback / stop points

Additive at rest. Before COMMIT, Local remains selected and a code rollback leaves only additive rows/evidence; after
COMMIT, never edit markers or delete receipts — recovery uses the committed identity. No live data, real Hindsight or
model call is part of automated verification. A new unresolved product constraint is recorded with scenario and
recommendation before asking; routine technical findings are resolved from source within these contracts.
