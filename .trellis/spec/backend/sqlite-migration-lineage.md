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
- Migration054 recognizes the exact current authority marker before rebuilding it with the distinct transition receipt
  discriminator. Preserve all three old marker modes byte-for-byte, adding NULL only; never manufacture B2/B4 history.
  Unknown attached schema and SQL/receipt/COMMIT failure roll back the full marker rebuild and new evidence tables.
- Migration055 adds healthy-driver previews, native command/dispatch/observation evidence and immutable per-operation
  failures. It has already been recorded by an isolated real-corpus run; its SQL must not be retroactively changed.
- Migration056 adds exact native verification dispatches, binding the Bank, transition and current executor before
  a new verification call. A055database has no historical rows: do not backfill an inferred dispatch or interpret
  absence as non-dispatch. Recovery records only a newly required continuation after factual native evidence.
  Upgrade/reopen preserves055commands/receipts byte-for-byte; SQL, receipt and COMMIT failure roll back056atomically.

## 4. Validation & Error Matrix

Migration061 adds a singleton random 128-bit stamp and INSERT/UPDATE/DELETE invalidation triggers on the thirteen
current template, authority and paired-checkpoint dependency tables. It follows 059's SQLite-owned clock pattern;
the separate config revision retains its old meaning. The new stamp and covered rows change in the same transaction.
Rollback restores both; a different subsequent mutation generates a fresh stamp rather than reusing a counter value.
This assumes the same negligible random-identifier collision risk as other 128-bit identities, not mathematical
uniqueness. Existing receipts and current rows are unchanged by upgrade. SQL/receipt/COMMIT failure rolls back the
whole new schema. Supported pre-061 copied databases retain independent full readers without a runtime memo.
Exact current trigger definitions must be verified before using a stamp; the migration receipt alone is insufficient.

Migration057 adds immutable emergency capture/incident/surviving-evidence/quarantine/foreign-branch rows and replaces
only its named transition-admission triggers in the same transaction. Upgrade from056 and reopen preserve original
operation/intents/attempts/receipt bytes. SQL, migration-receipt and actual COMMIT failures roll back both the new
schema and replaced trigger definitions; no fabricated legacy incident or historical dispatch is backfilled.

- Applied T4 058 and 060 also have independently early definitions. Append-only 069 recognizes four combinations of
  the complete/absent 058 context group (five tables and four immutable guards) and 060 event-frontier group (one table
  and its immutable guard). Match the frozen canonical definitions plus the complete attached indexes/triggers of the
  input, execution, message, event and conversation-order anchors. Unknown declarations, partial groups and unknown
  attached contracts refuse before any DDL; neither a version receipt nor a table-name probe establishes compatibility.
- 069 uses CREATE-only frozen definitions and the existing `schemaBranches` transaction; it never replays 058's rebuild,
  validity/outbox writes or 060's source-order backfill. Preserve every existing row, receipt, sequence and schema object.
  Backfill frontiers only when their table is newly created. A terminal boundary requires a matching settled result's
  Run/Attempt/child/work identity and positive safe-integer `throughWorkSeq`. A canonical `interaction:<step>:<call>` key
  uses only same-Run/Attempt and same-work raw input receipts through that step. Check-in, malformed or otherwise unproved
  boundaries stay NULL; never cast arbitrary keys to step zero, copy current work sequence or overwrite existing frontiers.
  Migration emits no input, report, Effect or dispatch and never clears Stop. Ordinary post-migration recovery remains a
  separate operation: it may settle orphan private Runs while retaining user Stop and unknown Effect outcomes.

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
- `069-delegation-schema-convergence.test.ts` covers all four 058/060 combinations, early 058 followed by canonical 060,
  exact definitions, nonempty retained evidence/frontiers, unknown/partial refusal, receipt/SQL/COMMIT rollback, and reopen.
  Its actual SDK/repository recovery fixture reproduces missing-table failure before repair, then verifies zero-dispatch
  recovery, user-only same-work continuation in a new Run, unknown primary intents and normal new delegation/Stop.
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
