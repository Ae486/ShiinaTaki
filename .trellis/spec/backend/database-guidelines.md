# Database Guidelines

## Engine and access

- SQLite via **`node:sqlite`** (Node 24 built-in), wrapped in `packages/core/src/db/`. The wrapper is the only module importing `node:sqlite` — keeps a `better-sqlite3` swap trivial if stability disappoints.
- **Single writer**: only the Agent Core opens the database. Shell, Pet UI, and future mobile nodes query/subscribe over the WS API (ADR 0004). Never open the DB file from Rust or the UI.
- DB file lives in the app data root (`%USERPROFILE%\.takiagent\`, beside the Workspace, not inside it), never in the repo or install dir.

## Schema conventions

- Tables and columns: `snake_case`. Timestamps: `*_at`, ISO-8601 UTC strings.
- Migrations: numbered TS modules `db/migrations/NNN-description.ts`, each exporting `{ version, sql }` (plain SQL string constants — keeps the db layer fs-free and bundle-safe), aggregated in one explicit ordered list (no fs/glob discovery), applied at startup each inside a transaction, tracked in a `migrations` table. No ORM — hand-written SQL in repository modules (`db/timeline-repo.ts`, `db/memory-repo.ts`), one repo per aggregate.
- Memory search: SQLite **FTS5** virtual table indexing Workspace markdown files; markdown is the source of truth, the index is rebuildable.

## Patterns

- Repos expose typed functions; zod-parse rows at boundaries where shape matters.
- Every externally-relevant write emits a WS event after commit (this is how desktop→phone real-time works). Write + event emission live together in the repo/service layer.
- No transactions across async gaps; keep them synchronous and short.

## Scenario: Parallel Branch Migration Convergence

### 1. Scope / Trigger

- Trigger: two long-lived branches add SQLite migrations after the same shared base, or a merge discovers that one
  numeric version represented different schemas in databases already exercised by either branch.
- Treat an applied migration number as immutable history. Renaming files in Git does not rename versions already
  recorded in a user's `migrations` table.

### 2. Signatures

- Migration module: `db/migrations/NNN-description.ts` exporting `{ version: NNN, sql: string }`.
- Registry: `MIGRATIONS` in `db/migrations/index-list.ts`, strictly ascending and containing one entry per version.
- Compatibility bridge: a new higher-numbered migration whose idempotent SQL guarantees the union of both historical
  schemas without deleting or rewriting either lineage.

### 3. Contracts

- Before assigning a migration version, compare the target branch registry and every branch expected to merge before
  release. Never reserve a number only in a local task document.
- If conflicting versions have reached a real database, choose one canonical forward numbering for new installs and
  append a convergence migration after both histories. Use additive `IF NOT EXISTS` DDL where the bridge must tolerate
  either schema already being present.
- The migration runner remains max-version based. Therefore the convergence sequence must explicitly create anything
  skipped by the historical max; it cannot rely on replaying a lower version.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Conflict found before either migration ran anywhere | Renumber one branch before merge and update tests/registry. |
| Both meanings of a version reached developer or user databases | Preserve recorded history and add a higher convergence migration. |
| Bridge DDL fails when one lineage already owns a table/index | Make the bridge idempotent; do not drop or replace the existing object. |
| Registry contains duplicate or non-ascending versions | Fail review; migration order is not merge-ready. |
| Old-lineage reopen lacks any schema from the merged product | Fail the migration gate and add/repair the convergence bridge. |

### 5. Good/Base/Bad Cases

- Good: simulate each historical lineage in a temporary file, reopen with the merged registry, and prove every required
  table plus the final migration version exists.
- Base: a fresh database applies the canonical ordered registry once and a second open applies nothing.
- Bad: mechanically rename `017-feature-a.ts` to `018-feature-a.ts` after a database recorded version 17, or resolve the
  registry conflict with whole-file ours/theirs selection.

### 6. Tests Required

- Focused tests for every renumbered migration and the convergence migration.
- Temporary-file reopen tests for lineage A, lineage B, and a fresh install; assert final versions and required tables.
- Full Core tests plus a real Core boot against an isolated data directory after synchronization.
- `git diff --check` and a registry review proving unique, ascending versions and matching module names/exports.

### 7. Wrong vs Correct

```ts
// Wrong: version 17 now means a different schema to databases that already recorded it.
export const skillMigration = { version: 17, sql: "CREATE TABLE skill_packages (...)" };

// Correct: preserve the canonical sequence and append an idempotent bridge for historical databases.
export const skillMigration = { version: 19, sql: "CREATE TABLE IF NOT EXISTS skill_packages (...)" };
export const convergenceMigration = { version: 20, sql: canonicalMemoryMigration.sql };
```

## Scenario: Legacy Memory Migration and Authority Cutover

### 1. Scope / Trigger

- Trigger: converting mutable legacy Markdown entries/Blocks into canonical Local SQLite records and changing the
  runtime authority marker. This is cross-layer storage/runtime work and must remain one-time, non-destructive, and
  resumable.
- The durable schema is migration `021-memory-legacy-migration.ts`; migration code is additive and never edits an
  applied migration. The migration runner is an operator/offline capability, not a normal memory adapter.

### 2. Signatures

- Migration export: `memoryLegacyMigration021: Migration = { version: 21, sql }`, registered in the ascending
  `MIGRATIONS` list.
- Runner boundary: `createLegacyMigrationRunner({ db, destinationRoot, fence, now?, onActivated? })` exposes
  `dryRun(root)`, `stage({ workspaceRoot, owner })`, `resume({ runId, owner })`, `status(runId)`,
  `verify(runId)`, `exceptions({ runId, cursor, limit })`, `exclude({ runId, sourceId, reason, actor })`, and
  `activate({ runId, workspaceRoot, timeoutMs })`.
- Operator methods: `memory.migration.dryRun|stage|resume|status|verify|exceptions|exclude|activate`; each has a
  strict shared Zod parameter/result schema and `roles: ["operator"]`.
- Durable tables: `memory_migration_runs`, `memory_migration_sources`, `memory_migration_attempts`,
  `memory_migration_results`, `memory_migration_exclusions`, `memory_migration_activation_receipts`, and the
  singleton `memory_authority_selection`.

### 3. Contracts

- Snapshot contract: stage publishes one complete immutable, hash-addressed snapshot and manifest before normalization;
  each source is represented once by `(relative_path, raw_sha256)`. Raw bytes stay in the snapshot, not SQLite. Dry-run
  may use a private temporary copy but returns with no durable snapshot, ledger, canonical, marker, or Markdown change.
- Ledger contract: every source records phase/disposition, attempt number, closed diagnostic code, exclusion decision,
  canonical source/document/operation IDs, explicit `result_count`, and ordered result IDs. `converted-zero`,
  `converted-one`, and `converted-many` are distinct resolved outcomes; zero never manufactures a Local unit.
- Import contract: the migration-only importer derives domain-separated deterministic IDs and payload hashes, replays an
  identical operation, and raises `IMPORT_CONFLICT` for a destination or payload-hash mismatch. It must not call public
  Local `retain`, generate random IDs, replace a conflicting document, or impersonate `user`/`background` writers.
- Authority contract: startup reads and validates `memory_authority_selection` before constructing legacy memory,
  reconcilers, sweepers, prompts, or tools. The marker starts as `legacy-markdown`; only a verified run may select
  `canonical-local` with an epoch, snapshot, transaction receipt, and lease fence. Canonical activation retires every
  mutable Markdown read/write surface; there is no post-activation fallback or dual-write.
- Activation transaction contract: snapshot hashing, fence drain, and readiness checks occur before one short synchronous
  SQLite transaction. That transaction performs no filesystem I/O and crosses no async gap; it rechecks lease fencing,
  manifest/readiness digests, epoch, and unresolved rows before updating the marker and receipt together.
- Operator loading contract: the method factory dynamically imports and constructs the migration runner per request;
  the runner is absent from ordinary startup/runtime memory graphs and is discarded after the operator operation.
- Privacy contract: status/log/error payloads contain counts, opaque IDs, phase/status, and closed diagnostic codes only.
  Snapshot-relative paths are returned only by the paginated operator exceptions method; memory/Block text, queries,
  secrets, raw exceptions, and full payloads never cross the operator or log boundary.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| UTF-8 BOM, invalid UTF-8, unsupported YAML/frontmatter, unsafe placement, ownership mismatch, or bound violation | Keep source bytes untouched; persist one closed diagnostic code; leave the run blocking until explicit source-scoped exclusion. |
| Snapshot path/hash/manifest changes after the fence or at activation | Fail with `SNAPSHOT_CHANGED`; do not mutate the authority marker. |
| Lease owner/fence expired or superseded | Fail with `LEASE_LOST`; stale worker cannot write ledger, canonical rows, or activation receipt. |
| Destination row or operation exists with a different content/payload hash | Fail with `IMPORT_CONFLICT`; do not replace/invalidate the existing canonical row. |
| Result count differs from durable result rows, missing FK/Bank/FTS/readiness, or unresolved non-excluded source | Verification is false with `INTEGRITY_MISMATCH`; legacy remains authoritative. |
| Fence drain exceeds `timeoutMs` or activation transaction rolls back | Return a structured failure; reopen/retain legacy authority and preserve snapshot/ledger for resume. |
| Authority marker missing, malformed, or internally inconsistent at startup | Fail closed with sanitized `MEMORY_INTEGRITY_ERROR`; never silently fall back to Markdown. |

### 5. Good/Base/Bad Cases

- Good: a staged run publishes the immutable snapshot, deterministically imports zero/one/many outcomes, verifies all
  rows and digests, then commits marker plus receipt in one transaction; restart selects canonical Local before any
  legacy object is constructed.
- Base: a dry-run reports bounded counts and exceptional source IDs while byte-comparing ledger, canonical tables,
  marker, and Markdown before/after with no durable artifact; an interrupted run resumes with identical IDs/results.
- Bad: call public `retain` during migration, use a random memory ID, copy raw Markdown into SQLite, run filesystem
  hashing inside the activation transaction, or leave a legacy reader/writer/fallback reachable after marker commit.

### 6. Tests Required

- Migration `021` reopen test: fresh and existing databases apply versions 1..21 in order and create every ledger,
  receipt, and marker table; a second open is a no-op.
- Snapshot/normalizer/identity tests: exact raw bytes/hash/path, supported flat-frontmatter variants, closed
  diagnostics, path ownership, sanitizer refusal, deterministic canonical JSON and IDs.
- Ledger/runner tests: lease fencing, retry attempts, durable exclusions, reopen/resume determinism, zero/one/many
  result rows, dry-run zero-write cleanup, bounded exception pagination, and changed-snapshot blocking.
- Importer/converter tests: exact replay, conflict refusal, archived/empty semantics, lifecycle/policy/provenance,
  Block registry scope/order, no generic-unit/FTS Block leakage, and no public-`retain` call.
- Activation/runtime tests: fence drain/timeout, digest/readiness/epoch checks, marker-plus-receipt atomicity,
  marker-first startup, canonical-only tools/prompts/maintenance, authority-aware wrappers, and no post-activation
  Markdown reads/writes or dual tool advertisement.
- Quality/privacy gates: Shared/Core tests and typechecks, lint, isolated Core boot, `git diff --check`, task validation,
  and UTF-8/no-BOM checks. Assert logs/status/errors contain no source content, queries, secrets, or raw exceptions.

### 7. Wrong vs Correct

#### Wrong

```ts
// Ordinary runtime semantics: random IDs, replacement behavior, and a mutable fallback after cutover.
await localRetain({ text: legacyText });
if (canonicalUnavailable) return legacyMarkdown.read();
```

#### Correct

```ts
// Migration-only deterministic import, then one fenced synchronous marker transaction.
importer.importRecord({ source, record, operationId, payloadHash });
await fence.quiesce({ timeoutMs }, () => activateCanonicalLocal(db, {
  lease, manifestDigest, readinessDigest, transactionId, now,
}));
// Startup/runtime selects canonical from the persisted marker; no Markdown fallback or dual-write exists.
```
