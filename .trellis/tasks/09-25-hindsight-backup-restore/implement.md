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
