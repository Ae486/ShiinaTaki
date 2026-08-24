/**
 * INPUT:  verified staging records plus B4 import ledger mappings for one run and Bank
 * OUTPUT: exact document/fact identity and revision reconciliation or a closed blocking code
 * POS:    core/memory/hindsight — final Wave 3 integrity gate; authority promotion remains separate
 */
import type { Database } from "../../db/sqlite.ts";

export interface HindsightReplicaReconciliation {
  sourceCount: number;
  excludedCount: number;
  factCount: number;
  documentCount: number;
}

export function reconcileHindsightReplica(db: Database, input: { runId: string; bankId: string; stagingId: string }): HindsightReplicaReconciliation {
  const unresolved = Number(db.prepare(`SELECT count(*) AS n FROM hindsight_import_operations
    WHERE run_id=:run AND bank_id=:bank AND status NOT IN ('mapped','excluded')`).get({ run: input.runId, bank: input.bankId })?.n ?? 0);
  if (unresolved !== 0) fail("HINDSIGHT_IMPORT_UNRESOLVED");
  const missingDocuments = Number(db.prepare(`SELECT count(*) AS n FROM hindsight_import_operations o
    WHERE o.run_id=:run AND o.bank_id=:bank AND o.status='mapped' AND NOT EXISTS (
      SELECT 1 FROM hindsight_replica_staging_records r WHERE r.staging_id=:staging
      AND r.object_kind='document' AND r.object_id=o.document_id)`).get({ run: input.runId, bank: input.bankId, staging: input.stagingId })?.n ?? 0);
  if (missingDocuments !== 0) fail("HINDSIGHT_IMPORT_DOCUMENT_MAPPING_MISMATCH");
  const missingFacts = Number(db.prepare(`SELECT count(*) AS n FROM hindsight_import_facts f
    JOIN hindsight_import_operations o ON o.run_id=f.run_id AND o.source_id=f.source_id
    WHERE f.run_id=:run AND o.bank_id=:bank AND NOT EXISTS (
      SELECT 1 FROM hindsight_replica_staging_records r WHERE r.staging_id=:staging AND r.object_kind='memory_unit'
      AND r.object_id=f.fact_id AND r.object_revision=f.revision AND r.payload_hash=f.payload_hash)`).get({ run: input.runId, bank: input.bankId, staging: input.stagingId })?.n ?? 0);
  if (missingFacts !== 0) fail("HINDSIGHT_IMPORT_FACT_MAPPING_MISMATCH");
  const duplicateMappings = Number(db.prepare(`SELECT count(*) AS n FROM (
    SELECT fact_id FROM hindsight_import_facts f JOIN hindsight_import_operations o
      ON o.run_id=f.run_id AND o.source_id=f.source_id WHERE f.run_id=:run AND o.bank_id=:bank
      GROUP BY fact_id HAVING count(*)<>1)`).get({ run: input.runId, bank: input.bankId })?.n ?? 0);
  if (duplicateMappings !== 0) fail("HINDSIGHT_IMPORT_FACT_MAPPING_MISMATCH");
  return {
    sourceCount: Number(db.prepare("SELECT count(*) AS n FROM hindsight_import_operations WHERE run_id=:run AND bank_id=:bank").get({ run: input.runId, bank: input.bankId })?.n ?? 0),
    excludedCount: Number(db.prepare("SELECT count(*) AS n FROM hindsight_import_operations WHERE run_id=:run AND bank_id=:bank AND status='excluded'").get({ run: input.runId, bank: input.bankId })?.n ?? 0),
    factCount: Number(db.prepare(`SELECT count(*) AS n FROM hindsight_import_facts f JOIN hindsight_import_operations o
      ON o.run_id=f.run_id AND o.source_id=f.source_id WHERE f.run_id=:run AND o.bank_id=:bank`).get({ run: input.runId, bank: input.bankId })?.n ?? 0),
    documentCount: Number(db.prepare("SELECT count(*) AS n FROM hindsight_replica_staging_records WHERE staging_id=:staging AND object_kind='document'").get({ staging: input.stagingId })?.n ?? 0),
  };
}

function fail(code: string): never { throw new Error(code); }
