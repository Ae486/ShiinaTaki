/**
 * INPUT:  migration-only canonical source/unit/policy records and structured Block projections
 * OUTPUT: deterministic idempotent inserts, exact replay, and fail-closed destination conflicts
 * POS:    core/memory/legacy-migration — offline staging writer; ordinary Local retain semantics are intentionally bypassed
 */
import type { CanonicalMemorySource, CanonicalMemoryRecord } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { canonicalJson } from "./legacy-identities.ts";
import type { LegacyBlockProjection } from "./legacy-canonical-converter.ts";

export interface LegacyCanonicalImportRepo {
  importRecord(input: { source: CanonicalMemorySource; record: CanonicalMemoryRecord; operationId: string; payloadHash: string }): "inserted" | "replayed";
  importZero(input: { source: CanonicalMemorySource; operationId: string; payloadHash: string }): "inserted" | "replayed";
  importBlock(input: LegacyBlockProjection): "inserted" | "replayed";
}

export function createLegacyCanonicalImportRepo(db: Database): LegacyCanonicalImportRepo {
  return { importRecord: (input) => importRecord(db, input), importZero: (input) => importZero(db, input), importBlock: (input) => importBlock(db, input) };
}

function importZero(db: Database, input: { source: CanonicalMemorySource; operationId: string; payloadHash: string }): "inserted" | "replayed" {
  const existingReceipt = db.prepare("SELECT request_hash FROM canonical_memory_operation_receipts WHERE authority_epoch_id=:epoch AND request_id=:request").get({ epoch: input.source.authorityEpochId, request: input.operationId });
  if (existingReceipt) { if (String(existingReceipt.request_hash) !== input.payloadHash) throw new Error("IMPORT_CONFLICT"); return "replayed"; }
  db.transaction(() => {
    insertSource(db, input.source);
    db.prepare("INSERT INTO canonical_memory_operation_receipts (authority_epoch_id,request_id,operation,request_hash,result_json,created_at) VALUES (:epoch,:request,'retain',:hash,:result,:created)")
      .run({ epoch: input.source.authorityEpochId, request: input.operationId, hash: input.payloadHash, result: canonicalJson({ memories: [] }), created: input.source.updatedAt });
  });
  return "inserted";
}

function importRecord(db: Database, input: { source: CanonicalMemorySource; record: CanonicalMemoryRecord; operationId: string; payloadHash: string }): "inserted" | "replayed" {
  const existingReceipt = db.prepare("SELECT request_hash,result_json FROM canonical_memory_operation_receipts WHERE authority_epoch_id=:epoch AND request_id=:request")
    .get({ epoch: input.source.authorityEpochId, request: input.operationId });
  if (existingReceipt) {
    if (String(existingReceipt.request_hash) !== input.payloadHash) throw new Error("IMPORT_CONFLICT");
    return "replayed";
  }
  const existing = db.prepare("SELECT content_hash,metadata_json FROM canonical_memory_sources WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:document")
    .get({ epoch: input.source.authorityEpochId, bank: input.source.bankId, document: input.source.documentId });
  if (existing && String(existing.content_hash ?? "") !== String(input.source.contentHash ?? "")) throw new Error("IMPORT_CONFLICT");
  db.transaction(() => {
    insertSource(db, input.source); if (input.record.unit.text.length > 0) { insertUnit(db, input.record); insertPolicy(db, input.record); if (input.record.unit.state === "valid") insertFts(db, input.record); }
    db.prepare("INSERT INTO canonical_memory_operation_receipts (authority_epoch_id,request_id,operation,request_hash,result_json,created_at) VALUES (:epoch,:request,'retain',:hash,:result,:created)")
      .run({ epoch: input.source.authorityEpochId, request: input.operationId, hash: input.payloadHash, result: canonicalJson({ memoryId: input.record.unit.memoryId }), created: input.source.updatedAt });
  });
  return "inserted";
}

function importBlock(db: Database, input: LegacyBlockProjection): "inserted" | "replayed" {
  const existing = db.prepare("SELECT content,revision FROM taki_memory_blocks WHERE block_id=:id AND scope_kind=:scope AND ifnull(character_id,'')=ifnull(:character,'')")
    .get({ id: input.blockId, scope: input.scopeKind, character: input.characterId });
  if (existing) { if (String(existing.content) !== input.content) throw new Error("IMPORT_CONFLICT"); return "replayed"; }
  db.prepare("INSERT INTO taki_memory_blocks (block_id,scope_kind,character_id,content,revision,updated_at) VALUES (:id,:scope,:character,:content,:revision,:updated)")
    .run({ id: input.blockId, scope: input.scopeKind, character: input.characterId, content: input.content, revision: input.revision, updated: input.updatedAt });
  return "inserted";
}

function insertSource(db: Database, source: CanonicalMemorySource): void {
  db.prepare(`INSERT OR IGNORE INTO canonical_memory_sources
    (authority_epoch_id,bank_id,document_id,content_hash,retained_text,context,tags_json,metadata_json,observation_scopes_json,provenance_json,revision,created_at,updated_at)
    VALUES (:epoch,:bank,:document,:hash,:text,:context,:tags,:metadata,:scopes,:provenance,:revision,:created,:updated)`)
    .run({ epoch: source.authorityEpochId, bank: source.bankId, document: source.documentId, hash: source.contentHash, text: source.retainedText, context: source.context, tags: JSON.stringify(source.tags), metadata: JSON.stringify(source.metadata), scopes: source.observationScopes ? JSON.stringify(source.observationScopes) : null, provenance: JSON.stringify(source.provenance), revision: source.revision, created: source.createdAt, updated: source.updatedAt });
}
function insertUnit(db: Database, record: CanonicalMemoryRecord): void {
  const unit = record.unit; db.prepare(`INSERT INTO canonical_memory_units
    (authority_epoch_id,bank_id,memory_id,document_id,chunk_id,text,context,fact_type,state,revision,tags_json,metadata_json,entities_json,observation_scopes_json,event_date,occurred_start,occurred_end,mentioned_at,created_at,updated_at,edited_at,consolidated_at,consolidation_failed_at,invalidation_reason,invalidated_at,proof_count)
    VALUES (:epoch,:bank,:memory,:document,:chunk,:text,:context,:fact,:state,:revision,:tags,:metadata,:entities,:scopes,:event,:start,:end,:mentioned,:created,:updated,:edited,:consolidated,:failed,:reason,:invalidated,:proof)`)
    .run({ epoch: unit.authorityEpochId, bank: unit.bankId, memory: unit.memoryId, document: unit.documentId, chunk: unit.chunkId, text: unit.text, context: unit.context, fact: unit.factType, state: unit.state, revision: unit.revision, tags: JSON.stringify(unit.tags), metadata: JSON.stringify(unit.metadata), entities: JSON.stringify(unit.entities), scopes: null, event: unit.eventDate, start: unit.occurredStart, end: unit.occurredEnd, mentioned: unit.mentionedAt, created: unit.createdAt, updated: unit.updatedAt, edited: unit.editedAt, consolidated: unit.consolidatedAt, failed: unit.consolidationFailedAt, reason: unit.invalidationReason, invalidated: unit.invalidatedAt, proof: unit.proofCount });
}
function insertPolicy(db: Database, record: CanonicalMemoryRecord): void { const policy = record.policy; db.prepare("INSERT INTO canonical_memory_policy (authority_epoch_id,bank_id,memory_id,layer_id,importance,visibility,disclosure,origin,emotional_weight,retention_json,policy_version,updated_at) VALUES (:epoch,:bank,:memory,:layer,:importance,:visibility,:disclosure,:origin,:weight,:retention,:version,:updated)").run({ epoch: policy.authorityEpochId, bank: policy.bankId, memory: policy.memoryId, layer: policy.layerId, importance: policy.importance, visibility: policy.visibility, disclosure: policy.disclosure, origin: policy.origin, weight: policy.emotionalWeight, retention: JSON.stringify(policy.retention), version: policy.policyVersion, updated: policy.updatedAt }); }
function insertFts(db: Database, record: CanonicalMemoryRecord): void { const unit = record.unit; db.prepare("INSERT INTO canonical_memory_fts (authority_epoch_id,bank_id,memory_id,text,context,search_terms) VALUES (:epoch,:bank,:memory,:text,:context,:terms)").run({ epoch: unit.authorityEpochId, bank: unit.bankId, memory: unit.memoryId, text: unit.text, context: unit.context, terms: unit.text }); }
