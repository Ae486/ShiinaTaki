# SQLite Migration Lineage and Convergence

Parent: [Database Guidelines](./database-guidelines.md).

## 1. Scope / Trigger

- Trigger: two long-lived branches add SQLite migrations after the same shared base, or a merge discovers that one
  numeric version represented different schemas in databases already exercised by either branch.
- Treat an applied migration number as immutable history. Renaming files in Git does not rename versions already
  recorded in a user's `migrations` table.

## 2. Signatures

- Migration module: `db/migrations/NNN-description.ts` exporting `Migration { version, sql, ensureNullableTextColumns?, schemaBranches? }`.
- Exact schema branch: `MigrationSchemaBranch { name, schema: readonly MigrationSchemaObject[], absentObjects, replacedTables?, emptyTables?, sql }`, where each schema object declares `type`, `name` and its complete constant SQL.
- Registry: `MIGRATIONS` in `db/migrations/index-list.ts`, strictly ascending and containing one entry per version.
- Compatibility bridge: a new higher-numbered migration whose idempotent SQL guarantees the union of both historical
  schemas without deleting or rewriting either lineage.

## 3. Contracts

- Before assigning a migration version, compare the target branch registry and every branch expected to merge before
  release. Never reserve a number only in a local task document.
- If conflicting versions have reached a real database, choose one canonical forward numbering for new installs and
  append a convergence migration after both histories. Use additive `IF NOT EXISTS` DDL where the bridge must tolerate
  either schema already being present.
- The migration runner remains max-version based. Therefore the convergence sequence must explicitly create anything
  skipped by the historical max; it cannot rely on replaying a lower version.
- Conditional column guards run before `sql`, followed by the receipt, all inside that migration's synchronous
  transaction. Only an ordinary unconstrained bare `TEXT` declaration is accepted: nullable, no default, non-PK and
  non-generated. `pragma_table_xinfo` alone omits CHECK/UNIQUE/FK/COLLATE constraints; inspect the declaration and
  relevant constraints conservatively. Explicit NULL or an unrecognized declaration is refused, not guessed safe.
- Main 035 (Pending Memory) and historical T4 035 (Timeline presentation) converge through 036; 037/038 are the B4
  coverage/source-evidence tail. Preserve Timeline values, raw Pending JSON, sequence watermarks and old receipts.
- When the same recorded version also changed constraints or identities, additive column checks alone are insufficient.
  `schemaBranches` must recognize exactly one complete known SQL signature and its required absent objects before DDL.
  SQL token normalization preserves quoted literals; equivalent formatting does not make different CHECK/default values
  compatible. Unknown attached indexes/triggers, external incoming foreign keys and referencing views/triggers must not
  be silently lost when `replacedTables` are rebuilt. `emptyTables` gates forbid inventing mappings for historical rows.
  Branch selection, guarded SQL, ordinary migration SQL and the new receipt run in one transaction, including rollback
  on SQL, receipt or COMMIT failure. The runner still does not replay any lower recorded version.
- Actual-data validation found an early applied 023 with a Local-only marker, old `content_hash` import identities and
  seven missing B4 tables. Append-only 040 upgrades the precisely recognized early shape only when both old import
  tables are empty; it preserves original marker column bytes, adds NULL native fields and keeps Local authority.
  Already-current 023 is a no-op, including nonempty modern imports and active Hindsight markers. Unknown/partial
  schemas or nonempty early imports refuse atomically until an explicit, evidence-backed identity mapping exists.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Conflict found before either migration ran anywhere | Renumber one branch before merge and update tests/registry. |
| Both meanings of a version reached developer or user databases | Preserve recorded history and add a higher convergence migration. |
| Bridge DDL fails when one lineage already owns a table/index | Use additive idempotent DDL or an exact declared schema branch with proven preservation; never discard an unrecognized object. |
| Applied version matches but its table constraints/identity columns differ | Identify the complete old schema; append a guarded bridge without rewriting old receipts. |
| Early import rows lack proven current identity/hash/lease mappings | Refuse the upgrade atomically; do not synthesize defaults or clear the rows. |
| Registry contains duplicate or non-ascending versions | Fail review; migration order is not merge-ready. |
| Old-lineage reopen lacks any schema from the merged product | Fail the migration gate and add/repair the convergence bridge. |

## 5. Good/Base/Bad Cases

- Good: simulate each historical lineage in a temporary file, reopen with the merged registry, and prove every required
  table plus the final migration version exists.
- Base: a fresh database applies the canonical ordered registry once and a second open applies nothing.
- Bad: mechanically rename `017-feature-a.ts` to `018-feature-a.ts` after a database recorded version 17, or resolve the
  registry conflict with whole-file ours/theirs selection.

## 6. Tests Required

- Focused tests for every renumbered migration and the convergence migration.
- Temporary-file reopen tests for lineage A, lineage B, and a fresh install; assert final versions and required tables.
- Full Core tests plus a real Core boot against an isolated data directory after synchronization.
- `git diff --check` and a registry review proving unique, ascending versions and matching module names/exports.

## 7. Wrong vs Correct

```ts
// Wrong: version 17 now means a different schema to databases that already recorded it.
export const skillMigration = { version: 17, sql: "CREATE TABLE skill_packages (...)" };

// Correct: preserve the canonical sequence and append an idempotent bridge for historical databases.
export const skillMigration = { version: 19, sql: "CREATE TABLE IF NOT EXISTS skill_packages (...)" };
export const convergenceMigration = { version: 20, sql: canonicalMemoryMigration.sql };
```
