# Hindsight Backup, Verification and Restore (Stage 3)

## 1. Scope / Trigger

Use this contract when a change touches the `hindsight-backup` family (`backup.capture`, `backup.admit`,
`backup.verify`), the artifact store under `<dataDir>/backups/`, the native backup route (TAKI-HS-013) or its client,
the pair verifier, replica rollback detection and its hold, the `hindsight.backup` status section, the emergency seal,
or a restore of a sealed pair. Files: `core/memory/hindsight-backup/`, `operations/memory-operation-kind-backup*.ts`,
`memory/hindsight/hindsight-backup-client.ts`, `hindsight-writer-fence.ts`, `hindsight-cursor-reset.ts`,
`hindsight-application-sync-runner.ts`, `db/hindsight-replica-schedule-state.ts`, `boot/hindsight-backup-boot.ts`;
Shared `hindsight-backup-schema.ts`.
Operator-only (invariant 1): the kinds are reached only through `memory.operations.submit`; no agent tool reaches them.
Core writes only below `<dataDir>/backups/`; every path derives from `dataDir` plus a validated backup id or inbox name.
Deferred: artifact retention and cleanup (D90), the production Core data-dir restore tool (D91), the `target_conflict`
remedy (D88), the Stage 4 takeover that calls the emergency seal. Owner: [`memory-operations.md`](./memory-operations.md);
scheduler: [`memory-replica-sync.md`](./memory-replica-sync.md). `§5.x` marks cite task `09-25-hindsight-backup-restore`
`research/stage3-seams.md`, whose section numbers the code headers also use.

## 2. Signatures

```ts
{ kind: "backup.capture", expectedEpochId, route?: "native-endpoint" | "operator-artifact" }   // default native-endpoint
{ kind: "backup.admit", expectedEpochId, backupId, fileName }   // fileName: HindsightBackupInboxFileSchema
{ kind: "backup.verify", backupId }
MemoryBackupProducerRef = { kind: "backup", backupId, phase: "reserved" | "quiescing" | "capturing-core"
  | "capturing-native" | "verifying" | "sealing" | "completed" };
MemoryBackupResult = { kind: "backup", backupId, verifiedAt: Timestamp | null, mismatch: { reason, bankId } | null };
HindsightBackupManifest v1 = { backupId, createdAt, operationId, route, core: { file: "core.sqlite", sha256, bytes, pages,
  migrationHead }, native: { location: "core-dir" | "native-host", file, nativeManifestVersion: "2", schema, proof },
  authority, banks, terminalOperations: { count, digest }, custody, sensitive: true, verifiedAt };
HindsightBackupNativeRequest v1 = { backupId, createdAt, providerLineageId, nativeBankIds, operationIds };  // <= 1_000_000 printable-ASCII ids
HindsightBackupStatusSection = { lastVerified, ageSeconds, missingInterval, latest, staged };
MemoryBackupErrorCode = HINDSIGHT_BACKUP_* | MEMORY_AUTHORITY_MISMATCH | MEMORY_RUNTIME_UNAVAILABLE;
```

`HINDSIGHT_BACKUP_TARGET_NOT_ISOLATED`, `_NATIVE_INCOMPATIBLE` and `_READBACK_MISMATCH` are reserved for the restore tool
(D91); nothing produces them in Stage 3.
Core: `createHindsightBackupService(input)` -> `{ markerEpochId, capture, admit, verify, lastVerified, inventory, sealed,
quarantine, returnInbox, stop }` (the operation owner is its only caller); `createHindsightBackupStore(dataDir)`;
`verifyHindsightBackupPair(core, native)`; `createHindsightNativeBackupRoute(deps)` / `createUnavailableHindsightBackupRoute()`;
`readHindsightBackupStatus(db, input)`; `sealEmergencyEvidence(input)`; `readHindsightBackupCustody` /
`missingHindsightCredentials`; `HINDSIGHT_BACKUP_RECEIPT_MAP`. Composition: `boot/hindsight-backup-boot.ts`.

## 3. Contracts

### Store layout (`<dataDir>/backups/`)

| Entry | Holds | Listed |
| --- | --- | --- |
| `<id>.partial/` | a running capture (`core.sqlite`) | never; removed on failure, moved to `quarantine/` at boot |
| `<id>.staged/` | route b: `core.sqlite`, `core-identity.json`, `native-request.json`; `native.zip` while an admit holds it | only as status `staged` |
| `<id>/` | sealed: `manifest.json`, `core.sqlite`; route b adds `native.zip`, `core-identity.json`, `native-request.json` | when the manifest parses and names its own dir |
| `inbox/<fileName>` | the operator's route-b ZIP | never |
| `quarantine/` | partial dirs of dead captures | never |
| `incident-<id>/` | emergency evidence: `core.sqlite` + incident manifest | never |

Sealing re-hashes the files against the manifest, writes `manifest.json`, then renames the dir into place (the commit
point). Owner-only modes where the OS has them. Nothing is deleted automatically (D90).

### Capture (`backup.capture`)

- Admission is synchronous and side-effect free: backup producer present, no open exclusive family
  (`MEMORY_OPERATION_BUSY`), marker `hindsight` at `expectedEpochId`, a published runtime at that epoch with
  `driftReason() === "none"`. Any other miss is `MEMORY_OPERATION_UNSUPPORTED` with no row. The ref mints the backup id.
- Order (§5.2), all in one paused window:
  1. route c only: `route.available()` (a ready live connection), else `ROUTE_UNAVAILABLE` before anything pauses. A
     ready connection whose endpoint is off is found only by the native call in step 6 and fails the same code;
  2. `writeFence.quiesce` (30 s; timeout -> `QUIESCENCE_TIMEOUT`, and the fence reopens itself);
  3. scheduler `stop()`, which cancels and awaits the active run;
  4. one-transaction Core identity read (authority, per-Bank replica/application checkpoints, terminal-operation ids,
     migration head) and the custody record;
  5. `Database.backupTo` into `<id>.partial/core.sqlite`;
  6. route c: native snapshot (600 s deadline, raced, so a route that ignores its signal cannot hold the fence), pair check,
     seal with `verifiedAt`. Route b: write `native-request.json` and `core-identity.json`, rename to `<id>.staged/`,
     complete with `verifiedAt: null`.
- `finally` releases the fence and restarts a scheduler that was started (a failed restart logs
  `HINDSIGHT_REPLICA_SCHEDULE_STALE`). A failure after `store.begin` removes the partial dir; no failure leaves a listed
  artifact.
- Engine and Run write tools, observed `writeMemory`, `maintenance.run`, `memoryFlush` and `tidy` pass one write fence
  (`hindsight-writer-fence.ts`). While it is closed, tools return a retryable `MEMORY_AUTHORITY_FENCED` result and flush
  its retryable outcome. Recall/reflect, Run capture and the primary witness stay open. The fence is in-memory.
- A mismatched pair fails `PAIR_MISMATCH` and carries `{ reason, bankId }` in the result.
- After the claim, a vanished runtime settles `MEMORY_RUNTIME_UNAVAILABLE` and a moved epoch `MEMORY_AUTHORITY_MISMATCH`.
- Boot: an open capture row becomes `outcome_unknown` / `producer_incomplete` and its partial dir moves to
  `quarantine/`. Nothing redispatches.

### Pair check and receipts

- `verifyHindsightBackupPair` runs at capture, admit and verify. Native may be a superset (later cursors, extra
  receipts), never behind. It requires:
  - the same lineage;
  - every Core Bank's exact `nativeBankId` present, and no other Bank (`native_bank_id` / `bank_set`);
  - the same generation;
  - native `currentCursor` >= the Core replica cursor, and native application cursors >= Core's;
  - receipt `count`/`digest` equal to Core's terminal-operation list (`receipt_scope`), with `missingCount` 0
    (`receipt_missing`).
- `HINDSIGHT_BACKUP_RECEIPT_MAP` (`hindsight-backup-receipts.ts`, pinned by its test) says which native table proves each
  Core terminal write kind. A new kind must be added there, with its native proof, before capture may claim it. Rows with
  `native: null` are cursor-only: the Bank cursor comparison is their only proof, and they add no id to the list. Only ids
  of the Bank's current Core generation are listed.

### Route c: native endpoint (TAKI-HS-013, owner PR02)

- TAKI-HS-013 is additive and default-off in the `H:/hindsight` fork. `HINDSIGHT_API_TAKI_BACKUP_ENABLED` defaults to
  false: nothing is mounted and the route answers a plain 404. `HINDSIGHT_API_TAKI_BACKUP_DIR` is required when enabled.
- `POST /ext/taki-memory/admin/backups` (API key, supported-build check):
  - takes the native request (413 over the byte cap, 422 `invalid_request`);
  - holds a database-wide advisory lock (409 `backup_in_progress`);
  - writes `taki-backup-<backupId>.zip` exclusively into the native backup dir (409 `backup_exists`);
  - answers `{ version, backupId, schema, proof, artifact: { location: "native-host", fileName, sha256, bytes } }`,
    never the ZIP.
- `GET .../admin/backups/{fileName}` answers `{ fileName, sha256, bytes }`, 404 `artifact_not_found` (Core: not found,
  so verify records `ARTIFACT_INVALID`) or 422 `invalid_file_name`. Refusals are `{ error: "taki_backup_refused",
  reason }`; both routes are hidden from OpenAPI.
- Core side:
  - A non-ready connection or the absent route's 404 -> `ROUTE_UNAVAILABLE`.
  - A 409 refusal -> `NATIVE_FAILED`, with the reason logged.
  - The echoed `backupId` must match. The proof is the native body plus the ZIP digest.
  - The ZIP stays on the native host (`native.location: native-host`). Core never reads the native filesystem.
- The compatibility build stays `taki-memory-hindsight-0.9.0-d77-v1`. Core discovers a build without the route by its
  404. Bump the build, together with Shared, only when a patch changes existing behavior.
- There is no dedicated busy code. The exclusive family serializes Core captures, so `backup_in_progress` means a
  concurrent operator CLI or a second Core.

### Route b: operator artifact (PR02 fallback)

1. `backup.capture { route: "operator-artifact" }` stages `<id>.staged/`.
2. The operator runs `hindsight-admin backup <zip> --schema public --taki-request native-request.json`. The CLI exits 1 on
   an invalid request, and without the option its output is unchanged. The operator then puts the ZIP in
   `backups/inbox/`. The file name must pass `HindsightBackupInboxFileSchema`: plain `[A-Za-z0-9][A-Za-z0-9._-]*\.zip`,
   at most 128 characters, no device name. A path never reaches Core.
3. `backup.admit` is admitted when the producer exists, the marker is at `expectedEpochId` and no exclusive family is
   open. It then checks, in order:
   1. a staged capture with that id exists (else `ARTIFACT_INVALID`);
   2. its epoch is `expectedEpochId` (else `MEMORY_AUTHORITY_MISMATCH`);
   3. the inbox entry is renamed into the staged dir as `native.zip` before any byte is read (regular file only, else
      `ARTIFACT_INVALID`);
   4. the ZIP is read and must echo `taki.backupId`;
   5. the pair check passes.
   It then seals `route: operator-artifact`, `native.location: core-dir`, with `verifiedAt` set. Any refusal after the
   claim moves the ZIP back under its inbox name (a warning is logged when that name is taken again), so a corrected ZIP
   can still be admitted against the staged capture.
- ZIP format:
  - Only `manifest.json` and at most 512 `<table>.bin` entries (`[A-Za-z0-9_]{1,63}.bin`); any other entry, directory
    or encrypted entry is refused.
  - `manifest.json` is the native v2 manifest plus a strict `taki` object (`HindsightBackupArchiveProofSchema`): version
    1, the echoed backupId, the proof body read in the same REPEATABLE READ snapshot as the COPY, and one
    `{ name, bytes, sha256 }` per entry.
  - No `taki` -> `PROOF_MISSING`. A bad version, schema, entry, hash, size or echoed id -> `ARTIFACT_INVALID`.
  - Core hashes the ZIP file and re-hashes every `.bin` entry while streaming it; it never extracts to disk. Reference
    builder: `hindsight-backup-harness.ts` `operatorZip()`.
- Boot: a sealed route-b pair settles the admit row `completed`. Otherwise a claimed ZIP goes back to the inbox and the
  row becomes `outcome_unknown`.

### Verify (`backup.verify`)

- Admission: producer, marker `hindsight` (any epoch), no open exclusive family. Any sealed backup id can be verified
  through `backup.verify` on the operator surface. Home offers only the newest sealed backup (`latest`).
- Order: re-hash `core.sqlite`; judge the native artifact (a native-host ZIP by the route's digest read-back, a
  Core-held route-c `native.zip` by re-hash, a route-b ZIP re-read and deep-equal to the recorded proof); run the pair
  check; run the credential read-back.

| Outcome | Manifest |
| --- | --- |
| verified | only `verifiedAt` is rewritten (atomic replace); artifact files are never touched |
| `ARTIFACT_INVALID` (a file changed or missing, including the native-host ZIP), `PROOF_MISSING`, `PAIR_MISMATCH` | `verifiedAt: null` recorded |
| `ROUTE_UNAVAILABLE`, `NATIVE_FAILED`, `CREDENTIAL_MISSING`, `STORAGE_FAILED` | untouched (host state, not artifact state) |
| unknown backup id | `ARTIFACT_INVALID`; nothing to record |

### Custody

- Each manifest records presence, health, key version and update time for the fixed Hindsight secret refs, plus any
  other listed `memory.hindsight.` ref (max 32) and the connection marker. It records presence only: no value or
  envelope, and never `resolve()` or `SecretCatalogService.backup()`.
- `backup.verify` fails `HINDSIGHT_BACKUP_CREDENTIAL_MISSING` when a ref the record saw present is missing from the
  current catalog. The refs are logged and the manifest is untouched.

### Rollback detection and the hold (§5.7)

- A rollback is a native head behind Core's own checkpoint in the same provider lineage and Bank generation, that is, a
  native restore without Core's copy.
  - It raises `HindsightRollbackError` (`HINDSIGHT_PROVIDER_ROLLBACK_DETECTED` with `providerLineageId` and
    `bankGeneration`).
  - It never rebuilds, because a rebuild would absorb it.
  - It is non-retryable and not a replica-reset code, so `rebuild` never follows it.
- Production composes only the application-aware runner (`hindsight-runtime-state.ts`), used for scheduled runs,
  Pending recovery, on-demand recovery and Run-admission pulls. It detects:
  - incremental: a `state_reset_required` refusal whose `checkpoint` is behind Core's on either cursor. A replay-floor
    reset where native is not behind still rebuilds;
  - full (explicit, automatic, or the rebuild after a reset in the same generation): an `initialize` head behind Core's
    application checkpoint, before any application snapshot is created or downloaded and before any publication (a
    reset run first resolves its namespace through one native logical snapshot).
- The client classifies a native 409 on `/changes` or `/snapshots` (`hindsight-cursor-reset.ts`): a well-formed
  `cursor_ahead` is a rollback, any other body `HINDSIGHT_CURSOR_RESET_REQUIRED` (rebuild). The plain B5 incremental
  sync, used only when no runner is injected, keeps a `cursor_ahead` only when it names the checkpoint's own lineage and
  generation.
- A different generation is a new Bank history and keeps the rebuild. Publication's predecessor checks keep
  `HINDSIGHT_APPLICATION_CHECKPOINT_STALE`: an event whose predecessor no longer matches, a snapshot over a deleted Bank's
  checkpoint, or a snapshot behind the Bank's B5 `endCursor`.
- Hold (`heldForOperator`): a Bank failed with this code gets `nextAction: explicit_retry_required`, no retry timer and no
  interval, full or catch-up run. A manual `replica.sync` stays claimable, and the first success clears the hold.
- Known limit: the seed path (no application checkpoint yet, i.e. after `hindsight.activate` publishes a B5-only
  checkpoint and before the first application sync) is not classified. A native head behind that B5 `endCursor` fails
  as `CHECKPOINT_STALE` at publication, not as a rollback.

### Status section (`hindsight.backup`)

- `memory-authority-status.ts` builds it synchronously from the service `inventory()` and never probes the network.
  `memory-hindsight-lifecycle-status.ts` returns it as read. It is `null` when unreadable. Unknown values stay null, never
  zero.
- `lastVerified`: the newest sealed backup with a `verifiedAt`, carrying each native Bank's `currentCursor` from its
  proof. `ageSeconds` is computed from its `createdAt`. The two are null together.
- `missingInterval`, for each verified B3 native Bank:
  - `fromNativeCursor`: the last verified proof's cursor, else null;
  - `toReplicaCursor`: the current B5 `endCursor`;
  - `pendingCount`: Pending intents plus open D77 parent writes, or null when unreadable.
- `latest`: the newest sealed backup whatever its verification, so a backup whose verify failed stays re-verifiable.
- `staged`: route-b captures of the current epoch with a readable Core identity, newest first, at most 16.
- The service caches the inventory and re-lists it after every capture, admit and verify. Hand edits under `backups/`
  show up after the next such operation or a restart.

### Emergency seal (§5.8)

- `sealEmergencyEvidence({ db, store, lastVerified, now? })` writes `incident-<uuid>/`: a Core copy plus an
  `incident-local` manifest (`fullBackup: false`, epoch, core digest, the last verified backup id, its age and the
  missing interval).
- It takes no native route, so it never contacts or waits for native. It is never listed. It has no caller until the
  Stage 4 takeover.

### Shutdown

- `hindsightBackup.stop()` aborts an in-flight native snapshot and awaits the capture's release. It runs alongside the
  Local onboarding, activation and lifecycle stops, all before `memoryRuntime.stop()` (`main.ts` `shutdown`). The order
  matters because the release restarts the B5 scheduler, which the runtime stop then settles for good.

### Restore

- Isolated drill (task `09-25-hindsight-backup-restore`, `research/restore-drill-2026-09-27.md`):
  1. On a fresh native database, run the admin CLI: `run-db-migration`, `restore <zip> --yes`, `repair-bank --all`,
     `decommission-workers --yes`.
  2. Run Core on a copy of the data dir, with `backups/<id>/core.sqlite` as `taki.db` (its sha256 equal to the
     manifest's).
  3. Read back authority, Banks and checkpoints.
  4. Run one `replica.sync`.
  5. Run `backup.verify` on the restored host.
- Facts:
  - The restored host shows the copied capture operation as `outcome_unknown` / `producer_incomplete`, because the copy
    was taken while the capture ran. Its sealed manifest still verifies. This is expected, not a defect.
  - A restored Pending whose native effect already landed completes on the next replica run from the existing native
    result, with no repeated native write.
  - Core from a newer pair against native from an older one fails `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`, with zero
    snapshot calls and unchanged checkpoints.
- A production restore of the Core data dir stays an operator runbook (D91).

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| no backup producer, marker not `hindsight`, other epoch, or (capture) an unpublished/drifting runtime | `MEMORY_OPERATION_UNSUPPORTED`; no row |
| a backup kind while an exclusive family is open, or an exclusive kind while a backup row is open | `MEMORY_OPERATION_BUSY` + `activeOperationId` |
| route c without a ready connection | `failed` / `ROUTE_UNAVAILABLE` (`producer_refused`) before any pause; nothing listed |
| route c with the endpoint off (native 404) | `ROUTE_UNAVAILABLE` after the pause; partial dir removed; fence released; scheduler restarted |
| quiesce timeout | `QUIESCENCE_TIMEOUT`; fence reopened; scheduler never stopped |
| native refusal, failure or deadline | `NATIVE_FAILED`; partial dir removed; fence released; scheduler restarted |
| pair mismatch at capture or admit | `PAIR_MISMATCH` + `{ reason, bankId }` in the result; nothing listed |
| admit: unknown staged id, bad inbox entry, no `taki`, bad ZIP, other echoed id | `ARTIFACT_INVALID` / `PROOF_MISSING`; ZIP back in the inbox; staged capture kept |
| verify: artifact changed or missing | `ARTIFACT_INVALID`; `verifiedAt: null` recorded |
| verify: route unavailable, native failure, missing credential | that code; manifest untouched |
| Core restart with an open backup row | `outcome_unknown` / `producer_incomplete`; capture partial quarantined; admit ZIP returned (sealed -> `completed`) |
| replica sync against a rolled-back native | `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`; no snapshot or rebuild; checkpoint unchanged; held for explicit runs |
| cancel before / after claim | `cancelled` / `MEMORY_OPERATION_RUNNING` |

## 5. Good / Base / Bad Cases

- Good: a route-c capture seals a verified pair in one paused window; chat keeps committing; Run write tools refuse
  retryably while paused, then work again; `lastVerified` moves.
- Base: the native endpoint is off, so a route-c capture pauses, gets the native 404 and fails `ROUTE_UNAVAILABLE` with
  nothing listed. The operator then uses route b: capture stages, the CLI writes the ZIP, the ZIP goes in the inbox, and
  admit seals it verified.
- Bad: rebuilding the replica after a native rollback; clearing `verifiedAt` because the native host was unreachable;
  listing a staged or partial dir as a backup; admitting a ZIP by caller-supplied path.

## 6. Tests Required

- Shared: `hindsight-backup-schema.test.ts`, `memory-hindsight-lifecycle-schema.test.ts`.
- Core `hindsight-backup/`: `store`, `pair`, `receipts` (the pinned map), `service` (the capture failure matrix, stop
  during copy), `admit`, `verify`, `custody` (no secret bytes in any artifact), `status`, `emergency`, `native-route`
  tests.
- Core others:
  - `sqlite.test.ts` `backupTo`, `hindsight-writer-fence.test.ts`, `hindsight-cursor-reset.test.ts`,
    `hindsight-replica-sync-runner.test.ts` (plain B5 `cursor_ahead`);
  - `hindsight-application-sync-runner.test.ts`: incremental and full rollback with no snapshot (the full run once
    per cursor, with only the state or only the native cursor behind), and the floor-reset rebuild;
  - `hindsight-replica-scheduler-repo.test.ts`: the hold;
  - the `memory-operation-kind-backup*.test.ts` journeys.
- Desktop: `memory-hindsight-backup-state.test.ts`, `memory-hindsight-backup-block.test.tsx`.
- Native fork: `tests/test_taki_admin_backup.py`.
- Isolated Core boot (task `research/isolated-process-check.mjs`): on Legacy/Local every backup kind is refused
  `MEMORY_OPERATION_UNSUPPORTED` with no row and no `backups/` dir; 0 fetches.
- Rerun the restore drill whenever capture, a route or restore semantics change.

## 7. Wrong vs Correct

Wrong: rebuild on every reset refusal.

```ts
if (error.refusal.code === "state_reset_required") checkpoint = await full(context, true);
```

Correct: a native head behind Core's own checkpoint in the same namespace is a rollback, never absorbed.

```ts
refuseRollback(error.refusal.checkpoint, deps.repo.checkpoint(input.bank.bankId) ?? checkpoint);
checkpoint = await full(context, true);
```
