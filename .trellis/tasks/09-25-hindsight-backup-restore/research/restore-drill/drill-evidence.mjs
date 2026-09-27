/**
 * INPUT:  a drill-owned Core data dir (taki.db, backups/) and a native row census from pg_probe.py
 * OUTPUT: coreCensus() — read-only Core SQLite view (Pending rows with receipt presence, replica checkpoints, replica record
 *         counts and memory-unit texts, D77 job states, migration head); readManifest(); fileSha256(); prepareCoreCopy() —
 *         a restored Core data dir whose taki.db is a sealed backup's core.sqlite; nativeDelta() between two censuses
 * POS:    09-25-hindsight-backup-restore W6 drill — evidence readers; never opens a database for writing
 */
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function coreCensus(dataDir) {
  const db = new DatabaseSync(join(dataDir, "taki.db"), { readOnly: true });
  try {
    return {
      migrationHead: db.prepare("SELECT max(version) AS head FROM migrations").get().head,
      pending: db.prepare(`SELECT sequence, bank_id, operation_id, operation_kind, phase,
          json_extract(state_json,'$.remoteOperationId') AS remote, json_extract(state_json,'$.intent.bankGeneration') AS generation,
          coalesce(json_extract(state_json,'$.dispatch.protocol'),'legacy_native_v1') AS protocol,
          json_type(state_json,'$.nativeReceipt') AS nativeReceipt, json_type(state_json,'$.nativeResultReceipt') AS nativeResultReceipt
        FROM pending_memory ORDER BY sequence`).all().map((row) => ({ ...row })),
      checkpoints: db.prepare(`SELECT bank_id, provider_lineage_id, bank_generation, authority_epoch_id, end_cursor, snapshot_cursor
        FROM hindsight_replica_sync_checkpoints ORDER BY bank_id`).all().map((row) => ({ ...row })),
      records: db.prepare(`SELECT bank_id, object_kind, operation, count(*) AS n FROM hindsight_replica_sync_records
        GROUP BY bank_id, object_kind, operation ORDER BY 1, 2, 3`).all().map((row) => ({ ...row })),
      memoryUnitTexts: db.prepare(`SELECT bank_id, substr(coalesce(json_extract(record_json,'$.text'), json_extract(record_json,'$.content'), ''), 1, 120) AS text
        FROM hindsight_replica_sync_records WHERE object_kind='memory_unit' AND operation='upsert' ORDER BY 1, 2`).all().map((row) => ({ ...row })),
      jobs: db.prepare("SELECT state, count(*) AS n FROM hindsight_application_command_jobs GROUP BY state ORDER BY state").all().map((row) => ({ ...row })),
    };
  } finally {
    db.close();
  }
}

export function readManifest(dataDir, backupId) {
  const path = join(dataDir, "backups", backupId, "manifest.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

export function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Host custody (host-identity.json, secret-catalog.bin) comes with the dir copy; only the database is the backup's copy. */
export function prepareCoreCopy({ source, target, backupId }) {
  cpSync(source, target, { recursive: true });
  for (const name of ["taki.db", "taki.db-wal", "taki.db-shm"]) rmSync(join(target, name), { force: true });
  const core = join(target, "backups", backupId, "core.sqlite");
  copyFileSync(core, join(target, "taki.db"));
  return { coreSha256: fileSha256(core) };
}

const countOf = (rows) => (Array.isArray(rows) ? rows.reduce((sum, row) => sum + Number(row.n ?? 1), 0) : null);

/** Row-count and identity differences between two native censuses (after minus before). */
export function nativeDelta(before, after) {
  const ids = (census) => new Set((census.nativeReceipts ?? []).map((row) => `${row.bank_id}:${row.operation_kind}:${row.operation_id}`));
  const beforeIds = ids(before);
  return {
    documents: countOf(after.documents) - countOf(before.documents),
    memoryUnits: countOf(after.memoryUnits) - countOf(before.memoryUnits),
    nativeReceipts: after.nativeReceipts.length - before.nativeReceipts.length,
    newReceiptIds: [...ids(after)].filter((id) => !beforeIds.has(id)),
    asyncOperations: after.asyncOperations.length - before.asyncOperations.length,
    applicationOperations: after.applicationOperations.length - before.applicationOperations.length,
    mutationReceipts: countOf(after.mutationReceipts) - countOf(before.mutationReceipts),
  };
}
