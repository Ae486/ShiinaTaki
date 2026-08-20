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
