/**
 * INPUT:  validated canonical rows and captured expected revisions
 * OUTPUT: lossless source/record reads, precise writes, lineage, and rebuildable sparse rows
 * POS:    core/db — shared canonical SQL mapping; callers own the Local authority fence and transaction
 */
import {
  HindsightCurrentCanonicalRecordSchema, HindsightCurrentCanonicalSourceSchema,
  HindsightCurrentCanonicalUnitSchema, TakiMemoryPolicyProjectionSchema,
  type CanonicalMemoryRecord, type CanonicalMemorySource, type CanonicalMemoryUnit,
  type TakiMemoryPolicyProjection,
} from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";

type Identity = { epochId: string; bankId: string; memoryId: string };
type FtsProjection = Pick<CanonicalMemoryUnit, "authorityEpochId" | "bankId" | "memoryId" | "text" | "context">;
/** The same eligibility contract guards publication, rebuild, and reads of older sparse caches. */
export const CANONICAL_MEMORY_FTS_ELIGIBLE = "u.state='valid' AND p.visibility<>'hidden'";
export type CanonicalUnitPolicy = {
  unit: CanonicalMemoryUnit; policy: TakiMemoryPolicyProjection; searchTerms: string;
};

export function readCanonicalRecord(db: Database, input: Identity): CanonicalMemoryRecord | undefined {
  const row = db.prepare(`SELECT u.*,p.layer_id,p.importance,p.visibility,p.disclosure,p.origin,p.emotional_weight,
    p.retention_json,p.policy_version,p.updated_at AS policy_updated,s.provenance_json,
    (SELECT json_group_array(source_memory_id) FROM canonical_memory_unit_sources l
      WHERE l.authority_epoch_id=u.authority_epoch_id AND l.bank_id=u.bank_id AND l.memory_id=u.memory_id) AS source_memory_ids
    FROM canonical_memory_units u JOIN canonical_memory_policy p ON p.authority_epoch_id=u.authority_epoch_id
      AND p.bank_id=u.bank_id AND p.memory_id=u.memory_id
    LEFT JOIN canonical_memory_sources s ON s.authority_epoch_id=u.authority_epoch_id AND s.bank_id=u.bank_id
      AND s.document_id=u.document_id
    WHERE u.authority_epoch_id=:epoch AND u.bank_id=:bank AND u.memory_id=:memory`)
    .get({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId });
  return row ? parseRecord(row) : undefined;
}

export function requireCanonicalRecord(db: Database, input: Identity): CanonicalMemoryRecord {
  const record = readCanonicalRecord(db, input);
  if (!record) throw new Error("MEMORY_NOT_FOUND");
  return record;
}

export function readCanonicalSource(db: Database, input: {
  epochId: string; bankId: string; documentId: string;
}): CanonicalMemorySource | undefined {
  const row = db.prepare(`SELECT * FROM canonical_memory_sources
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:doc`)
    .get({ epoch: input.epochId, bank: input.bankId, doc: input.documentId });
  return row ? HindsightCurrentCanonicalSourceSchema.parse({ authorityEpochId: row.authority_epoch_id,
    bankId: row.bank_id, documentId: row.document_id, contentHash: row.content_hash, retainedText: row.retained_text,
    context: row.context, tags: JSON.parse(String(row.tags_json)), metadata: JSON.parse(String(row.metadata_json)),
    observationScopes: row.observation_scopes_json === null ? null : JSON.parse(String(row.observation_scopes_json)),
    provenance: JSON.parse(String(row.provenance_json)), revision: row.revision, createdAt: row.created_at,
    updatedAt: row.updated_at }) : undefined;
}

export function upsertCanonicalSource(db: Database, source: CanonicalMemorySource, revision: number): void {
  const retired = db.prepare(`SELECT 1 FROM canonical_memory_retired_sources
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:doc`)
    .get({ epoch: source.authorityEpochId, bank: source.bankId, doc: source.documentId });
  if (retired) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
  db.prepare(`INSERT INTO canonical_memory_sources (authority_epoch_id,bank_id,document_id,content_hash,
    retained_text,context,tags_json,metadata_json,observation_scopes_json,provenance_json,revision,created_at,updated_at)
    VALUES (:epoch,:bank,:doc,:hash,:text,:context,:tags,:metadata,:scopes,:provenance,:revision,:created,:updated)
    ON CONFLICT(authority_epoch_id,bank_id,document_id) DO UPDATE SET content_hash=excluded.content_hash,
      retained_text=excluded.retained_text,context=excluded.context,tags_json=excluded.tags_json,
      metadata_json=excluded.metadata_json,observation_scopes_json=excluded.observation_scopes_json,
      provenance_json=excluded.provenance_json,revision=excluded.revision,updated_at=excluded.updated_at`)
    .run(sourceRow(source, revision));
}

export function insertCanonicalUnitAndPolicy(db: Database, item: CanonicalUnitPolicy): void {
  // Hard deletion never frees a canonical identity for a new, unrelated memory.
  const historical = db.prepare(`SELECT 1 FROM canonical_memory_revision_snapshots
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory LIMIT 1`)
    .get({ epoch: item.unit.authorityEpochId, bank: item.unit.bankId, memory: item.unit.memoryId });
  if (historical) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
  db.prepare(`INSERT INTO canonical_memory_units (authority_epoch_id,bank_id,memory_id,document_id,chunk_id,text,
    context,fact_type,state,revision,tags_json,metadata_json,entities_json,observation_scopes_json,event_date,
    occurred_start,occurred_end,mentioned_at,created_at,updated_at,edited_at,consolidated_at,consolidation_failed_at,
    invalidation_reason,invalidated_at,proof_count) VALUES (:epoch,:bank,:memory,:doc,:chunk,:text,:context,:fact,
    :state,:revision,:tags,:metadata,:entities,:scopes,:event,:start,:end,:mentioned,:created,:updated,:edited,
    :consolidated,:failed,:reason,:invalidated,:proof)`)
    .run(unitRow(item.unit));
  db.prepare(`INSERT INTO canonical_memory_policy (authority_epoch_id,bank_id,memory_id,layer_id,importance,
    visibility,disclosure,origin,emotional_weight,retention_json,policy_version,updated_at)
    VALUES (:epoch,:bank,:memory,:layer,:importance,:visibility,:disclosure,:origin,:weight,:retention,:version,:updated)`)
    .run(policyRow(item.policy));
}

export function updateCanonicalRecord(db: Database, input: {
  record: CanonicalMemoryRecord; expectedRevision: number;
}): void {
  const { record, expectedRevision } = input; const unit = record.unit;
  const changed = db.prepare(`UPDATE canonical_memory_units SET text=:text,context=:context,occurred_start=:start,
    occurred_end=:end,fact_type=:fact,entities_json=:entities,tags_json=:tags,proof_count=:proof,revision=:revision,
    edited_at=:edited,updated_at=:updated WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory
    AND revision=:expected`).run({ epoch: unit.authorityEpochId, bank: unit.bankId, memory: unit.memoryId,
    text: unit.text, context: unit.context, start: unit.occurredStart, end: unit.occurredEnd, fact: unit.factType,
    entities: JSON.stringify(unit.entities), tags: JSON.stringify(unit.tags), proof: unit.proofCount,
    revision: unit.revision, edited: unit.editedAt, updated: unit.updatedAt, expected: expectedRevision });
  if (Number(changed.changes) !== 1) throw new Error("MEMORY_REVISION_MISMATCH");
  const policy = record.policy;
  db.prepare(`UPDATE canonical_memory_policy SET layer_id=:layer,importance=:importance,visibility=:visibility,
    disclosure=:disclosure,origin=:origin,emotional_weight=:weight,retention_json=:retention,policy_version=:version,
    updated_at=:updated WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory`)
    .run(policyRow(policy));
}

export function updateCanonicalLifecycle(db: Database, unit: CanonicalMemoryUnit): void {
  const changed = db.prepare(`UPDATE canonical_memory_units SET state=:state,invalidation_reason=:reason,
    invalidated_at=:invalidated,revision=:revision,updated_at=:updated WHERE authority_epoch_id=:epoch
    AND bank_id=:bank AND memory_id=:memory AND revision=:expected`).run({ state: unit.state,
    reason: unit.invalidationReason, invalidated: unit.invalidatedAt, revision: unit.revision,
    updated: unit.updatedAt, epoch: unit.authorityEpochId, bank: unit.bankId, memory: unit.memoryId,
    expected: unit.revision - 1 });
  if (Number(changed.changes) !== 1) throw new Error("MEMORY_REVISION_MISMATCH");
}

export function canonicalControlledLayerTags(tags: string[], layerId: string): string[] {
  return [...tags.filter((tag) => !tag.startsWith("taki-layer:")), `taki-layer:${layerId}`];
}

export function addCanonicalLineage(db: Database, input: Identity & { sourceMemoryId: string }): void {
  if (input.memoryId === input.sourceMemoryId) throw new Error("MEMORY_INVALID_REQUEST: lineage self-edge");
  db.prepare(`INSERT INTO canonical_memory_unit_sources (authority_epoch_id,bank_id,memory_id,source_memory_id)
    VALUES (:epoch,:bank,:memory,:source)`)
    .run({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId, source: input.sourceMemoryId });
}

export function replaceCanonicalFts(db: Database, unit: FtsProjection, searchTerms: string): void {
  removeCanonicalFts(db, { epochId: unit.authorityEpochId, bankId: unit.bankId, memoryId: unit.memoryId });
  upsertCanonicalFts(db, unit, searchTerms);
}

export function removeCanonicalFts(db: Database, input: Identity): void {
  db.prepare("DELETE FROM canonical_memory_fts WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory")
    .run({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId });
}

export function upsertCanonicalFts(db: Database, unit: FtsProjection, searchTerms: string): void {
  db.prepare(`INSERT INTO canonical_memory_fts (authority_epoch_id,bank_id,memory_id,text,context,search_terms)
    SELECT :epoch,:bank,:memory,:text,:context,:terms FROM canonical_memory_units u
    JOIN canonical_memory_policy p ON p.authority_epoch_id=u.authority_epoch_id AND p.bank_id=u.bank_id AND p.memory_id=u.memory_id
    WHERE u.authority_epoch_id=:epoch AND u.bank_id=:bank AND u.memory_id=:memory AND ${CANONICAL_MEMORY_FTS_ELIGIBLE}`)
    .run({ epoch: unit.authorityEpochId, bank: unit.bankId, memory: unit.memoryId,
      text: unit.text, context: unit.context, terms: searchTerms });
}

export function canonicalPolicyFromRow(row: SqlRow): TakiMemoryPolicyProjection {
  return TakiMemoryPolicyProjectionSchema.parse({ authorityEpochId: row.authority_epoch_id, bankId: row.bank_id,
    memoryId: row.memory_id, layerId: row.layer_id, importance: row.importance, visibility: row.visibility,
    disclosure: row.disclosure, origin: row.origin, emotionalWeight: row.emotional_weight,
    retention: JSON.parse(String(row.retention_json)), policyVersion: row.policy_version,
    updatedAt: row.policy_updated ?? row.updated_at });
}

function parseRecord(row: SqlRow): CanonicalMemoryRecord {
  const unit = HindsightCurrentCanonicalUnitSchema.parse({ authorityEpochId: row.authority_epoch_id,
    bankId: row.bank_id, memoryId: row.memory_id, documentId: row.document_id, chunkId: row.chunk_id,
    text: row.text, context: row.context, factType: row.fact_type, state: row.state, revision: row.revision,
    tags: JSON.parse(String(row.tags_json)), metadata: JSON.parse(String(row.metadata_json)),
    entities: JSON.parse(String(row.entities_json)), sourceMemoryIds: JSON.parse(String(row.source_memory_ids ?? "[]")),
    observationScopes: row.observation_scopes_json ? JSON.parse(String(row.observation_scopes_json)) : null,
    eventDate: row.event_date, occurredStart: row.occurred_start, occurredEnd: row.occurred_end,
    mentionedAt: row.mentioned_at, createdAt: row.created_at, updatedAt: row.updated_at, editedAt: row.edited_at,
    consolidatedAt: row.consolidated_at, consolidationFailedAt: row.consolidation_failed_at,
    invalidationReason: row.invalidation_reason, invalidatedAt: row.invalidated_at, proofCount: row.proof_count });
  const provenance = row.provenance_json ? JSON.parse(String(row.provenance_json)) as unknown
    : { actor: "provider", origin: "provider-derived", characterId: null, timelineFromSeq: null, timelineToSeq: null,
      capturedAt: unit.createdAt, sanitized: true, sourceRef: null };
  return HindsightCurrentCanonicalRecordSchema.parse({ unit, policy: canonicalPolicyFromRow(row), provenance });
}

function sourceRow(source: CanonicalMemorySource, revision: number): SqlRow {
  return { epoch: source.authorityEpochId, bank: source.bankId, doc: source.documentId, hash: source.contentHash,
    text: source.retainedText, context: source.context, tags: JSON.stringify(source.tags),
    metadata: JSON.stringify(source.metadata), scopes: source.observationScopes ? JSON.stringify(source.observationScopes) : null,
    provenance: JSON.stringify(source.provenance), revision, created: source.createdAt, updated: source.updatedAt };
}

function unitRow(unit: CanonicalMemoryUnit): SqlRow {
  return { epoch: unit.authorityEpochId, bank: unit.bankId, memory: unit.memoryId, doc: unit.documentId,
    chunk: unit.chunkId, text: unit.text, context: unit.context, fact: unit.factType, state: unit.state,
    revision: unit.revision, tags: JSON.stringify(unit.tags), metadata: JSON.stringify(unit.metadata),
    entities: JSON.stringify(unit.entities), scopes: unit.observationScopes ? JSON.stringify(unit.observationScopes) : null,
    event: unit.eventDate, start: unit.occurredStart, end: unit.occurredEnd, mentioned: unit.mentionedAt,
    created: unit.createdAt, updated: unit.updatedAt, edited: unit.editedAt, consolidated: unit.consolidatedAt,
    failed: unit.consolidationFailedAt, reason: unit.invalidationReason, invalidated: unit.invalidatedAt, proof: unit.proofCount };
}

function policyRow(policy: TakiMemoryPolicyProjection): SqlRow {
  return { epoch: policy.authorityEpochId, bank: policy.bankId, memory: policy.memoryId, layer: policy.layerId,
    importance: policy.importance, visibility: policy.visibility, disclosure: policy.disclosure, origin: policy.origin,
    weight: policy.emotionalWeight, retention: JSON.stringify(policy.retention), version: policy.policyVersion,
    updated: policy.updatedAt };
}
