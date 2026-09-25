# Research: Stage 3 seams (backup, restore, common recovery point)

- **Query**: Where Stage 3 (PR01 capture boundary, PR02 administration path, C10 inventory, isolated restore, emergency
  rule, credential custody) attaches to native Hindsight and Taki Core; the gaps; the proposed contracts and waves.
- **Scope**: mixed (Taki source, `H:/hindsight` native source read-only, Node 24 `node:sqlite` docs)
- **Date**: 2026-09-26
- **Rules honoured**: nothing was executed against any database, Hindsight or model; source reading only.

Paths below: `core/` = `packages/core/src/`, `native/` = `H:/hindsight/hindsight-api-slim/hindsight_api/`.

---

## §1 Current state

### 1.1 Native (Hindsight fork)

| Fact | Evidence |
| --- | --- |
| Whole-database backup exists only as a CLI (`hindsight-admin backup <zip> [--schema]`). It needs `HINDSIGHT_API_DATABASE_URL` from the environment; it refuses without it. | `native/admin/cli.py:439-466` (DB URL check `:445-450`) |
| `_backup` opens its **own** `asyncpg.connect`, runs every `COPY ... TO` (binary) inside one `REPEATABLE READ` transaction, so all 43+ tables come from one snapshot. No lock is taken; the API and workers keep writing. Row counts are read inside the same transaction. `manifest.json` is written last. | `cli.py:283-348` (transaction `:305-309`, manifest `:298-303`, count `:335`, manifest write `:344`) |
| Manifest v2 = `{version:"2", created_at, schema, tables:{<t>:{rows,size_bytes,columns[{name,type_name}]}}}`. **No** provider lineage, Bank generations, cursors, build id, alembic revision or hash. | `cli.py:96`, `:298-303`, `:336-340` |
| Table list `BACKUP_TABLES` (43 tables, FK order) covers core memory data, replication (`replication_provider_lineage`, `replication_bank_state`, `replication_logical_changes`, snapshots), receipts (`memory_native_operation_receipts`, `memory_retain_part_receipts`, `memory_mutation_receipts`), transfer/cutover tables, `async_operations`, `webhooks`, `audit_log`, `llm_requests`, and all D77 application tables (`memory_application_banks/bodies/body_parts/native_heads/artifacts/changes/operations/snapshots`). Tenant extension tables are appended. Native test asserts the list covers the whole schema except `alembic_version` and `bank_stats_cache`. | `cli.py:39-94`, `:244-262`; `tests/test_admin_backup_restore.py:67` |
| Restore (`hindsight-admin restore <zip> [--schema] [--yes]`) checks manifest version, validates column shapes **before** touching data (`format_type` exact match; dropped columns stripped; mismatch fatal), then in one transaction TRUNCATEs every table (reverse order, CASCADE) and COPYs forward, then `REFRESH MATERIALIZED VIEW memory_units_bm25`. It creates no tables and runs no migration: the target schema must already be migrated to a compatible head. `alembic_version` is not in the ZIP. | `cli.py:351-416`, `_validate_restore_schema :194-241`, dropped-column strip `:128-174`, CLI warning `:468-494` |
| After a logical restore, per-Bank vector indexes are absent: `repair-bank --all` rebuilds them. | `cli.py:669-751` (`:694-704`) |
| `async_operations` rows restored in `processing` belong to a foreign worker id; a worker reclaims only its own id at start, so they stay stuck until `decommission-workers`. | `native/worker/poller.py:885-1008`; `cli.py:903-1001` |
| `run-db-migration --schema` prepares an empty isolated schema. | `cli.py:572-623` |
| `export-bank` / `import-bank` exist but are per-Bank, without embeddings, and import requires a non-existent Bank: not a whole-state backup. | `cli.py:776-875` |
| HTTP: no whole-database backup/restore endpoint. Taki routers mount at `/ext/taki-memory` (`taki_memory`, `current_state_transfer`, `cutover_verification`), plus one optional `http_extension` at `/ext`. Other export-like routes are per-Bank (`/banks/{id}/import|export` templates, `/document-transfer`, knowledge-base export) and Bank DELETE. | `native/api/http.py:3670-3691`, `:6553-6716`, `:6726`, `:6786`, `:5305` |
| Identity: singleton `provider_lineage`; per Bank `bank_generation`, `current_cursor`, `minimum_available_cursor`; deleting a Bank mints a new generation. `/changes` refuses `cursor_ahead` (after_cursor > current_cursor) and `cursor_expired` with HTTP 409. | `native/engine/replication.py:217-284`, `:303-314`, `:338-356`, `:1158-1190` |
| Application state is namespaced by `(provider_lineage, bank_id, bank_generation)` with checkpoint `(native_cursor, state_cursor)` and an incarnation check. | `native/engine/application_state/store.py:43`, `:104-111`, `:136-180` |
| Compatibility manifest carries `source_identity.upstream_commit`, `compatibility_build`, `provider.lineage`, `database_dialect`, contracts. | `native/engine/taki_compatibility.py:60-138` |
| Auth: `ApiKeyTenantExtension` = one `HINDSIGHT_API_TENANT_API_KEY` over one schema (full tenant access, already incl. Bank DELETE); `DefaultTenantExtension` = no auth. No per-route admin scope exists. | `native/extensions/builtin/tenant.py`; `native/api/dependencies.py:18-33` |
| The ZIP carries native-side secrets and sensitive text: `webhooks.secret TEXT`, `llm_requests` (prompts), `audit_log`. | `native/alembic/versions/e4f5a6b7c8d9_add_webhooks_tables.py:37` |
| Native tests already run backup/restore against embedded PostgreSQL (`pg0_db_url` fixture, fresh migrated schema). | `tests/conftest.py:150`; `tests/test_admin_backup_restore.py:28` |

### 1.2 Taki Core

| Fact | Evidence |
| --- | --- |
| One SQLite file `join(dataDir,"taki.db")`, WAL + foreign_keys; `dataDir` defaults to `join(homedir(),".takiagent")`. `db/sqlite.ts` is the only `node:sqlite` importer; its `Database` wrapper exposes `exec/prepare/transaction/close` only (no backup, no raw `DatabaseSync`). | `core/boot/core-bootstrap.ts:51-66`; `core/config/server-config.ts:32`; `core/db/sqlite.ts` |
| No backup code, no backup operation kind, no backup family, no backup status anywhere in Core or Shared. | Grep `backup` in `core/memory/operations/`, `packages/shared/src/memory-operation-schema.ts` (only `SecretCatalogService.backup`, see G9) |
| Operation owner: kinds registry `MEMORY_OPERATION_KINDS` (8 kinds); `EXCLUSIVE_MEMORY_FAMILIES = ["setup","local-onboarding","hindsight-activation","hindsight-lifecycle"]` + `refuseWhileExclusiveFamilyBusy`; `memory_operations` has no CHECK on `kind` (new kinds need no migration) and a partial unique index per family while non-terminal. | `core/memory/operations/memory-operation-kinds.ts:20-29`; `memory-operation-contract.ts:51-57`, `:85-96`; `core/db/migrations/048-memory-operations.ts` |
| Writes under Hindsight authority are intent-first: the parent write journal (`hindsight_memory_write_intents`, 047) persists an intent before native I/O (`prepare` `:54-70`), CAS on revision (`:71-82`), `pending()` by epoch/Bank/lineage/generation (`:83-92`). Terminal success is recorded only after the native job is terminal. | `core/db/hindsight-memory-write-repo.ts`; `core/memory/hindsight/hindsight-memory-write-result.ts:32-39`, child link `:13-19` |
| Exception: the observed writer calls `provider.retain` directly with `requestId: observed:${randomUUID()}` and no Core intent row; reflect also mints a random id. Ingestion ids are deterministic. | `core/memory/hindsight/hindsight-observed-write.ts:23-24`; `hindsight-memory-reflect.ts:35`; `hindsight-ingestion-contract.ts:55` |
| Writer surfaces under Hindsight authority: engine tools, `writeMemory` (observed), `maintenance.run` (ingestion, tidy/curator), `memoryFlush`, `tidy`, the Pending recovery runner (scheduler-driven native replays), `recordPrimaryCommitted`. | `core/memory/hindsight/hindsight-memory-subsystem.ts`; `hindsight-runtime-state.ts:50-61` |
| `stopSubsystem` is one-shot and abort-based; it is not a pause. | `hindsight-memory-subsystem.ts:141-150` |
| Replica scheduler `start()` is re-callable, `stop()` cancels the active run (aborts transport); `tick()` awaits a run. | `core/memory/hindsight/hindsight-replica-scheduler.ts:65-82` |
| Canonical write fence is generic (`admit`, `admitSync`, `quiesce({timeoutMs})` -> `MEMORY_QUIESCENCE_TIMEOUT`, `release`, `retire`), but it is applied only to **Local** writers. | `core/memory/canonical-local-write-fence.ts`; `core/memory/canonical-local-writers.ts` (`FENCED_TOOL_RESULT`, read tools stay open) |
| Runtime binding: `publish/replace/start/current/snapshot/stop` (`stopped` permanent). Unbound for any reason outside `DISABLED_CODES` makes chat refuse `MEMORY_RUNTIME_UNAVAILABLE`, so unbinding is not an acceptable backup pause. | `core/memory/hindsight-runtime-binding.ts`; `core/memory/hindsight-unbound-run.ts` |
| Every 409 on `/changes` or `/snapshots` becomes `HINDSIGHT_CURSOR_RESET_REQUIRED` (response body reason not read) and the replica rebuilds. | `core/memory/hindsight/hindsight-client.ts:279-291` (`:283`); `hindsight-replica-errors.ts:20-23`; Bank service rebuild `:126-153` |
| Core-side identity/proof already persisted: authority marker `memory_authority_selection` (mode, active_epoch_id, activation_transaction_id, provider_lineage_id, replica_checkpoint_digest) verified against activation receipts, cutover runs, authority state/epochs and Bank receipts; promotion input carries `configFingerprint`, `checkpointSetDigest`, per-Bank `{bankId, templateDigest, checkpoint}`. | `core/memory/legacy-migration/legacy-activation-repo.ts:17-44`; `core/db/hindsight-authority-repo.ts:1-40` |
| Replica checkpoints: B5 `readReplicaCheckpoint`; D77 `readApplicationCheckpoint` over `hindsight_application_replica_checkpoints` (bank_id, provider_lineage, bank_generation, application_id, authority_epoch_id, native_cursor, state_cursor, bank_deleted, checkpoint_hash). | `core/db/hindsight-replica-checkpoint-store.ts`; `core/db/hindsight-application-replica-checkpoint.ts:22-31` |
| Secrets: refs `HINDSIGHT_SECRET_REFS` (connection API key `memory.hindsight.connection.api-key` + model refs); connection marker = sha256 of `health:present:keyVersion:updatedAt`. Secret Catalog `<dataDir>/secret-catalog.bin`, encrypted, bound to `storeId`; `presence/list/backup()/restore(envelope)` implemented, `backup/restore` have no production caller. Master key via systemd credentials or `taki-secret-key` helper. | `core/memory/hindsight/hindsight-secret-refs.ts`; `core/secrets/secret-catalog-service.ts:40-93`; `.trellis/spec/backend/secret-catalog.md` |
| Rust Shell: capability registry = clipboard, exec, foreground_window, process_list, screenshot, shell_open; process spawn only in `exec/sandbox.rs:77` (strips API-key env). `taki-node` headless binary is `cfg(debug_assertions)` only. Core reaches it via `capabilities/capability-broker.ts:47-64` (`request(target,input,identity)`). | `apps/desktop/src-tauri/src/capabilities_impl.rs`; `apps/desktop/src-tauri/src/bin/` |

---

## §2 Primitives reusable as-is

1. **Native REPEATABLE READ snapshot `_backup`** (`cli.py:283-348`) and **validate-then-single-transaction `_restore`** (`cli.py:351-416`): the native half of the artifact and its restore; do not reimplement.
2. **Native isolated-target steps**: `run-db-migration --schema` (`cli.py:572-623`), `repair-bank --all` (`:669-751`), `decommission-workers` (`:903-1001`); pg0 fixture pattern (`tests/conftest.py:150`).
3. **Native idempotency on replay**: G1 native results `/ext/taki-memory/native-results/{kind}/{operation_id}` (`native/extensions/builtin/taki_memory.py:63-315`), native operation/mutation/retain-part receipts, application operation receipts `commits/{operation_id}` (`native/api/taki_application_state.py:107-353`).
4. **Core intent-first journal** (047 write intents, 035 Pending, ingestion spans/requests): gives the Core-first capture order its safety (§5.2).
5. **Operation owner**: kind handler contract, deferred claim via `tryClaim`, `checkpoint(progress)`, `observeBoot`, exclusive-family guard (`memory-operation-contract.ts:51-96`; spec `memory-operations.md` §2-§3).
6. **Generic fence** `createCanonicalLocalWriteFence` (`quiesce` with timeout, `release`) and the wrapper pattern of `fenceCanonicalLocalWriters` (`FENCED_TOOL_RESULT`, reads unfenced).
7. **Replica scheduler** `stop()`/`start()`/`tick()` (`hindsight-replica-scheduler.ts:65-82`).
8. **Identity readers**: `readMemoryAuthoritySelection`, `readApplicationCheckpoint`, `readReplicaCheckpoint`, native `/version` compatibility manifest, native `/changes` identity fields.
9. **Secret presence**: `SecretCatalogService.presence/list`, `createHindsightConnectionSecret` marker (records custody without values).
10. **`node:sqlite` `backup(sourceDb, path, options)`** (Node >= 23.8, pinned Node 24): online page copy, returns `Promise<number>` pages; writes from the same connection during the copy are reflected, so the result is consistent as of completion; rowids are preserved (page copy). Source: nodejs.org/api/sqlite.html `sqlite.backup`.
11. **Native-smoke harness** (sibling task `09-25-hindsight-native-smoke`): throwaway native on pg0 in a temp dir, mock LLM, non-default ports, throwaway key; the environment-evidence carrier for Stage 3.

---

## §3 Gaps

| Id | Gap | Evidence | Needed |
| --- | --- | --- | --- |
| G1 | No write pause under Hindsight authority. The fence wraps Local writers only; `stopSubsystem` is permanent; unbinding makes chat refuse. | `canonical-local-writers.ts`; `hindsight-memory-subsystem.ts:141-150`; `hindsight-unbound-run.ts` | `fenceHindsightWriters` reusing the generic fence (§5.3). |
| G2 | No Core SQLite capture primitive. `Database` hides `DatabaseSync`. | `core/db/sqlite.ts` | `Database.backupTo(path)` via `node:sqlite` `backup()` (§5.4). |
| G3 | Native manifest has no identity/proof; no Taki artifact manifest; no pair verifier. | `cli.py:298-303` | Taki pair manifest + verifier (§5.5, §5.6). |
| G4 | No executable invocation route. CLI needs a DB URL (`cli.py:445-450`); no HTTP backup; Shell has no Hindsight capability and no release-mode headless Node. | `cli.py:439-466`; `http.py:3670-3691`; `capabilities_impl.rs` | §6 route. |
| G5 | Rollback absorption: a native instance restored behind Core answers `cursor_ahead` (409); Core maps every 409 to `HINDSIGHT_CURSOR_RESET_REQUIRED` and rebuilds the replica, silently accepting lost native state. | `hindsight-client.ts:283`; `hindsight-replica-errors.ts:20-23`; `replication.py:1158-1190` | Parse the 409 reason; same lineage + same generation + `cursor_ahead` -> refuse `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`, no rebuild (§5.7). |
| G6 | No backup operation kind or family. | `memory-operation-kinds.ts:20-29`; `memory-operation-contract.ts:51` | Kinds `backup.capture`, `backup.admit`, `backup.verify`; family `hindsight-backup` added to `EXCLUSIVE_MEMORY_FAMILIES` (§5.1). |
| G7 | No "last verified full backup" record, backup age or missing interval in status. | `memory-authority-status.ts` (no backup section) | Status section (§5.8). |
| G8 | Restore target preparation is manual: migrate schema, restore, `repair-bank --all`, `decommission-workers`. None of it is expressible from Core. | `cli.py:572-623`, `:694-704`, `:903-1001`; `poller.py:885-1008` | Restore drill runbook + harness (§4, §8); production restore stays operator-run. |
| G9 | Credential custody is not recorded anywhere; `SecretCatalogService.backup()` exists but must **not** be used for this artifact (it would copy the encrypted envelope). | `secret-catalog-service.ts:40-93` | Custody record of presence only (§5.9). |
| G10 | D86 (Local Bank id scheme, "a restore must name the same Bank") and D88 (`target_conflict` remedy, whole-Bank reset) are retargeted to this stage. | `docs/deferred-decisions.md` D86, D88 | D86: the verifier compares exact `nativeBankId` per scope/character (§5.6) -> closes the backup half. D88: whole-Bank reset stays Stage 5; Stage 3 only records that restore never resolves `target_conflict`. |
| G11 | Core-originated native writes without a Core intent (observed write, reflect random ids). Under Core-first order they can only make native a superset of Core, which replica catch-up absorbs; they do not break PR01. The pause (G1) still closes the window so Run/timeline records match. | `hindsight-observed-write.ts:23-24`; `hindsight-memory-reflect.ts:35` | Cover them in `fenceHindsightWriters`; no id change needed for Stage 3. |
| G12 | Artifact storage: nothing owns a backup directory, file mode, or retention; the native ZIP contains native secrets and prompts. | §1.1 `webhooks.secret`, `llm_requests` | Storage rules (§5.10). |

---

## §4 Failure matrix

Capture = `backup.capture`; Admit = `backup.admit` (route b or native-stored artifact); Verify = `backup.verify` (structural pair check + optional isolated read-back).

| Step | Failure | Required outcome |
| --- | --- | --- |
| Capture: admission | Another exclusive family open (setup, onboarding, activation, lifecycle, backup) | `MEMORY_OPERATION_BUSY` + active id; nothing paused |
| Capture: admission | Authority not Hindsight / runtime unavailable | `MEMORY_OPERATION_UNSUPPORTED` at admission (emergency uses §5.8 seal, not capture) |
| Capture: admission | Route not configured (no native backup endpoint, not opted in) | `failed` / `HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE`; nothing paused |
| Capture: pause | In-flight writes do not drain within the timeout | `failed` / `HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT`; fence released; no artifact |
| Capture: Core copy | `backup()` throws (disk full, I/O) | `failed` / `HINDSIGHT_BACKUP_CORE_CAPTURE_FAILED`; partial file deleted; fence released |
| Capture: native snapshot | Native refuses/unreachable/timeout | `failed` / `HINDSIGHT_BACKUP_NATIVE_FAILED`; Core copy deleted (an unpaired Core copy is never offered as a full backup) |
| Capture: native snapshot | Native proof lineage/generation differs from Core copy | `failed` / `HINDSIGHT_BACKUP_PAIR_MISMATCH`; both deleted |
| Capture: native snapshot | A native cursor < Core checkpoint cursor, or a Core terminal operation id missing from native receipts | `failed` / `HINDSIGHT_BACKUP_PAIR_MISMATCH` (this is the inter-capture/rollback case) |
| Capture: seal | Manifest write/hash fails | `failed` / `HINDSIGHT_BACKUP_STORAGE_FAILED`; artifact not listed |
| Capture: any | Core restart mid-capture | `observeBoot`: incomplete artifact dir -> `outcome_unknown` / `producer_incomplete`, dir quarantined, not listed; fence is in-memory so it is gone after restart |
| Capture: any | Fence release | Always in `finally`; writes resume; retryable tool results already returned during the pause |
| Admit | Hash/size mismatch, manifest schema invalid, manifest version != 2 | `failed` / `HINDSIGHT_BACKUP_ARTIFACT_INVALID` |
| Admit | Native proof absent (plain CLI ZIP without identity) | `failed` / `HINDSIGHT_BACKUP_PROOF_MISSING` unless the ZIP's own replication/application tables are parsed (§6 caveat) |
| Admit | Pair mismatch as above | `HINDSIGHT_BACKUP_PAIR_MISMATCH`; never listed as a verified backup |
| Verify / restore drill | Target is the live instance or the owner's data dir | Refused before start `HINDSIGHT_BACKUP_TARGET_NOT_ISOLATED` (target must be a fresh temp dir / fresh schema / non-default port) |
| Verify | Schema/column mismatch on native restore | Native `_restore` refuses before TRUNCATE (`cli.py:194-241`); report `HINDSIGHT_BACKUP_NATIVE_INCOMPATIBLE` |
| Verify | Read-back identity differs (lineage, Bank id, generation, cursor, epoch, marker digest) | `failed` / `HINDSIGHT_BACKUP_READBACK_MISMATCH` |
| Verify | Missing credential in the isolated target | explicit `HINDSIGHT_BACKUP_CREDENTIAL_MISSING` naming the secret ref; never silently continue unauthenticated |
| Resume after restore | Pending intent whose native effect is in the snapshot | Re-dispatch finds the native receipt / G1 result; no second native effect |
| Resume after restore | Pending intent whose native effect is not in the snapshot | Re-dispatch applies it once (same operation id) |
| Resume after restore | Foreign-worker `async_operations` stuck `processing` | `decommission-workers` in the drill; otherwise status shows stuck native work |
| Runtime after a non-paired native restore | `/changes` 409 `cursor_ahead` with same lineage + generation | Refuse `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`; no replica rebuild; status names it |
| Emergency (provider down) | Any | Never gated on a fresh backup; seal Core evidence (§5.8) |

---

## §5 Proposed contracts

### 5.1 Operation kinds (Shared `memory-operation-schema.ts`, Core `core/memory/operations/`)

| Kind | Producer/result kind | Family | Notes |
| --- | --- | --- | --- |
| `backup.capture` | `backup` | `hindsight-backup` | Operator only. Pause -> Core copy -> native snapshot -> pair check -> seal -> release. |
| `backup.admit` | `backup` | `hindsight-backup` | Admit an externally produced native artifact (route b) or re-verify a native-stored one (route c). |
| `backup.verify` | `backup` | `hindsight-backup` | Re-runs the pair verifier on a stored artifact; marks `verifiedAt`. Isolated restore read-back is environment evidence (§8), not a production kind. |

Add `"hindsight-backup"` to `EXCLUSIVE_MEMORY_FAMILIES` (`memory-operation-contract.ts:51`) and call
`refuseWhileExclusiveFamilyBusy` in each backup kind; activation/lifecycle/setup/onboarding then refuse while a backup is
open, and vice versa. `replica.sync` is not exclusive but its scheduler is paused by capture (5.3). Handler file:
`memory-operation-kind-backup.ts`; producer: `core/memory/hindsight-backup/hindsight-backup-service.ts`. Deferred claim +
`observeBoot` as in lifecycle kinds. No migration for kinds (048 has no CHECK).

### 5.2 Capture order (PR01 proof)

1. Admit; `tryClaim`.
2. `fence.quiesce({timeoutMs})` on all Hindsight writers; `scheduler.stop()` then await the stopped run (reads stay open).
3. Read Core identity inside one SQLite read (`readMemoryAuthoritySelection`, all B5/D77 checkpoints, terminal operation ids).
4. `db.backupTo(<artifactDir>/core.sqlite)` (Core copy; single writer is Core itself, invariant 2 intact).
5. Native snapshot (route §6), which starts after step 4 finished.
6. Pair check (5.6) on the native proof vs the Core identity from step 3.
7. Write `manifest.json` + hashes; fence release; `scheduler.start()`.

Why Core first: every Core write records its intent before native I/O and its terminal success only after the native
job is terminal (`hindsight-memory-write-repo.ts:54-70`, `hindsight-memory-write-result.ts:32-39`). A native snapshot
taken after the Core copy therefore contains every effect the Core copy calls terminal; the reverse order is exactly the
PR01 failure (a terminal Core success whose native effect is newer than the native snapshot). Native may still be a
superset (G11 writes, native workers); that is absorbed by replica catch-up because native cursor >= Core checkpoint.
The pause makes the window empty of Core-originated writes so Run/timeline records match native.

### 5.3 Hindsight write pause

`core/memory/hindsight/hindsight-writer-fence.ts`: `fenceHindsightWriters(subsystem, fence)` mirroring
`fenceCanonicalLocalWriters`: wraps engine write tools (fenced -> `FENCED_TOOL_RESULT`-style retryable result),
`writeMemory` (observed), `maintenance.run`, `memoryFlush`, `tidy`, the Pending recovery runner; recall/reflect reads
stay open; `recordPrimaryCommitted` stays open (Core-only witness, `hindsight-runtime-binding.ts:113-122`) because it is a
Core SQLite write captured by step 4 and replayed by ingestion. Fence is in-memory; a restart drops it (safe: capture is
then `outcome_unknown`).

### 5.4 Core capture primitive

`core/db/sqlite.ts`: add `backupTo(path: string): Promise<number>` on `Database` using `node:sqlite` `backup(db, path)`.
Prefer `backup()` over `VACUUM INTO`: page copy keeps rowids; `VACUUM INTO` may renumber rowids of tables without an
`INTEGER PRIMARY KEY`, and Core logic orders by implicit rowid (`core/db/hindsight-current-invalidation-repo.ts:55,77`,
`core/memory/hindsight-activation/hindsight-activation-reads.ts:133,135`, `hindsight-activation-service.ts:200`,
`legacy-candidate-repo.ts:22`). Target file must not exist; write to `*.partial` then rename.

### 5.5 Artifact manifest (Shared `hindsight-backup-schema.ts`, zod)

```
HindsightBackupManifest {
  version: 1, backupId, createdAt, operationId, route: "native-endpoint" | "operator-artifact",
  core:   { file: "core.sqlite", sha256, bytes, migrationHead: "050", pages },
  native: { location: "core-dir" | "native-host", file, sha256, bytes, nativeManifestVersion: "2",
            upstreamCommit, compatibilityBuild, alembicRevision, schema },
  authority: { epochId, activationTransactionId, providerLineageId, replicaCheckpointDigest,
               configFingerprint, deploymentMode },
  banks: [{ bankId, nativeBankId, scope, characterId, bankGeneration,
            core:   { replicaCursor, applicationNativeCursor, applicationStateCursor, checkpointHash },
            native: { currentCursor, minimumAvailableCursor, applicationNativeCursor, applicationStateCursor } }],
  terminalOperations: { count, digest },            // Core terminal write/Pending/ingestion ids
  custody: HindsightCredentialCustody,              // §5.9
  verifiedAt: string | null
}
```

Native proof (new, returned by the route in §6): `{ providerLineage, alembicRevision, upstreamCommit, compatibilityBuild,
banks[{bankId, bankGeneration, currentCursor, minimumAvailableCursor, application{nativeCursor, stateCursor}}],
receiptDigest(operationIds) , zipSha256, zipBytes }`, all read inside the same REPEATABLE READ transaction as `_backup`.

### 5.6 Pair verifier (pure function, Core `hindsight-backup-pair.ts`)

Refuse unless all hold: lineage equal; Bank sets equal and each `nativeBankId` equal (D86); per Bank generation equal;
native `currentCursor >= core.replicaCursor`; native application `stateCursor >= core.applicationStateCursor` and
`nativeCursor >= core.applicationNativeCursor`; every Core terminal operation id is present in native receipts
(`memory_native_operation_receipts`, `memory_mutation_receipts`, `memory_application_operations`) - the native side
answers with a set-membership result for the Core-supplied id list, so the digest is not enough on its own. Runs at
capture, at admit and at verify, always before any restore worker starts.

### 5.7 Rollback detection

`hindsight-client.ts` `mapHttpFailure`: read the 409 body reason for `/changes` and `/snapshots`; `cursor_expired` ->
existing `HINDSIGHT_CURSOR_RESET_REQUIRED` (rebuild); `cursor_ahead` -> new `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`
(no rebuild; replica error surface refuses; status shows it; the remedy is a paired restore or an explicit operator
decision, Stage 4/6). Lineage/generation change keeps today's behaviour.

### 5.8 Status and emergency (R5)

`MemoryAuthorityStatus.hindsight.backup = { lastVerified: {backupId, createdAt, verifiedAt, nativeCursors[]} | null,
ageSeconds | null, missingInterval: per Bank {fromNativeCursor (last verified backup), toReplicaCursor (current Core
checkpoint), pendingCount} }`. Emergency seal (hook consumed by Stage 4 takeover, no takeover here):
`sealEmergencyEvidence()` = `db.backupTo(<dir>/incident-<id>/core.sqlite)` + manifest `{kind:"incident-local", fullBackup:false,
lastVerifiedBackupId, backupAge, missingInterval}`. It never contacts native and never waits for a native backup.
ADR 0009 line 49 is the parent statement.

### 5.9 Credential custody (no secret copied)

`HindsightCredentialCustody = { storeId, refs: [{ ref, present, health, keyVersion, updatedAt }], connectionMarker }`
from `SecretCatalogService.presence/list` and `createHindsightConnectionSecret` marker. Never the value, never the
envelope, never `SecretCatalogService.backup()`. On restore read-back, each `present:true` ref missing in the target ->
`HINDSIGHT_BACKUP_CREDENTIAL_MISSING` naming the ref; native-side secrets (webhook secrets) travel inside the native ZIP
by construction; the manifest states that the ZIP is sensitive.

### 5.10 Storage

`<dataDir>/backups/<backupId>/{core.sqlite, native.zip?, manifest.json}`; write to `<backupId>.partial/` and rename on
seal; owner-only permissions where the OS supports mode bits; artifact bytes never logged; no automatic deletion in
Stage 3 (retention = deferred-decisions entry).

### 5.11 Error codes (Shared, a `MemoryBackupErrorCode` arm of `MemoryOperationErrorCode`)

`HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE`, `HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT`, `HINDSIGHT_BACKUP_CORE_CAPTURE_FAILED`,
`HINDSIGHT_BACKUP_NATIVE_FAILED`, `HINDSIGHT_BACKUP_PAIR_MISMATCH`, `HINDSIGHT_BACKUP_PROOF_MISSING`,
`HINDSIGHT_BACKUP_ARTIFACT_INVALID`, `HINDSIGHT_BACKUP_STORAGE_FAILED`, `HINDSIGHT_BACKUP_TARGET_NOT_ISOLATED`,
`HINDSIGHT_BACKUP_NATIVE_INCOMPATIBLE`, `HINDSIGHT_BACKUP_READBACK_MISMATCH`, `HINDSIGHT_BACKUP_CREDENTIAL_MISSING`;
plus `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED` in the Hindsight error set.

---

## §6 PR02 route comparison

| Route | How | Ubuntu headless | Windows desktop | Existing remote instance | Automatable | Problems |
| --- | --- | --- | --- | --- | --- | --- |
| (a) Shell/helper runs the CLI | New Rust capability spawns `hindsight-admin backup` with a DB URL | No (`taki-node` is debug-only; no release headless Node) | Only if Hindsight's DB is on the same host | No | Yes (where it works) | Taki must hold the DB URL/password (new secret class); breaks R10 independence for remote instances |
| (b) Operator runs CLI, Core admits | Operator runs `hindsight-admin backup`, hands the ZIP to Core; Core verifies | Yes | Yes | Yes | No (manual each time) | Plain ZIP has no proof: Core must parse binary COPY of replication/application tables, or accept only after an isolated restore drill; conflicts with G1 "no manual-management product mode" as the main path |
| (c) Minimal native endpoint | `POST /ext/taki-memory/admin/backups` runs `_backup` in-process (native's own DB connection) + returns the §5.5 native proof; off unless a native config flag enables it | Yes | Yes | Yes | Yes | New native capability for the existing API key (can export the whole DB incl. webhook secrets, prompts, audit log); large ZIPs; fork change |
| (d) Others | `export-bank`/`import-bank` (per Bank, no embeddings, no receipts); `docker exec` = (b) | - | - | - | - | Not whole-state; rejected |

Variant for (c) storage: **c-native-host** (native writes the ZIP to its own configured backup dir and returns proof +
sha256 + path; Core stores `core.sqlite` + manifest referencing it) versus **c-stream** (Core downloads the ZIP into
`<dataDir>/backups`). c-native-host avoids streaming GBs through Core and the 512 KiB response cap in the Core client;
c-stream keeps both halves on one host. Recommendation: c-native-host first (simplest, fits "Hindsight does its own DB
work"); c-stream is a later option.

Restore of a **real** instance stays an operator CLI action on the native host (`run-db-migration` -> `restore` ->
`repair-bank --all` -> `decommission-workers`) plus Core data-dir replacement while Core is stopped; Taki then runs
`backup.verify`-style read-back and G5 rollback detection guards the case where only native was restored. No HTTP restore.

**Recommendation**: (c) with the native opt-in flag as the primary route; (b) as the fallback using the same verifier,
where the operator runs the fork's CLI (the fork can add the same proof to the CLI manifest, so (b) also carries proof
and needs no binary-COPY parser). Both are OS-neutral and keep process/DB actions outside `packages/core`.

**Owner question (genuine permission/automation tradeoff, G1 said no universal admin permission was accepted):**

> 是否允许给 Hindsight 加一个默认关闭、需要在 Hindsight 那边手动打开的"整库备份"接口，让 Taki 用现有的 API key 自动触发备份？
> 打开后，持有这个 key 的一方可以导出整个 Hindsight 数据库（包括 webhook 密钥、模型请求记录、审计日志）；这个 key 现在已经能删除 Bank、读取全部记忆。
> 不打开的话，每次备份都要你在 Hindsight 所在机器上手动运行一条备份命令，再交给 Taki 检查。
> 建议：加接口并默认关闭，由你决定在哪个实例上打开。

---

## §7 Proposed waves (one implementer each)

| Wave | Content | Depends |
| --- | --- | --- |
| W1 | Shared: backup kinds/result arms/`PRODUCER_KIND` rows, `HindsightBackupManifest`, native proof schema, custody schema, error codes, status section. Core: `Database.backupTo` (`db/sqlite.ts`), artifact store (`<dataDir>/backups`, partial/rename/hash), pure pair verifier. | - |
| W2 | Core: `fenceHindsightWriters` + scheduler pause; `hindsight-backup` family into `EXCLUSIVE_MEMORY_FAMILIES`; `backup.capture` kind + service with Core-first order and `observeBoot`; rollback detection (`hindsight-client.ts` 409 body, new code, no rebuild). Native route behind an interface with a test double. | W1 |
| W3 | Core: `backup.admit` / `backup.verify`; custody record + missing-credential read-back; status section (age, missing interval); emergency `sealEmergencyEvidence` hook. | W2 |
| W4 | Native fork (`H:/hindsight`, only after owner consent): opt-in `POST /ext/taki-memory/admin/backups` + same proof in CLI manifest; native tests on pg0. Core native-route client. | owner answer; W1 schemas |
| W5 | Environment evidence: restore drill on the native-smoke harness (pg0 temp, fresh schema, restore, repair, decommission, isolated Core boot on a copied data dir, read-back, resume without repeated effects). Spec update (`memory-operations.md`, new `memory-hindsight-backup.md`), deferred-decisions entries (retention, c-stream, D88 remainder). | W3, W4 |

---

## §8 Automated tests vs environment evidence

Automated (vitest, real temp SQLite, doubles for native):
- `backupTo` copy opens, integrity_check ok, rowids equal to source, concurrent write during copy reflected.
- Pair verifier matrix: lineage/generation/Bank id/cursor/receipt-membership mismatches each refuse.
- Inter-capture-write case (PR01/C10): a write intent made after the Core copy and landing natively before the native
  snapshot -> accepted (native superset); a Core terminal op missing natively (reverse order simulated) -> refused.
- Fence: writers get retryable results during capture, reads pass, release in `finally`, timeout path.
- Operation owner: exclusive-family busy both ways, pre-claim cancel, `observeBoot` of an interrupted capture.
- Rollback detection: 409 `cursor_ahead` same lineage/generation -> refusal, no rebuild; `cursor_expired` unchanged.
- Custody: no secret value/envelope in any manifest byte; missing credential named.
- Emergency seal works with the native client failing; reports age and missing interval.

Native automated (pytest, pg0, in the fork): endpoint opt-in off -> 404/403; proof fields equal the snapshot contents;
existing `test_admin_backup_restore.py` stays green.

Environment evidence only (native-smoke harness, never the owner's data): full isolated round trip with a real native
process and a real Core boot; `repair-bank`/`decommission-workers` effects; resume against restored native receipts
without duplicate memories; large-artifact timing. Real-instance activation after a real backup remains D89 item (3)
(Stage 6 owner acceptance).

---

## §9 Caveats and uncertainties

- `node:sqlite` `backup()` consistency under concurrent writes from **other** connections restarts the copy; Core is
  the single writer through one connection, so this is expected to be fine, but W1 should test it on Node 24.18.
- Whether writing `<dataDir>/backups` fits invariant 1: it is operator-initiated and inside Core's own data dir (same
  place as `taki.db`, `secret-catalog.bin`); leader should confirm, no agent tool may reach it.
- The native proof's receipt-membership check needs a native query over three receipt tables; not verified that all
  Core terminal operation ids map 1:1 onto one of them (ingestion and application commits use different id spaces).
  W2/W4 must map each Core terminal kind to its native receipt table.
- `alembic_version` is not in the ZIP; the proof must carry it so a restore target at a different head is refused.
- The Core client buffers whole bodies and caps them at 512 KiB (`core/memory/hindsight/hindsight-http-transport.ts:13`,
  `hindsight-client.ts:261-262`); c-stream would need a separate streaming-to-file path, which is why c-native-host is preferred.
- Restoring the Core data dir in production (replacing `taki.db` while Core is stopped) has no tool yet; Stage 3 only
  needs it in the isolated drill. A production restore procedure is a runbook item for Stage 4/6.
- D88 whole-Bank reset remains Stage 5; restore never fixes `target_conflict`.
- `.trellis/spec/backend/database-guidelines.md` was not read in this pass.
