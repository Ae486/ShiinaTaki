/**
 * INPUT:  B4 source/run identities, Hindsight operation state, and fact mappings
 * OUTPUT: lease-fenced CAS repository for resumable import receipts and one-to-many results
 * POS:    core/memory/hindsight — migration-only durable state; never used by ordinary memory tools
 */
import type { Database, SqlRow } from "../../db/sqlite.ts";
import type { HindsightCutoverLease } from "../../db/hindsight-cutover-run-repo.ts";

export type ImportStatus = "pending" | "submitted" | "processing" | "completed" | "mapped" | "failed" | "cancelled" | "conflict" | "excluded";
export interface ImportOperationInput { lease: HindsightCutoverLease; sourceId: string; bankId: string; documentId: string; operationIdentity: string; remoteOperationId: string; contentIdentity: string; providerContentHash: string; zeroFactAllowed: boolean; now: string }
export interface ImportOperation { [key: string]: string | number | boolean | null | undefined; runId: string; sourceId: string; bankId: string; documentId: string; operationIdentity: string; remoteOperationId: string; contentIdentity: string; providerContentHash: string; leaseFence: number; attemptNo: number; status: ImportStatus; operationResultHash: string | null; derivedUnitCount: number | null; extractionErrorCount: number | null; mappingComplete: boolean; zeroFactAllowed: boolean; diagnosticCode: string | null; updatedAt: string }
export interface FactMapping { factOrdinal: number; factId: string; revision: number; payloadHash: string }

export interface HindsightImportLedgerRepo {
  ensureOperation(input: ImportOperationInput): ImportOperation;
  beginAttempt(input: { lease: HindsightCutoverLease; sourceId: string; now: string }): ImportOperation;
  markOperation(input: { lease: HindsightCutoverLease; sourceId: string; status: ImportStatus; resultHash?: string | null; derivedUnitCount?: number | null; extractionErrorCount?: number | null; diagnosticCode?: string | null; now: string }): ImportOperation;
  setMappings(input: { lease: HindsightCutoverLease; sourceId: string; mappings: FactMapping[]; now: string }): ImportOperation;
  read(runId: string, sourceId: string): ImportOperation | undefined;
  mappings(runId: string, sourceId: string): FactMapping[];
}

export function createHindsightImportLedgerRepo(db: Database): HindsightImportLedgerRepo {
  return {
    ensureOperation: (input) => ensureOperation(db, input),
    beginAttempt: (input) => beginAttempt(db, input),
    markOperation: (input) => markOperation(db, input),
    setMappings: (input) => setMappings(db, input),
    read: (runId, sourceId) => read(db, runId, sourceId),
    mappings: (runId, sourceId) => mappings(db, runId, sourceId),
  };
}

function ensureOperation(db: Database, input: ImportOperationInput): ImportOperation {
  assertLease(db, input.lease, input.now);
  const existing = read(db, input.lease.runId, input.sourceId);
  if (existing) {
    if (existing.contentIdentity !== input.contentIdentity || existing.providerContentHash !== input.providerContentHash || existing.documentId !== input.documentId || existing.remoteOperationId !== input.remoteOperationId) throw new Error("HINDSIGHT_IMPORT_CONFLICT");
    if (existing.leaseFence !== input.lease.fence) db.prepare("UPDATE hindsight_import_operations SET lease_fence=:fence,updated_at=:now WHERE run_id=:run AND source_id=:source").run({ fence: input.lease.fence, now: input.now, run: input.lease.runId, source: input.sourceId });
    return required(read(db, input.lease.runId, input.sourceId));
  }
  db.prepare(`INSERT INTO hindsight_import_operations
    (run_id,source_id,bank_id,document_id,operation_identity,remote_operation_id,content_identity,provider_content_hash,lease_fence,status,zero_fact_allowed,updated_at)
    VALUES (:run,:source,:bank,:document,:identity,:remote,:content_identity,:provider_hash,:fence,'pending',:zero,:now)`)
    .run({ run: input.lease.runId, source: input.sourceId, bank: input.bankId, document: input.documentId, identity: input.operationIdentity, remote: input.remoteOperationId, content_identity: input.contentIdentity, provider_hash: input.providerContentHash, fence: input.lease.fence, zero: input.zeroFactAllowed ? 1 : 0, now: input.now });
  return required(read(db, input.lease.runId, input.sourceId));
}

function beginAttempt(db: Database, input: { lease: HindsightCutoverLease; sourceId: string; now: string }): ImportOperation {
  assertLease(db, input.lease, input.now);
  const result = db.prepare(`UPDATE hindsight_import_operations SET attempt_no=attempt_no+1,status='processing',updated_at=:now
    WHERE run_id=:run AND source_id=:source AND lease_fence=:fence AND status NOT IN ('mapped','excluded')`).run({ run: input.lease.runId, source: input.sourceId, fence: input.lease.fence, now: input.now });
  if (result.changes !== 1) throw new Error("HINDSIGHT_IMPORT_STATE_CONFLICT");
  return required(read(db, input.lease.runId, input.sourceId));
}

function markOperation(db: Database, input: { lease: HindsightCutoverLease; sourceId: string; status: ImportStatus; resultHash?: string | null; derivedUnitCount?: number | null; extractionErrorCount?: number | null; diagnosticCode?: string | null; now: string }): ImportOperation {
  assertLease(db, input.lease, input.now);
  const result = db.prepare(`UPDATE hindsight_import_operations SET status=:status,operation_result_hash=:result_hash,
    derived_unit_count=:count,extraction_error_count=:errors,diagnostic_code=:diagnostic,updated_at=:now
    WHERE run_id=:run AND source_id=:source AND lease_fence=:fence AND status NOT IN ('mapped','excluded')`)
    .run({ status: input.status, result_hash: input.resultHash ?? null, count: input.derivedUnitCount ?? null, errors: input.extractionErrorCount ?? null, diagnostic: input.diagnosticCode ?? null, now: input.now, run: input.lease.runId, source: input.sourceId, fence: input.lease.fence });
  if (result.changes !== 1) throw new Error("HINDSIGHT_IMPORT_STATE_CONFLICT");
  return required(read(db, input.lease.runId, input.sourceId));
}

function setMappings(db: Database, input: { lease: HindsightCutoverLease; sourceId: string; mappings: FactMapping[]; now: string }): ImportOperation {
  db.transaction(() => {
    assertLease(db, input.lease, input.now);
    const operation = required(read(db, input.lease.runId, input.sourceId));
    if (operation.leaseFence !== input.lease.fence) throw new Error("LEASE_LOST");
    if (operation.status === "mapped" || operation.status === "excluded") return;
    db.prepare("DELETE FROM hindsight_import_facts WHERE run_id=:run AND source_id=:source").run({ run: input.lease.runId, source: input.sourceId });
    const insert = db.prepare(`INSERT INTO hindsight_import_facts (run_id,source_id,fact_ordinal,fact_id,revision,payload_hash)
      VALUES (:run,:source,:ordinal,:fact,:revision,:hash)`);
    input.mappings.forEach((mapping) => insert.run({ run: input.lease.runId, source: input.sourceId, ordinal: mapping.factOrdinal, fact: mapping.factId, revision: mapping.revision, hash: mapping.payloadHash }));
    db.prepare(`UPDATE hindsight_import_operations SET status='mapped',mapping_complete=1,derived_unit_count=:count,updated_at=:now
      WHERE run_id=:run AND source_id=:source AND lease_fence=:fence`).run({ count: input.mappings.length, now: input.now, run: input.lease.runId, source: input.sourceId, fence: input.lease.fence });
  });
  return required(read(db, input.lease.runId, input.sourceId));
}

function read(db: Database, runId: string, sourceId: string): ImportOperation | undefined {
  const row = db.prepare("SELECT * FROM hindsight_import_operations WHERE run_id=:run AND source_id=:source").get({ run: runId, source: sourceId });
  return row ? parseOperation(row) : undefined;
}
function mappings(db: Database, runId: string, sourceId: string): FactMapping[] {
  return db.prepare("SELECT fact_ordinal,fact_id,revision,payload_hash FROM hindsight_import_facts WHERE run_id=:run AND source_id=:source ORDER BY fact_ordinal").all({ run: runId, source: sourceId }).map((row) => ({ factOrdinal: Number(row.fact_ordinal), factId: String(row.fact_id), revision: Number(row.revision), payloadHash: String(row.payload_hash) }));
}
function parseOperation(row: SqlRow): ImportOperation {
  return { runId: String(row.run_id), sourceId: String(row.source_id), bankId: String(row.bank_id), documentId: String(row.document_id), operationIdentity: String(row.operation_identity), remoteOperationId: String(row.remote_operation_id), contentIdentity: String(row.content_identity), providerContentHash: String(row.provider_content_hash), leaseFence: Number(row.lease_fence), attemptNo: Number(row.attempt_no), status: String(row.status) as ImportStatus, operationResultHash: row.operation_result_hash === null ? null : String(row.operation_result_hash), derivedUnitCount: row.derived_unit_count === null ? null : Number(row.derived_unit_count), extractionErrorCount: row.extraction_error_count === null ? null : Number(row.extraction_error_count), mappingComplete: Number(row.mapping_complete) === 1, zeroFactAllowed: Number(row.zero_fact_allowed) === 1, diagnosticCode: row.diagnostic_code === null ? null : String(row.diagnostic_code), updatedAt: String(row.updated_at) };
}
function required(value: ImportOperation | undefined): ImportOperation { if (!value) throw new Error("HINDSIGHT_IMPORT_NOT_FOUND"); return value; }
function assertLease(db: Database, lease: HindsightCutoverLease, now: string): void {
  const row = db.prepare(`SELECT 1 AS valid FROM hindsight_cutover_runs WHERE run_id=:run AND lease_owner=:owner
    AND lease_fence=:fence AND lease_expires_at>:now AND status IN ('running','ready')`).get({ run: lease.runId, owner: lease.owner, fence: lease.fence, now });
  if (!row) throw new Error("LEASE_LOST");
}
