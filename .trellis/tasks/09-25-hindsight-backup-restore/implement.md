# Implement: Stage 3 backup/restore

Read `prd.md`, `design.md` (leader rulings override research), `research/stage3-seams.md`. Follow the spec manifest in
`implement.jsonl`. Every wave: headers + folder `index.md`, TS file 300/360, functions <= 50 lines, params <= 3, no
barrels; tests colocated; no real Hindsight/model/user data; boots use a temp data dir, a non-default port, fetch blocked.

## W1 Contracts and primitives

- Shared: `hindsight-backup-schema.ts` (manifest §5.5, native proof, custody §5.9, status section §5.8), kinds and result
  arms in `memory-operation-schema.ts` (`backup.capture|admit|verify`), `MemoryBackupErrorCode` arm (§5.11) and
  `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`; named re-exports in `packages/shared/src/index.ts` (keep <= 500 effective lines;
  currently 488 — group re-exports, never `export *`).
- Core `db/sqlite.ts`: `backupTo(path): Promise<number>` on `Database` via `node:sqlite` `backup()`; tests: opens,
  `integrity_check`, rowids equal, write during copy reflected.
- Core `memory/hindsight-backup/hindsight-backup-store.ts`: `<dataDir>/backups/<backupId>.partial/` -> rename on seal,
  sha256/bytes, list only sealed dirs, quarantine partials, `backupId` validation, owner-only mode where supported.
- Core `memory/hindsight-backup/hindsight-backup-pair.ts`: pure verifier (§5.6) with the full refusal matrix and the
  native-superset acceptance.

## W2 Pause, capture, rollback

- `memory/hindsight/hindsight-writer-fence.ts` (§5.3) over the generic fence; scheduler stop/await/start around capture.
- Family `hindsight-backup` in `EXCLUSIVE_MEMORY_FAMILIES`; `memory-operation-kind-backup.ts` (capture) with deferred
  claim and `observeBoot`; service in `memory/hindsight-backup/` following §5.2 exactly; `HindsightBackupRoute`
  interface + test double; Core terminal-id -> native receipt table mapping (ruling 3).
- `hindsight-client.ts` 409 body reason: `cursor_ahead` with same lineage/generation -> rollback code, no rebuild;
  `cursor_expired` unchanged (§5.7).
- Register the kind in the server wiring; isolated boot shows it registered.

## W3 Admit, verify, custody, status, emergency

- `backup.admit` (inbox file or native-host reference) and `backup.verify` kinds; custody record from
  `SecretCatalogService.presence/list` + connection marker (never `backup()`); missing credential named.
- `memory.authority.status` `hindsight.backup` section: last verified, age, per-Bank missing interval.
- `sealEmergencyEvidence()` hook (§5.8), native never contacted.

## W4 Home backup block

- `apps/desktop/src/windows/home/pages/operations/`: block beside the lifecycle block; states (none, capturing, failed
  with code, verified with age, rollback detected); actions capture/verify through the generic controller; fixtures.

## W5 Native route (after owner PR02 answer)

- `H:/hindsight` fork: route (c) opt-in endpoint or (b) CLI proof, pytest on pg0; record in `TAKI_PATCHES.md`.
  Core route client implementing `HindsightBackupRoute`.

## W6 Restore drill

- Extend the native-smoke harness (`../09-25-hindsight-native-smoke/research/`): capture -> fresh pg0 schema ->
  restore -> `repair-bank --all` -> `decommission-workers` -> Core on a copied data dir -> read-back -> resume without a
  repeated native effect. Evidence in `research/restore-drill-<date>.md`.

## Evidence log

(Leader appends per-wave gate results and commits here.)

### W1 (2026-09-26, implementer; uncommitted)

- Shared: new `hindsight-backup-schema.ts` (manifest v1, native proof, credential custody, pair-mismatch reasons, the
  `hindsight.backup` status block, backup.capture/admit/verify request/producer/result, `MemoryBackupErrorCode`);
  `memory-operation-schema.ts` wires the three kinds (`PRODUCER_KIND` -> `backup`, producer/result backupId agreement);
  `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED` joins `HINDSIGHT_ERROR_CODES`; `MemoryHindsightStatusSection.backup` is required
  and nullable; named re-exports grouped into two statements (`index.ts` 497 effective lines, lint green).
- Core: `Database.backupTo(path)` over `node:sqlite` `backup()` (signature checked against installed `@types/node` 24 and
  nodejs.org v24 docs; refuses inside a wrapper transaction); `memory/hindsight-backup/hindsight-backup-store.ts`,
  `hindsight-backup-pair.ts` (+ `hindsight-operation digest`), test fixtures, folder `index.md`.
- Typecheck-forced touches outside the listed scope: `memory-operation-kind-backup.ts` registers the three kinds with an
  admission refusal `MEMORY_OPERATION_UNSUPPORTED` (W2 replaces it); status producer emits `backup: null`;
  `hindsight-errors.ts` next action + non-retryable for the rollback code; Desktop kind labels and fixtures `backup: null`.
- Tests added: `hindsight-backup-schema.test.ts` (Shared), `sqlite.test.ts` backupTo block (openable copy, integrity_check,
  implicit rowids equal, same-connection write during a running copy reflected, refusal inside a transaction, missing
  target dir rejects), `hindsight-backup-store.test.ts` (seal/list/digest, failed copy leaves nothing, seal hash/shape
  refusal, id validation, quarantine, listing filter, POSIX modes - skipped on Windows), `hindsight-backup-pair.test.ts`
  (full refusal matrix + native-superset acceptance + unchecked fresh Bank), `memory-operation-kind-backup.test.ts`.
- Gates: `pnpm typecheck` green; `pnpm lint` green; Shared 60 files / 540 tests; Desktop 113 / 646; CLI 8 / 47; Core
  409 / 3270 (+1 skipped POSIX-mode test) on a quiet rerun. Under parallel load the first runs timed out (5000 ms) in
  known-flaky files (`hindsight-memory-write-repo`, `skill-package-source`, lifecycle journey, runtime composition);
  each passed alone and the full Core rerun was green, no timeout raised. `git diff --check` clean, no trailing
  whitespace in new files. Isolated boot (archived Stage 2c harness, temp copy removed): port 7363, migrations 1..50,
  0 fetches, exit 0.

### W2 (2026-09-26, implementer; uncommitted)

- Pause: `memory/fenced-memory-tools.ts` (tool fencing extracted from the Local writers, shared by both fences);
  `memory/hindsight/hindsight-writer-fence.ts` fences engine write tools, observed `writeMemory`, `maintenance.run`,
  `memoryFlush` (retryable `MEMORY_AUTHORITY_FENCED` outcome) and `tidy`; recall/reflect, Run capture and
  `recordPrimaryCommitted` stay open. The Hindsight subsystem owns one `writeFence`; the operations runtime view exposes it
  plus `scheduler.stop/start`.
- Capture: `backup.capture` kind (`memory-operation-kind-backup-capture.ts`) with admission refusals (no producer, marker
  not Hindsight, runtime unpublished or drifting, epoch mismatch, busy exclusive family), deferred claim, pre-claim cancel,
  `observeBoot` -> `outcome_unknown`/`producer_incomplete` with the partial dir quarantined (no redispatch). Family
  `hindsight-backup` joins `EXCLUSIVE_MEMORY_FAMILIES`. Producer `hindsight-backup-service.ts` runs §5.2: quiesce ->
  scheduler `stop()` (cancels and awaits the active run) -> one-transaction identity read (`hindsight-backup-identity.ts`)
  -> `db.backupTo` into the partial dir -> native snapshot (route promise raced against its deadline) -> pair check ->
  seal; `finally` releases the fence and restarts a scheduler that was started. Composed in `boot/hindsight-backup-boot.ts`,
  wired in `main.ts` (shutdown aborts an in-flight native snapshot) and the activation journey (optional route double).
- Route: `HindsightNativeBackupRoute` (`hindsight-backup-route.ts`) + `createUnavailableHindsightBackupRoute()` (production,
  `HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE` until W5) + in-memory double `hindsight-backup-route-fixtures.ts`.
- Receipt mapping (ruling 3), pinned in `HINDSIGHT_BACKUP_RECEIPT_MAP`:

  | Core terminal write | Native proof | Id |
  | --- | --- | --- |
  | Pending tracked_native_v1 retain, native-confirmed | `memory_native_operation_receipts` | `native-operation:<bank>:<gen>:retain:<remoteOperationId>` |
  | Pending tracked_native_v1 edit/invalidate/restore, native-confirmed | `memory_native_operation_receipts` | `native-operation:<bank>:<gen>:mutation:<remoteOperationId>` |
  | Pending legacy edit/invalidate/restore, native-confirmed | `memory_mutation_receipts` | `mutation-receipt:<bank>:<remoteOperationId>` |
  | Pending legacy retain | cursor-only | — |
  | D77 application command job completed | `memory_application_operations` | `application-operation:<lineage>:<bank>:<gen>:<operationId>` |
  | D77 write intent (047), ingestion outbox/provider evidence, policy work (045), observed write, primary witness | cursor-only | — |

  Only rows of the Bank's current Core generation are listed.
- Rollback (§5.7): `hindsight-cursor-reset.ts`; `mapHttpFailure` reads the 409 body on `/changes` and `/snapshots`
  (512 KiB cap, never logged): well-formed `cursor_ahead` -> `HindsightRollbackError` (`HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`,
  non-retryable, not a replica reset); `syncHindsightBankPage` keeps it only for the checkpoint's own lineage/generation,
  otherwise `HINDSIGHT_CURSOR_RESET_REQUIRED`; `cursor_expired` and unparseable bodies keep the rebuild.
- Deviations: route interface named `HindsightNativeBackupRoute` (Shared already exports the `HindsightBackupRoute`
  enum type); the Pending recovery runner is not wrapped separately - it runs only through the scheduler (stopped by
  capture) and `service.recover` inside already-fenced write paths; `store.quarantine` became synchronous (boot
  observation cannot await); custody is a minimal presence reader (W3 owns the full record); a native ZIP left on the
  native host after a later-step failure is not removed (W5/D90).
- Tests added: `hindsight-writer-fence.test.ts`, `hindsight-backup-service.test.ts` (success, scheduler not started,
  restart failure logged, 11-row §4 capture failure matrix each asserting no listed artifact/no partial/fence released/
  scheduler resumed, pair-mismatch detail, stop() aborts native, quarantine, inter-capture write accepted, missing
  receipt -> `PAIR_MISMATCH`), `hindsight-backup-receipts.test.ts`, `memory-operation-kind-backup-capture.test.ts`
  (journey: admission matrix, exclusive both ways vs setup/onboarding/activation/lifecycle, pre-claim cancel, capture with
  chat committing and Run writes refused during the native step, production route `ROUTE_UNAVAILABLE`, mismatch result,
  restart mid-capture), `hindsight-cursor-reset.test.ts` (409 matrix), runner rollback/no-rebuild + rebuild cases.
- Gates: `pnpm typecheck` green; `pnpm lint` green; Shared 60 / 540; Desktop 113 / 646; CLI 8 / 47; Core 414 / 3315
  (+1 skipped POSIX-mode test), no flake this run; `git diff --check` clean. Isolated boot
  (`research/isolated-process-check.mjs`, kept): port 6744, migrations 1..50 (head), `backup.capture` refused
  `MEMORY_OPERATION_UNSUPPORTED` on the Local marker with no row and no `backups/` dir, 0 fetches, exit 0.

### W3 (2026-09-26, implementer; uncommitted)

- Route-b admission protocol (PR02 fallback; route c stays primary):
  1. `backup.capture {expectedEpochId, route: "operator-artifact"}` runs the W2 pause (fence, scheduler stop, identity
     read, Core `backupTo`) and, instead of calling native, stages `<dataDir>/backups/<id>.staged/` = `core.sqlite` +
     `core-identity.json` (every manifest field except native/route/verifiedAt) + `native-request.json`
     (`HindsightBackupNativeRequest` v1: `backupId`, `createdAt`, `providerLineageId`, `nativeBankIds`, `operationIds`).
     It completes `verifiedAt: null` with the backup id in the producer ref and releases the fence; a staged dir is never
     listed. `route` defaults to `native-endpoint` (W2 behaviour).
  2. The operator runs the native CLI with `native-request.json` and drops the ZIP at
     `<dataDir>/backups/inbox/<fileName>` (`HindsightBackupInboxFileSchema`: plain `[A-Za-z0-9][A-Za-z0-9._-]*\.zip`,
     max 128, no device names; never a path).
  3. `backup.admit {expectedEpochId, backupId, fileName}` (backupId added to the request): refuses an unknown staged id
     (`ARTIFACT_INVALID`) or an epoch other than the staged one (`MEMORY_AUTHORITY_MISMATCH`), then moves (renames) the
     inbox ZIP into the staged dir as `native.zip` before reading a byte (regular file only; a directory or symlink is
     moved back and refused), reads it, requires the echoed backup id, runs the pair verifier against the staged Core
     identity and seals `route: operator-artifact`, `native.location: core-dir`, `verifiedAt` set. Any refusal moves the
     ZIP back to the inbox and keeps the staged capture admissible for a corrected ZIP; sealing consumes it. Boot
     observation: sealed -> `completed`; otherwise the claimed ZIP goes back and the row is `outcome_unknown`.
  - Ordering proof (a ZIP older than the Core copy is refused): the ZIP must echo the Core-minted `backupId` that only
    exists once the Core copy is staged; its proof's receipts `count`/`digest` must equal the staged Core terminal-id
    list (another list -> `PAIR_MISMATCH receipt_scope`, a Core success the ZIP lacks -> `receipt_missing`); every
    native Bank cursor must be >= the Core checkpoint (`replica_cursor` / `application_native_cursor` /
    `application_state_cursor`); every `.bin` entry is re-hashed against its pinned digest.
- Proof-in-ZIP format W5 must produce (native CLI `backup`, `MANIFEST_VERSION` "2"): the ZIP holds only
  `manifest.json` and `<table>.bin` entries (`[A-Za-z0-9_]{1,63}.bin`, no directories, no encryption, <= 513 entries,
  manifest <= 4 MiB). `manifest.json` is the native v2 manifest (`version: "2"`, `created_at`, `schema`,
  `tables.<table>.size_bytes` = the `.bin` entry byte length) plus a top-level `taki` object
  (`HindsightBackupArchiveProofSchema`): `{ version: 1, backupId: <echoed from native-request.json>, proof: <native proof
  body read in the same REPEATABLE READ snapshot as the COPY: providerLineage, alembicRevision, upstreamCommit,
  compatibilityBuild, banks[{bankId, bankGeneration, currentCursor, minimumAvailableCursor, application|null}] exactly for
  the requested nativeBankIds, receipts{count, digest (Core operation-list digest), missingCount, missingSample}; no
  zipSha256/zipBytes>, entries: [{ name: "<table>.bin", bytes, sha256 }] one per table }`. Core computes the ZIP's own
  sha256/bytes. A ZIP without `taki` -> `PROOF_MISSING`; bad version/schema/entry/hash/size/echoed id ->
  `ARTIFACT_INVALID`. Reference builder: `hindsight-backup-harness.ts` `operatorZip()`.
- `backup.verify {backupId}`: re-hashes `core.sqlite`; a Core-held route-c `native.zip` is re-hashed against the proof, a
  route-b ZIP is re-read and must be deep-equal to the recorded proof; a native-host ZIP is judged by its recorded proof
  (D92). Pair re-check follows. Artifact codes (`ARTIFACT_INVALID`/`PROOF_MISSING`/`PAIR_MISMATCH`) record
  `verifiedAt: null`; success rewrites only `verifiedAt` via `.next` + rename. A missing credential fails
  `HINDSIGHT_BACKUP_CREDENTIAL_MISSING` (refs logged) without touching the manifest (host state, not artifact state).
- Custody (§5.9): `readHindsightBackupCustody` records presence/health/keyVersion/updatedAt of the fixed Hindsight refs plus
  any other listed `memory.hindsight.` ref (sorted, max 32) and the connection marker; never `resolve`/`backup`.
  `missingHindsightCredentials(custody, catalog)` names every `present: true` ref the target catalog lacks; boot wires it
  into verify.
- Status: `hindsight-backup-status.ts` fills `hindsight.backup` synchronously (last verified pair, `ageSeconds` from its
  `createdAt`, per verified B3 native Bank `{fromNativeCursor, toReplicaCursor, pendingCount}` = Pending pending + open D77
  parent writes); the service caches the last verified manifest and invalidates it after every capture/admit/verify.
  `memory-hindsight-lifecycle-status.ts` returns the block as read; `memory-authority-status.ts` builds it (unreadable ->
  null).
- Emergency: `sealEmergencyEvidence({db, store, lastVerified, now?})` writes `backups/incident-<uuid>/` (Core copy +
  `incident-local`, `fullBackup: false`, last verified id, age, missing interval); takes no route, never listed; no caller
  (Stage 4).
- Refactor: producer failure helpers (`hindsight-backup-failure.ts`) and file helpers (`hindsight-backup-files.ts`) split
  out; the three backup kinds share `memory-operation-kind-backup.ts` helpers; the store factory is split into
  capture/staged/sealed method groups; `HindsightNativeBackupRequest` derives from the Shared request.
- Deviations: `backup.admit` request carries `backupId` (pairs a ZIP with exactly one staged capture);
  `backup.capture` gained optional `route`; the native proof schema is split into a body (in-ZIP) and the full proof;
  admit claims the ZIP before reading it (no check/seal race); a sealed route-b dir keeps `native-request.json` and
  `core-identity.json` beside the pair; custody lists extra `memory.hindsight.` refs; status intervals are keyed by
  native Bank id; the activation journey's fixture catalog now answers `list()` with no entries. D90 widened to staged,
  inbox and incident entries; D92 added.
- Tests added: `hindsight-backup-admit.test.ts` (route-b staging, admit success, refusal matrix incl. missing proof,
  version, foreign echoed id, tampered/unpinned/nested entries, native behind, pre-request receipts, unknown id, epoch,
  path-like/absent/directory/non-ZIP inbox entries; ZIP returned each time), `hindsight-backup-verify.test.ts`,
  `hindsight-backup-custody.test.ts` (real SecretCatalogService; no secret value or envelope bytes in any artifact incl.
  incident evidence; read-back), `hindsight-backup-status.test.ts`, `hindsight-backup-emergency.test.ts` (hanging native
  never called), `memory-operation-kind-backup-admit.test.ts` (journey: Local refusal, family both ways, route b through
  the owner incl. status, proof-missing failure, boot observation both ways); `memory-operation-kind-backup.test.ts`
  rewritten; capture journey helpers moved to `memory-operation-backup-fixtures.ts`.
- Gates: `pnpm typecheck` green; `pnpm lint` green; Shared 60 / 543; Core 421 / 3362 (+1 skipped POSIX-mode test), no
  flake this run; Desktop 113 / 646; `git diff --check` clean, no trailing whitespace in new files. Isolated boot
  (`research/isolated-process-check.mjs`, extended): port 6341, migrations 1..50, `backup.capture` (both routes),
  `backup.admit` and `backup.verify` refused `MEMORY_OPERATION_UNSUPPORTED` on the Local marker, no row, no `backups/`,
  status `hindsight` null under Legacy and Local, 0 fetches, exit 0.
