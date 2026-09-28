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

### W4 (2026-09-26, implementer; uncommitted)

- Desktop only (`apps/desktop/src/windows/home/pages/operations/`); no Shared/Core change needed.
- `memory-hindsight-backup-state.ts` (pure): `hindsightBackupView(status)` is null exactly when `hindsight` is null. Rows:
  备份状态 未知 (section `backup: null`) / 尚无已校验的备份 / 已有已校验的备份 + 上次备份 `createdAt（N 分钟/小时/天前）` from
  `ageSeconds` + 校验时间; per-Bank 未备份区间 `游标 from → to · 未落定写入 n` (null renders 未知, never 0), the native Bank id
  replaced by the lifecycle scope label where `hindsight.banks` maps it. Backup rows are `backup.*` operations from
  `operations.active` + `recent` (deduped, newest first): an open row -> in-flight line (kind + producer phase, or the
  state label before claim) and `pending`; otherwise the newest settled row -> failure line (`failed` closed code ->
  `BACKUP_ERROR_LABEL`, `outcome_unknown` -> restart line). Staged route-b capture = newest completed
  `backup.capture {route: operator-artifact}` without a completed `backup.admit` for its backupId (a failed admit keeps it).
  Rollback warning when any replica or lifecycle Bank reports `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`. Actions: 创建备份
  (`backup.capture`, status epoch, `route: native-endpoint`); 创建备份（手动导出原生数据）(`operator-artifact`) only when
  the newest settled capture failed `HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE`; 校验备份 on `lastVerified.backupId`.
  `backupAdmitAction(staged, fileName)` builds `backup.admit {expectedEpochId: staged capture's epoch, backupId, fileName}`
  only when the trimmed name passes `HindsightBackupInboxFileSchema`. Ids, codes and pair-mismatch detail sit only in the
  collapsed 备份诊断.
- `memory-hindsight-backup-block.tsx`: rendered by `memory-authority-card.tsx` after the lifecycle block; rollback as a
  danger `FeedbackLine`; the admit form (keyed by backupId) names `backups/<id>.staged/native-request.json` and
  `backups/inbox`; every action goes through `ops.submit(request, key)` and is disabled while the card is locked
  (disconnected or a mutation pending) or a backup operation is open; admit also while the file name is invalid.
- Limits: the staged capture and the last failure are read from `operations.recent` (max 20 rows); a staged capture pushed
  out of that window disappears from Home until Core lists staged captures in the status section. 校验备份 targets only the
  last verified backup (a sealed backup whose verify failed is not offered). `home-window.md` still says backup is not on
  the card — update-spec step.
- Tests: `memory-hindsight-backup-state.test.ts` (every fixture parses the strict status schema with and without a
  backup; unknown/none/verified/age units/unmapped Bank; in-flight phase and admitted; every closed code message, mismatch
  diagnostics, outcome_unknown; operator route only after ROUTE_UNAVAILABLE; staged kept across a failed admit, gone after a
  completed one; inbox name matrix; rollback from replica and from a lifecycle Bank; capture/verify/admit submitted through
  the generic controller unchanged), `memory-hindsight-backup-block.test.tsx` (every state renders, no code/id in primary
  rows, buttons per state, disabled while open/locked/offline, only under Hindsight). `memory-authority-card.test.tsx`:
  two counts now include 创建备份.
- Gates: `pnpm typecheck` green; `pnpm lint` green; Desktop 115 files / 663 tests; `pnpm --filter @taki/desktop build` ok
  (pre-existing >500 kB pet chunk warning); `git diff --check` clean, no trailing whitespace in new files.

### Leader notes after W4 (2026-09-26)

- Follow-up for the formal check (Core/Shared, after W5 lands): the status section must list the open route-b staged
  captures and the newest sealed backup regardless of verification, so Home does not depend on the 20-row
  `operations.recent` window (W4 point 1) and a sealed backup whose verify failed can be re-verified (W4 point 2).
- `home-window.md` backup line is updated in the spec step.

### W5 (2026-09-27, implementer; uncommitted; owner PR02 = route c, route b fallback)

- Native (`H:/hindsight`, uncommitted, no git write): patch `TAKI-HS-013` in `TAKI_PATCHES.md`. Files:
  - new `hindsight-api-slim/hindsight_api/admin/taki_backup.py`: request model, proof read, manifest entries;
  - `admin/cli.py`: `_backup` split into `_backup_on_connection`;
  - new `api/taki_backup.py`: router;
  - `api/http.py`: mounts the router under `/ext/taki-memory`;
  - new `tests/test_taki_admin_backup.py`.
  Compatibility build stays `taki-memory-hindsight-0.9.0-d77-v1`: Core admits exactly that build, and the patch is
  additive and default-off. No migration.
- Proof and ZIP share one snapshot. The proof is the first read of the REPEATABLE READ transaction that runs every COPY.
  `manifest.json` gains `taki {version 1, backupId, proof, entries[{name, bytes, sha256}]}`. The native manifest stays v2
  and native restore ignores `taki`.
- CLI (route b): `hindsight-admin backup <out.zip> --schema <s> --taki-request native-request.json`. An invalid request
  exits 1. Without the option, output is unchanged.
- Endpoint (route c):
  - `HINDSIGHT_API_TAKI_BACKUP_ENABLED` (default false): when off nothing is mounted, so 404 `{"detail":"Not Found"}`.
  - `HINDSIGHT_API_TAKI_BACKUP_DIR` is required when enabled, otherwise startup fails.
  - `POST /ext/taki-memory/admin/backups` uses API-key auth and the supported-build check (401/503). It reads a byte-capped
    body (413) and validates it (422).
  - Single flight: a database-wide `pg_try_advisory_lock` answers 409 `backup_in_progress`.
  - It writes `taki-backup-<backupId>.zip` through an exclusive 0600 partial file and rename; an existing target gets 409
    `backup_exists`. It returns `{version, backupId, schema, proof, artifact{location:"native-host", fileName, sha256,
    bytes}}` and never the ZIP.
  - `GET .../admin/backups/{fileName}` returns `{fileName, sha256, bytes}`; a bad name gets 422, a missing file 404
    `artifact_not_found`. Refusals use `{error:"taki_backup_refused", reason}`.
  - Both routes are hidden from OpenAPI.
- Core:
  - `memory/hindsight/hindsight-backup-client.ts`: strict wire schemas, `createNativeBackup` / `nativeBackupDigest`, mixed
    into `createHindsightClient`.
  - `memory/hindsight-backup/hindsight-backup-native-route.ts`: the production route over the live connection.
    - A non-ready connection, or the absent route's 404, → `ROUTE_UNAVAILABLE`.
    - A 409 refusal → `NATIVE_FAILED`, with the reason logged.
    - Other client errors propagate to the capture's `NATIVE_FAILED` mapping, with the sanitized cause logged.
    - The proof is `HindsightBackupNativeProofSchema` of the native body plus the ZIP digest, and the echoed backupId must
      match.
  - `boot/hindsight-backup-boot.ts` wires the route. `composeHindsightBackup` takes `config` plus an optional injected
    `client`, and `main.ts` and the journey fixture were updated. The activation transport answers the backup routes as
    absent, which is the native default.
- No new closed code for `backup_in_progress`: Desktop `BACKUP_ERROR_LABEL` is an exhaustive record in `apps/desktop`,
  which this wave must not touch. A dedicated busy code is a Shared + Desktop follow-up.
- D92 closed: `backup.verify` reads back the native-host ZIP digest via `route.readBack`.
  - A changed or missing ZIP → `ARTIFACT_INVALID` with `verifiedAt` null.
  - Route unavailable or native failure → that code, with the manifest untouched.
  - `docs/deferred-decisions.md` D92 is marked DONE.
- Tests:
  - native: `test_taki_admin_backup.py` 13 cases, together with `test_admin_backup_restore.py` and
    `test_taki_extension_contract.py` 35 passed, offline, on an owned pg0 instance that was then removed (other
    `~/.pg0/instances` untouched).
  - Core: `hindsight-backup-native-route.test.ts` (12 cases); verify native-host read-back cases; the production-route
    capture test now asserts nothing is listed while the endpoint is off.
- Gates:
  - native: scoped Ruff check/format and scoped `ty` clean on changed files; full API `ruff check .` clean; whole-package
    `ty` = the unchanged 27 Windows/MLX baseline diagnostics. OpenAPI regenerated to temp, byte-identical with the flag
    off and on (sha256 `582b83b3…`).
  - TakiAgent: `pnpm typecheck` and `pnpm lint` green; Shared 60 / 543; Core 422 / 3378 (+1 skipped); `git diff --check`
    clean.
  - Isolated boot (port 3990): migrations 1..50, 0 fetches, backup kinds refused (not unknown), exit 0.
- Not run:
  - native: the auto-fixing `scripts/hooks/lint.sh` (would rewrite unrelated files), the full native pytest suite, Oracle,
    a live flag-on deployment;
  - the Desktop test/build (Desktop is not touched);
  - the W6 restore drill.
- Spec follow-up: wording that says the native route is "unavailable until W5" needs the update-spec step.

### Leader notes after W5 (2026-09-27)

- Leader gate rerun found one `tsc` error the report missed (`RefusalSchema` widened the refusal reason to `string`); fixed by
  making the helper generic, then typecheck, lint, Shared 543, Core 422 / 3378 (+1 skipped), `git diff --check` and the
  isolated boot (port 4992, migrations 1..50, 0 fetches, exit 0) passed.
- Ruling: the native compatibility build stays `taki-memory-hindsight-0.9.0-d77-v1`. TAKI-HS-013 is additive and off by
  default; Core discovers a build without it by the absent-route 404 (`ROUTE_UNAVAILABLE`), while a bump would make Core
  refuse the owner's running instance until a redeploy. Bump together with Shared when a patch changes existing behavior.
- Ruling: no dedicated busy code. Core's exclusive `hindsight-backup` family already serializes captures, so a native
  `backup_in_progress` only means a concurrent operator CLI or second Core; `NATIVE_FAILED` with the logged reason is truthful.
- For the formal check: the native backup compresses on the API event loop (sync `zipfile`), so native reads stall for the
  compression time during a capture; acceptable at owner scale, the check judges whether it needs `to_thread`.

### W6 (2026-09-27)

- AC11 restore drill: `research/restore-drill-2026-09-27.md`; harness and evidence in `research/restore-drill/`
  (`node restore-drill.mjs`). Run 7 on the final code: all 12 steps passed.
  - Steps 1-2: activation, then an M1 write. Step 3: route b, CLI `--taki-request`, inbox, admit, verify.
  - Step 4: an M2 write. Step 5: M3 lands natively while Core stays `submitted`. Step 6: route c, capture then verify.
  - Step 8: fresh pg0 with migrate, restore, `repair-bank --all` and `decommission-workers`. The restored native rows
    equal the capture-time rows, and Core runs on the captured `core.sqlite`.
  - Step 9: read-back matched. Step 10: M3 completed with 0 retain POSTs and no new native documents, units, receipts or
    async operations. Step 11: recall found M1-M3, and verify passed on the restored host.
  - Step 12: Core from backup #2 against native from backup #1 gave `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED` with 0
    `/snapshots` calls and unchanged checkpoints.
  - Cleanup: the pg0 registry is unchanged, `~/.takiagent` is unchanged, and no processes or listeners are left.
- Core defects found and fixed, each with a test that fails without the fix:
  - `memory-coordinator.ts` + `memory-capability-snapshot.ts` (`writableMemoryCapabilities`). A Run may write once its
    own recall lifted vector health to `ready`. Before, the first writing Run after every boot got "memory capabilities
    are stale". A weaker state than admitted still refuses, and drift during the write stays unknown. The spec line in
    `quality-guidelines.md` was updated.
  - `hindsight-application-sync-runner.ts`. A `state_reset_required` whose native checkpoint is behind Core's is now a
    rollback, not a rebuild. R7 had been wired only into the plain runner, and production uses the application-aware one.
    Run 4 showed 3 `/snapshots` calls before this fix.
- Gates: `pnpm typecheck` and `pnpm lint` green; Core 422 / 3380 (+1 skipped); `git diff --check` clean. No native change.
- Seen, not fixed: native `application-state/hydrate` sometimes returns 500 (`SerializationError`, a repeatable-read
  write with no retry). The Run's recall then degrades, and per the spec that Run refuses its writes. It hit step 5 in
  runs 5 and 6, not in run 7.
- For the leader: the capture operation reads `outcome_unknown` on a restored copy; pending writes finish only through
  `replica.sync`; a rollback failure says `automatic_retry_scheduled`.

### W6 follow-up (2026-09-27)

- A, native `TAKI-HS-014` (uncommitted in `H:/hindsight`; recorded in `TAKI_PATCHES.md`; build identity unchanged,
  bug fix with no contract change):
  - `engine/application_state/service.py`: `run` retries only repeatable-read runs (hydrate, snapshots, pages, changes,
    status reads) on `SerializationError` / `DeadlockDetectedError`. 3 attempts in total, jittered backoff. The last error
    surfaces unchanged. Write (read-committed) runs are not retried.
  - Idempotent per attempt: the retried bodies only use the transaction's own connection. Nothing leaves the transaction
    before commit, so an aborted attempt leaves nothing behind.
  - New `tests/test_taki_application_state_retry.py`, 3 cases: one failure commits exactly once; a persistent failure
    raises after 3 attempts; a write run is attempted once. The first two fail without the retry.
  - With 7 related application-state test files: 50 passed, 1 skipped. Scoped Ruff check/format and ty pass.
  - Owned pg0 instance created and removed; the registry is unchanged.
- B, Core rollback hold: `db/hindsight-replica-schedule-state.ts`. A failure with `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`
  reports `explicit_retry_required` and sets no retry. While that code is current, interval, retry and catch-up runs
  are not due and no wake is armed. Reconfiguring keeps `explicit_retry_required`. A manual `replica.sync` still runs and
  refuses the same way, and a success clears the hold. Scoped to that one code: the failure path persists only the code,
  not `retryable`. The other non-retryable codes (authentication, disabled connection, version) clear after an operator
  config fix, and the timed retry then picks that up. Holding them too would change existing behavior beyond the ruling.
  Test in `hindsight-replica-scheduler-repo.test.ts`; it fails without the fix.
- Gates: `pnpm typecheck` and `pnpm lint` green; Core 422 / 3381 (+1 skipped); `git diff --check` clean.

### Leader notes after W6 (2026-09-27)

- Rulings on the W6 questions: (1) keep the write-time vector-health rule (lifted to `ready` only); (2) native hydrate
  serialization failures are fixed now as TAKI-HS-014; (3) on a restored host the copied in-progress `backup.capture` row
  settling `outcome_unknown` is truthful (the artifact was taken during that operation) and is documented in the spec, the
  sealed manifest stays the backup's own truth; (4) a rollback holds the Bank for explicit runs; (5) a restored Pending
  completing on the next replica run (scheduler interval or an explicit `replica.sync`) is accepted and documented.
- Leader gate rerun after the follow-up: typecheck, lint, Core 422 / 3381 (+1 skipped), `git diff --check` passed.
