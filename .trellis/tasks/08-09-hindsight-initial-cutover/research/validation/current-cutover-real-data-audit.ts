/**
 * INPUT:  the authorized SQLite copy and its prior content-free source audit
 * OUTPUT: current migrations plus proof that B2, Canonical records and authority bytes are unchanged
 * POS:    task validation — uses the Core database wrapper; no original/snapshot database opens
 */
import { readFileSync } from "node:fs";
import { createCanonicalMemoryAuthorityRepo } from "../../../../../packages/core/src/db/canonical-memory-authority-repo.ts";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { openDatabase, type Database, type SqlRow, type SqlValue } from "../../../../../packages/core/src/db/sqlite.ts";
import { readMemoryAuthoritySelection } from "../../../../../packages/core/src/memory/legacy-migration/legacy-activation-repo.ts";
import { EXPECTED_EPOCH_ID, OWNED_RUN_ID, SNAPSHOT_SHA256, RealDataMetadata, requireCondition, sha256, type SourceAudit } from "./current-cutover-real-data-state.ts";

export function openAuditedCopy(metadata: RealDataMetadata): Database {
  if (!metadata.state) initializeAudit(metadata);
  const db = openDatabase({ path: metadata.path, migrations: MIGRATIONS,
    onMigrated: (versions) => metadata.report("REAL_DATA_MIGRATIONS", { versions }) });
  try {
    requireCurrentSchema(db, metadata);
    requirePreservedSource(db, metadata);
    requireCondition(db.prepare("PRAGMA quick_check").all().every((row) => row.quick_check === "ok"), "REAL_DATA_SQLITE_INTEGRITY");
    requireCondition(db.prepare("PRAGMA foreign_key_check").all().length === 0, "REAL_DATA_SQLITE_FOREIGN_KEYS");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function initializeAudit(metadata: RealDataMetadata): void {
  requireCondition(sha256(readFileSync(metadata.path)) === SNAPSHOT_SHA256, "REAL_DATA_SNAPSHOT_HASH_MISMATCH");
  const db = openDatabase({ path: metadata.path, migrations: [] });
  try {
    const selection = requireLocalSource(db);
    const migrations = db.prepare("SELECT * FROM migrations ORDER BY version").all();
    const sourceAudit = readSourceAudit(db);
    metadata.state = { schemaVersion: 1, runDirectoryId: OWNED_RUN_ID, sourceSnapshotSha256: SNAPSHOT_SHA256,
      sourceAudit, sourceEpochId: EXPECTED_EPOCH_ID, b2RunId: selection.runId, b2SnapshotId: selection.snapshotId,
      originalMigrationCount: migrations.length, originalMigrationSha256: hashRows(migrations), manifestId: null,
      captureId: null, endpoint: null, providerLineage: null, commands: [],
      counters: { transferDispatches: 0, verificationAdvances: 0, reopenCount: 0 },
      acknowledgements: { import: "pending", verification: "pending" },
      acknowledgementIds: { import: null, verification: null } };
    metadata.save();
    metadata.report("REAL_DATA_SOURCE_ANCHORED", { epochId: EXPECTED_EPOCH_ID, runId: selection.runId,
      snapshotId: selection.snapshotId, originalMigrationCount: migrations.length, sourceAudit });
  } finally {
    db.close();
  }
}

export function requirePreservedSource(db: Database, metadata: RealDataMetadata): SourceAudit {
  const state = metadata.state;
  requireCondition(state, "REAL_DATA_STATE_MISSING");
  const source = requireLocalSource(db);
  requireCondition(source.runId === state.b2RunId && source.snapshotId === state.b2SnapshotId, "REAL_DATA_SOURCE_IDENTITY_CHANGED");
  const audit = readSourceAudit(db);
  requireCondition(audit.sha256 === state.sourceAudit.sha256, "REAL_DATA_SOURCE_DIGEST_CHANGED");
  const migrations = db.prepare("SELECT * FROM migrations ORDER BY version").all().slice(0, state.originalMigrationCount);
  requireCondition(migrations.length === state.originalMigrationCount && hashRows(migrations) === state.originalMigrationSha256,
    "REAL_DATA_OLD_MIGRATION_RECEIPTS_CHANGED");
  requireCondition(Number(db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n ?? 0) === 0,
    "REAL_DATA_AUTHORITY_ACTIVATION_DETECTED");
  return audit;
}

function requireLocalSource(db: Database): { runId: string; snapshotId: string } {
  const selection = readMemoryAuthoritySelection(db);
  requireCondition(selection.mode === "canonical-local" && selection.epochId === EXPECTED_EPOCH_ID,
    "REAL_DATA_AUTHORITY_NOT_EXPECTED_LOCAL");
  requireCondition(selection.providerLineageId === null && selection.replicaCheckpointDigest === null,
    "REAL_DATA_LOCAL_AUTHORITY_REMOTE_FIELDS");
  createCanonicalMemoryAuthorityRepo(db).activeEpoch(EXPECTED_EPOCH_ID);
  const rows = db.prepare(`SELECT r.run_id,r.snapshot_id FROM memory_migration_runs r
    JOIN memory_migration_activation_receipts a ON a.run_id=r.run_id
    WHERE r.epoch_id=:epoch AND r.phase='activated' AND r.status='completed'
      AND r.snapshot_id=:snapshot AND a.transaction_id=:transaction AND a.epoch_id=:epoch`)
    .all({ epoch: EXPECTED_EPOCH_ID, snapshot: selection.snapshotId, transaction: selection.transactionId });
  requireCondition(rows.length === 1 && rows[0], "REAL_DATA_COMPLETED_B2_RUN_MISSING");
  return { runId: String(rows[0].run_id), snapshotId: String(rows[0].snapshot_id) };
}

export function readSourceAudit(db: Database): SourceAudit {
  const names = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND
    (name LIKE 'memory_migration_%' OR name LIKE 'canonical_memory_%'
      OR name='memory_authority_selection' OR name='taki_memory_blocks') ORDER BY name`).all();
  const tables = names.map(({ name }) => {
    const table = String(name);
    requireCondition(/^[a-z][a-z0-9_]*$/.test(table), "REAL_DATA_TABLE_NAME_INVALID");
    const rows = db.prepare(`SELECT * FROM "${table}"`).all().map((row) => sourceAuditRow(table, row));
    return { table, count: rows.length, sha256: hashRows(rows) };
  });
  const digest = (predicate: (table: string) => boolean) => sha256(JSON.stringify(tables.filter((item) => predicate(item.table))));
  return { tables, b2Sha256: digest((table) => table.startsWith("memory_migration_")),
    canonicalSha256: digest((table) => table.startsWith("canonical_memory_")),
    authoritySha256: digest((table) => table === "memory_authority_selection" || table.startsWith("canonical_memory_authority_")),
    blocksSha256: digest((table) => table === "taki_memory_blocks"), sha256: sha256(JSON.stringify(tables)) };
}

function sourceAuditRow(table: string, row: SqlRow): SqlRow {
  if (table !== "memory_authority_selection") return row;
  const original = { ...row };
  // The observed early-023 schema has neither field. Its approved forward convergence adds NULLs;
  // preserve the original columns exactly and independently reject non-NULL remote authority fields.
  for (const field of ["provider_lineage_id", "replica_checkpoint_digest"]) {
    if (original[field] === null) delete original[field];
  }
  return original;
}

function requireCurrentSchema(db: Database, metadata: RealDataMetadata): void {
  const required = [
    ["memory_authority_selection", ["provider_lineage_id", "replica_checkpoint_digest"]],
    ["hindsight_import_operations", ["content_identity", "provider_content_hash", "lease_fence"]],
    ["hindsight_cutover_runs", []], ["hindsight_replica_staging_runs", []], ["hindsight_replica_staging_records", []],
    ["hindsight_replica_records", []], ["hindsight_replica_checkpoints", []],
    ["hindsight_authority_activation_receipts", []], ["hindsight_authority_bank_receipts", []],
  ] as const;
  const gaps = required.flatMap(([table, expected]) => {
    const columns = db.prepare("SELECT name FROM pragma_table_info(:table)").all({ table }).map((row) => String(row.name));
    if (!columns.length) return [{ table, code: "missing_table", columns: [] as string[] }];
    const missing = expected.filter((column) => !columns.includes(column));
    return missing.length ? [{ table, code: "missing_columns", columns: missing }] : [];
  });
  if (gaps.length) {
    metadata.report("REAL_DATA_SCHEMA_GAPS", { gapCount: gaps.length, gapDigest: sha256(JSON.stringify(gaps)), gaps,
      sourceSha256: readSourceAudit(db).sha256 });
    throw new Error("REAL_DATA_B4_SCHEMA_MISSING");
  }
}

/** Hash sorted complete row encodings, including opaque BLOB bytes and multiplicity, without exporting their content. */
function hashRows(rows: SqlRow[]): string {
  const encoded = rows.map((row) => JSON.stringify(Object.keys(row).sort().map((key) => [key, encodeSqlValue(row[key])]))).sort();
  return sha256(JSON.stringify(encoded));
}

function encodeSqlValue(value: SqlValue | undefined): unknown {
  if (value instanceof Uint8Array) return ["blob", Buffer.from(value).toString("hex")];
  if (typeof value === "bigint") return ["integer", value.toString()];
  return [typeof value, value];
}
