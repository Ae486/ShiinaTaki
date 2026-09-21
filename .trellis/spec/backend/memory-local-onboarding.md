# Local Onboarding: B2 Candidate, Primary Custody and Runtime Binding

## 1. Scope / Trigger

Use this contract when a workspace moves from Legacy markdown (or an empty workspace) to Canonical Local through the
durable operations `local.onboard.prepare` / `local.onboard.activate`, or when Chat persistence, source flush,
candidate replacement or Local runtime construction touches the state those operations depend on. It covers the B2
producer (`core/memory/legacy-migration/`), the Local onboarding service (`core/memory/local-onboarding/`), trusted
primary custody (`core/db/primary-memory-custody-repo.ts` + `core/agents/primary-persistence.ts`) and the single
published Local runtime binding (`core/memory/local-runtime-binding.ts`). Hindsight activation, provider switching,
remote administration and vectors are out of scope. Operation lifecycle rules live in
[`memory-operations.md`](./memory-operations.md).

## 2. Signatures

Shared: `packages/shared/src/memory-local-operation-schema.ts`, `memory-local-onboarding-schema.ts`.

```ts
MEMORY_ONBOARDING_METHODS = { preview: "memory.onboarding.preview", status: "memory.onboarding.status",
  exceptions: "memory.onboarding.exceptions", exclude: "memory.onboarding.exclude",
  subscribe: "memory.onboarding.subscribe", changed: "memory.onboarding.changed" };
// prepare source: { mode: "new", previewId, replaceRunId? } | { mode: "resume", runId } | { mode: "retry", operationId }
// activate: { runId }; results: source_blocked | ready | activated | binding_unavailable
MemoryLocalErrorCode = "MIGRATION_NOT_FOUND" | "MIGRATION_BUSY" | "MIGRATION_NOT_READY" | "MIGRATION_SUPERSEDED"
  | "MIGRATION_CANDIDATE_CONFLICT" | "MIGRATION_EXCLUSION_CONFLICT" | "MIGRATION_SOURCE_RESOLVED" | "SNAPSHOT_CHANGED"
  | "INTEGRITY_MISMATCH" | "IMPORT_CONFLICT" | "MEMORY_AUTHORITY_MISMATCH" | "MEMORY_RUNTIME_UNAVAILABLE"
  | "MEMORY_INGESTION_SOURCE_UNPROVEN" | "MIGRATION_PRODUCER_RUNNING" | "MIGRATION_INTERRUPTED" | "MIGRATION_INTERNAL_ERROR";
MemoryOnboardingChanged = { reason: "producer" | "exclusion" | "candidate" | "binding" };
```

Core: `createLegacyMigrationRunner({ db, destinationRoot, fence, now?, onActivated?, reconcileCustody? })` ->
`{ dryRun, preview, prepare, resumePreparation, status, verify, exceptions, exclude, activate }`;
`createLocalOnboardingService(...)` is the only caller of runner mutations; `readLocalOnboardingStatus(...)` derives
`MemoryOnboardingStatus` (server-derived `actions`); `createPrimaryMemoryCustody({ db, bootId, now })` ->
`{ begin, reconcile, status }` and `assignPrimaryCandidate(db, { epoch, previousEpoch, now })`;
`createPrimaryPersistence(...)` -> `begin({ characterId, runId }) -> { writer, finalize }`;
`createLocalRuntimeBinding({ db, construct, logger })` publishes one binding and exposes a pure `snapshot()`;
`composeMemoryRuntime({ ..., bootId })` exposes `custody`, `bindingSnapshot()`, `recoverLocalBinding(epochId)`.
Storage: migration 049 `memory_migration_candidates`, `memory_migration_block_plans`, `memory_migration_source_proofs`,
`primary_memory_groups`, `primary_memory_members` (all STRICT, additive; 021/048 untouched).

## 3. Contracts

### B2 producer and candidate isolation

- The snapshot bytes/manifest are published atomically before the run row; `readLegacySnapshot(directory, expectedId)`
  validates reused files instead of trusting the directory. Run + COMPLETE manifest inventory + Banks + custody
  assignment are inserted in one transaction before any conversion (`publishMigrationCandidate`). Resume fills a lost
  inventory row and refuses a contradicting one (`INTEGRITY_MISMATCH`).
- Each source's canonical import, result rows and success disposition commit in one synchronous transaction; failure
  evidence is written after rollback. Conversion yields per source (`setImmediate`), renews the lease with the live clock,
  honours `stopRequested` between sources (run stays resumable) and releases the lease in `finally`.
- `verify` is pure: it proves manifest membership, raw hashes, exact result identities and Block-plan closure, detecting
  missing AND extra candidate effects. A completed run is never rewritten to ready. Activation republishes a fresh proof
  before it may refuse, so stale readiness is retracted rather than trusted.
- Replacement (`new` + `replaceRunId`) is one transaction: Legacy marker check, previous run -> `failed` + superseded
  candidate row, previous epoch closed, new isolated epoch/run/inventory, custody transferred. `memory_authority_selection`
  is never touched; every mutation on a superseded run refuses `MIGRATION_SUPERSEDED`. A pre-S2a raw run that published
  global Blocks refuses replacement with `INTEGRITY_MISMATCH` — shared Blocks are never disposable candidate state.
- Blocks are staged per run/source and published only inside the activation transaction under exact revision/content
  checks (`IMPORT_CONFLICT` on drift); existing Blocks are preserved, never deleted or overwritten.
- Exclusion is admissible only for unresolved sources without committed import effects, idempotent on the exact
  receipt, `MIGRATION_EXCLUSION_CONFLICT` on a changed audit identity, and invalidates readiness.

### Trusted primary custody

- A group is opened before the first primary append of a turn; append and member registration share the same
  synchronous transaction; callbacks fire after commit. Group creation runs under Legacy and Hindsight authority too
  (unassigned header-only groups, closed without witness writes) so the first candidate can adopt in-flight work.
- Finalize happens once per turn (`runTurn` finally): exact membership validated, `max(seq)` fixed, whole-group
  witnesses and the finalized header written together. Zero-member terminal groups close `closed-empty`. Silent
  cancellation retracts user/members/group atomically; overflow retry reuses the open group.
- Candidate publication/replacement adopts open and finalized-but-unconsumed groups atomically and refuses
  (`MIGRATION_CANDIDATE_CONFLICT`) when consumption is proven and cannot move. Dead groups (other `bootId`) are reconciled
  explicitly by prepare-resume / activation / binding recovery, never replayed; an active producer stays RUNNING.
- Source flush refuses retirement while an open group has members at or below the target (`assertNoOpenCustody`),
  including pre-baseline members and assistant-only gaps.

### One published runtime binding and recovery

- Local runtime: draft -> install -> publish -> start; any failure disposes the draft and records
  `{ kind: "unavailable", epochId, code }`; flush resolves from `current()` per call and returns a structured
  `MEMORY_FLUSH_FAILED` instead of crashing compaction; there is no `scope.canonical` side channel.
- `recoverLocalBinding(epochId)` requires the exact committed receipt (`verifyCanonicalLocalReceipt` joins marker, run,
  snapshot, epoch and transaction; mode alone is not proof), reconciles custody first, no-ops construction when the same
  epoch is healthy and never creates an epoch or activates again. Corrupt marker/receipt state fails closed — no Legacy.
- Pre-commit activation failure reopens Legacy only on positive marker evidence. `activate` on an already committed exact
  run repairs the binding only; a repair failure settles `failed` with its closed code and is never hidden.
- `bindingSnapshot()` is pure (selected epoch, published engine/flush/lifetime) and feeds both
  `memory.onboarding.status` and `memory.authority.status`; it never calls `captureRun` or creates Banks.

### Operator surface

- All methods are operator-only and use the authenticated actor and the Core workspace root; clients never pass
  paths. `preview({})` creates no run; `status({})` discovers the selected/latest run including pre-S2a raw runs;
  `exceptions` is bounded to 100; `exclude` is a synchronous transaction under the family/lease guard.
- `changed` is a strict invalidation (`producer | exclusion | candidate | binding`) after durable checkpoints only;
  subscription is connection-scoped and idempotent. Shutdown order: onboarding stop (no new claims, checkpoint) ->
  memory runtime stop -> operations stop.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| prepare with a preview id that no longer matches the live workspace | `SNAPSHOT_CHANGED`; no run created |
| replacement without `replaceRunId`, or against a completed/leased run | `MIGRATION_CANDIDATE_CONFLICT` |
| any mutation on a superseded run | `MIGRATION_SUPERSEDED` |
| inventory row contradicting the manifest / tampered snapshot | `INTEGRITY_MISMATCH` |
| verify on a run missing or carrying extra candidate effects | `verified=false`; readiness retracted |
| shared Block drifted between staging and activation | `IMPORT_CONFLICT`; whole commit refused |
| exclusion of a resolved / committed-effect source | `MIGRATION_SOURCE_RESOLVED` / refused; readiness untouched |
| shutdown during conversion | `MIGRATION_INTERRUPTED` between sources; run resumable via `resume` |
| Local subsystem constructor throws after COMMIT | binding `unavailable`; result `binding_unavailable`; Local stays selected |
| repair with a hand-set marker and no receipt | `MEMORY_INTEGRITY_ERROR`; no construction |
| flush at/below an open group's member seq | `MEMORY_INGESTION_INCOMPLETE` |
| relocating a group whose consumption is proven | `MIGRATION_CANDIDATE_CONFLICT`; replacement refused |

## 5. Good / Base / Bad Cases

- Good: empty workspace -> `preview` -> `prepare` (`ready`) -> `activate` (`activated`, runtime available) -> reopen shows
  the same receipt and `actions.prepare=false`; a second `activate` repairs only.
- Base: a legacy workspace with an unsupported source settles `completed` / `source_blocked`; the operator excludes it,
  resumes the same run, then activates. Nothing is re-snapshotted.
- Bad: appending a new snapshot's effects into the old candidate epoch; deleting Blocks to close a candidate; settling
  `activated` from the binding snapshot after a swallowed repair error; raising test timeouts to hide load flakes.

## 6. Tests Required

- Core db/migrations: 049 fresh/upgrade lineage; custody repo begin/append/finalize/retract, relocation refusal, flush
  refusal (`primary-memory-custody-repo.test.ts`).
- Core legacy-migration: candidate repo (inventory-before-conversion, resume fill, contradiction, replacement, marker
  untouched, raw-run Blocks refusal), source stage atomicity, exclusion matrix, runner stale preview / missing+extra
  effects / completed immutability, snapshot tamper.
- Core runtime: binding publication failures and unavailable boot (`local-runtime-binding.test.ts`), activation failure
  before/after COMMIT and a usable Local runtime after activation and reopen with zero model calls
  (`runtime-activation-failure.test.ts`), chat custody (`chat-agent-primary-custody.test.ts`).
- Core operations/service/methods: `memory-operation-kind-local.test.ts`, `local-onboarding-service.test.ts`,
  `local-onboarding-reads.test.ts`, `memory-onboarding-methods.test.ts`, `memory-migration.test.ts` refusals.
- Isolated Core boot (`research/isolated-process-check.mjs` pattern): temp data dir, non-default port, migrations through
  049, preview/prepare/activate/repair, reopen with the same receipt, zero external fetches, clean SIGINT exit.

## 7. Wrong vs Correct

Wrong: hide a repair failure and settle from the binding snapshot.

```ts
try { await runtime.recoverLocalBinding(epochId); } catch { /* ignore */ }
return settleFromSnapshot(runtime.bindingSnapshot());
```

Correct: a repair failure is a terminal outcome with its closed code; the snapshot only classifies success.

```ts
try { await runtime.recoverLocalBinding(epochId); }
catch (error) { return repairFailure(error, runtime.bindingSnapshot()); }
return activated(runtime.bindingSnapshot());
```
