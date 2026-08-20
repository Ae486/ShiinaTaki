/**
 * INPUT:  validated canonical source/unit/policy payloads and synchronous SQLite transactions
 * OUTPUT: atomic retain, revisioned mutation, lifecycle, lineage, and minimal idempotency receipts
 * POS:    core/db — canonical Local aggregate writer; Markdown and legacy memory tables are never touched
 */
import { createHash } from "node:crypto";
import {
  CanonicalDerivedMemorySchema, CanonicalMemoryRecordSchema, CanonicalMemorySourceSchema,
  CanonicalMemoryUnitSchema, MutationResultSchema, RetainResultSchema, TakiMemoryPolicyProjectionSchema,
  type CanonicalDerivedMemory, type CanonicalMemoryRecord, type CanonicalMemorySource,
  type CanonicalMemoryUnit, type MutationResult, type TakiMemoryPolicyProjection,
} from "@taki/shared";
import { z } from "zod";
import type { Database, SqlRow } from "./sqlite.ts";

type RetainResult = { documentId: string; sourceRevision: number; memories: Array<{ memoryId: string; revision: number }> };
type UnitPolicy = { unit: CanonicalMemoryUnit; policy: TakiMemoryPolicyProjection; searchTerms: string };
const MutationReceiptSchema = z.strictObject({
  outcome: z.enum(["applied", "unchanged"]), bankId: z.string().min(1), memoryId: z.string().min(1), revision: z.int().min(1),
});
export interface CanonicalRetainInput {
  epochId: string; bankId: string; requestId: string; requestHash: string; source: CanonicalMemorySource;
  unit?: CanonicalMemoryUnit; policy?: TakiMemoryPolicyProjection; searchTerms?: string; units?: UnitPolicy[];
}
interface MutationInput {
  epochId: string; bankId: string; memoryId: string; expectedRevision: number; requestId: string;
  requestHash: string; now: string; searchTerms: string;
}
export interface CanonicalMemoryRepo {
  retain(input: CanonicalRetainInput): RetainResult;
  receipt(epochId: string, requestId: string): { requestHash: string; result: unknown } | undefined;
  record(epochId: string, bankId: string, memoryId: string): CanonicalMemoryRecord | undefined;
  edit(input: MutationInput & { patch: Partial<Pick<CanonicalMemoryUnit, "text" | "context" | "occurredStart" | "occurredEnd" | "factType" | "entities">>; policy?: Pick<TakiMemoryPolicyProjection, "layerId" | "visibility" | "retention"> }): MutationResult;
  invalidate(input: MutationInput & { reason: string | null }): MutationResult;
  restore(input: MutationInput): MutationResult;
  addLineage(input: { epochId: string; bankId: string; memoryId: string; sourceMemoryId: string }): void;
  saveDerived(input: CanonicalDerivedMemory): void;
  getDerived(input: { epochId: string; bankId: string; kind: CanonicalDerivedMemory["payload"]["kind"]; objectId: string }): CanonicalDerivedMemory | undefined;
}
export function stableRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function createCanonicalMemoryRepo(db: Database): CanonicalMemoryRepo {
  return {
    retain: (input) => atomic(db, () => retain(db, input)),
    receipt: (epoch, request) => receipt(db, epoch, request),
    record: (epoch, bank, memory) => readRecord(db, { epochId: epoch, bankId: bank, memoryId: memory }),
    edit: (input) => atomic(db, () => edit(db, input)),
    invalidate: (input) => atomic(db, () => lifecycle(db, input, "invalidate")),
    restore: (input) => atomic(db, () => lifecycle(db, input, "restore")),
    addLineage: (input) => { assertActiveEpoch(db, input.epochId); addLineage(db, input); },
    saveDerived: (input) => { assertActiveEpoch(db, input.authorityEpochId); saveDerived(db, input); },
    getDerived: (input) => getDerived(db, input),
  };
}
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
}

function atomic<T>(db: Database, operation: () => T): T {
  let result: T | undefined;
  db.transaction(() => { result = operation(); });
  return result as T;
}
function retain(db: Database, input: CanonicalRetainInput): RetainResult {
  const previous = receipt(db, input.epochId, input.requestId);
  if (previous) return replayRetain(previous, input.requestHash);
  assertActiveEpoch(db, input.epochId);
  const source = requireSourceIdentity(input);
  const units = requireUnits(input, source);
  const existing = db.prepare("SELECT revision FROM canonical_memory_sources WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:doc")
    .get({ epoch: input.epochId, bank: input.bankId, doc: source.documentId });
  const sourceRevision = existing ? Number(existing.revision) + 1 : source.revision;
  if (existing) replaceExistingDocument(db, input, source);
  upsertSource(db, source, sourceRevision);
  for (const item of units) insertUnitAndPolicy(db, item);
  for (const item of units) insertLineage(db, item.unit);
  for (const item of units) publishUnit(db, item);
  const result = { documentId: source.documentId, sourceRevision, memories: units.map(({ unit }) => ({ memoryId: unit.memoryId, revision: unit.revision })) };
  saveReceipt(db, { epochId: input.epochId, requestId: input.requestId, operation: "retain", requestHash: input.requestHash, result: { status: "completed", ...result }, createdAt: source.updatedAt });
  return result;
}
function requireSourceIdentity(input: CanonicalRetainInput): CanonicalMemorySource {
  const source = CanonicalMemorySourceSchema.parse(input.source);
  if (source.authorityEpochId !== input.epochId || source.bankId !== input.bankId) {
    throw new Error("MEMORY_INTEGRITY_ERROR: source identity mismatch");
  }
  return source;
}

function requireUnits(input: CanonicalRetainInput, source: CanonicalMemorySource): UnitPolicy[] {
  const raw = input.units ?? (input.unit && input.policy ? [{ unit: input.unit, policy: input.policy, searchTerms: input.searchTerms ?? "" }] : []);
  if (raw.length === 0) throw new Error("MEMORY_INVALID_REQUEST: retain needs at least one unit");
  return raw.map((item) => {
    const unit = CanonicalMemoryUnitSchema.parse(item.unit);
    const policy = TakiMemoryPolicyProjectionSchema.parse(item.policy);
    if (unit.authorityEpochId !== input.epochId || unit.bankId !== input.bankId || unit.documentId !== source.documentId) {
      throw new Error("MEMORY_INTEGRITY_ERROR: unit identity mismatch");
    }
    CanonicalMemoryRecordSchema.parse({ unit, policy, provenance: source.provenance });
    return { unit, policy, searchTerms: item.searchTerms };
  });
}

function replaceExistingDocument(db: Database, input: CanonicalRetainInput, source: CanonicalMemorySource): void {
  const ids = db.prepare("SELECT memory_id FROM canonical_memory_units WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:doc AND state='valid'")
    .all({ epoch: input.epochId, bank: input.bankId, doc: source.documentId }).map((row) => String(row.memory_id));
  db.prepare("UPDATE canonical_memory_units SET state='invalidated',invalidation_reason='replaced',invalidated_at=:now,revision=revision+1,updated_at=:now WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:doc AND state='valid'")
    .run({ now: source.updatedAt, epoch: input.epochId, bank: input.bankId, doc: source.documentId });
  for (const memoryId of ids) {
    removeFts(db, { epochId: input.epochId, bankId: input.bankId, memoryId });
    const record = requireRecord(db, { epochId: input.epochId, bankId: input.bankId, memoryId });
    saveSnapshot(db, record, source.updatedAt);
  }
}

function upsertSource(db: Database, source: CanonicalMemorySource, revision: number): void {
  db.prepare("INSERT INTO canonical_memory_sources (authority_epoch_id,bank_id,document_id,content_hash,retained_text,context,tags_json,metadata_json,observation_scopes_json,provenance_json,revision,created_at,updated_at) VALUES (:epoch,:bank,:doc,:hash,:text,:context,:tags,:metadata,:scopes,:provenance,:revision,:created,:updated) ON CONFLICT(authority_epoch_id,bank_id,document_id) DO UPDATE SET content_hash=excluded.content_hash,retained_text=excluded.retained_text,context=excluded.context,tags_json=excluded.tags_json,metadata_json=excluded.metadata_json,observation_scopes_json=excluded.observation_scopes_json,provenance_json=excluded.provenance_json,revision=excluded.revision,updated_at=excluded.updated_at")
    .run(sourceRow(source, revision));
}

function insertUnitAndPolicy(db: Database, item: UnitPolicy): void {
  db.prepare("INSERT INTO canonical_memory_units (authority_epoch_id,bank_id,memory_id,document_id,chunk_id,text,context,fact_type,state,revision,tags_json,metadata_json,entities_json,observation_scopes_json,event_date,occurred_start,occurred_end,mentioned_at,created_at,updated_at,edited_at,consolidated_at,consolidation_failed_at,invalidation_reason,invalidated_at,proof_count) VALUES (:epoch,:bank,:memory,:doc,:chunk,:text,:context,:fact,:state,:revision,:tags,:metadata,:entities,:scopes,:event,:start,:end,:mentioned,:created,:updated,:edited,:consolidated,:failed,:reason,:invalidated,:proof)")
    .run(unitRow(item.unit));
  db.prepare("INSERT INTO canonical_memory_policy (authority_epoch_id,bank_id,memory_id,layer_id,importance,visibility,disclosure,origin,emotional_weight,retention_json,policy_version,updated_at) VALUES (:epoch,:bank,:memory,:layer,:importance,:visibility,:disclosure,:origin,:weight,:retention,:version,:updated)")
    .run(policyRow(item.policy));
}

function insertLineage(db: Database, unit: CanonicalMemoryUnit): void {
  for (const sourceMemoryId of unit.sourceMemoryIds) addLineage(db, { epochId: unit.authorityEpochId, bankId: unit.bankId, memoryId: unit.memoryId, sourceMemoryId });
}

function publishUnit(db: Database, item: UnitPolicy): void {
  if (item.unit.state === "valid") upsertFts(db, item.unit, item.searchTerms);
  const record = requireRecord(db, { epochId: item.unit.authorityEpochId, bankId: item.unit.bankId, memoryId: item.unit.memoryId });
  saveSnapshot(db, record, item.unit.updatedAt);
}

function edit(db: Database, input: MutationInput & { patch: Partial<CanonicalMemoryUnit>; policy?: Pick<TakiMemoryPolicyProjection, "layerId" | "visibility" | "retention"> }): MutationResult {
  const replay = replayMutation(db, input, "edit"); if (replay) return replay;
  assertActiveEpoch(db, input.epochId);
  const current = requireExpectedRecord(db, input);
  const layerId = input.policy?.layerId ?? current.policy.layerId;
  const tags = input.policy ? controlledLayerTags(current.unit.tags, layerId) : current.unit.tags;
  const unit = CanonicalMemoryUnitSchema.parse({ ...current.unit, ...input.patch, tags, revision: current.unit.revision + 1, editedAt: input.now, updatedAt: input.now });
  const policy = TakiMemoryPolicyProjectionSchema.parse({ ...current.policy, ...input.policy, layerId, updatedAt: input.policy ? input.now : current.policy.updatedAt });
  const record = CanonicalMemoryRecordSchema.parse({ unit, policy, provenance: current.provenance });
  updateUnit(db, record);
  replaceFts(db, record.unit, input.searchTerms);
  saveSnapshot(db, record, input.now);
  saveMutationReceipt({ db, input, operation: "edit", outcome: "applied", revision: record.unit.revision });
  return { outcome: "applied", record };
}

function lifecycle(db: Database, input: MutationInput & { reason?: string | null }, operation: "invalidate" | "restore"): MutationResult {
  const replay = replayMutation(db, input, operation); if (replay) return replay;
  assertActiveEpoch(db, input.epochId);
  const current = requireExpectedRecord(db, input);
  const already = operation === "invalidate" ? current.unit.state === "invalidated" : current.unit.state === "valid";
  if (already) {
    saveMutationReceipt({ db, input, operation, outcome: "unchanged", revision: current.unit.revision });
    return { outcome: "unchanged", record: current };
  }
  const invalidating = operation === "invalidate";
  const unit = CanonicalMemoryUnitSchema.parse({ ...current.unit, state: invalidating ? "invalidated" : "valid", invalidationReason: invalidating ? input.reason ?? null : null, invalidatedAt: invalidating ? input.now : null, revision: current.unit.revision + 1, updatedAt: input.now });
  const record = CanonicalMemoryRecordSchema.parse({ ...current, unit });
  updateLifecycle(db, record.unit);
  if (invalidating) removeFts(db, input); else replaceFts(db, record.unit, input.searchTerms);
  saveSnapshot(db, record, input.now);
  saveMutationReceipt({ db, input, operation, outcome: "applied", revision: record.unit.revision });
  return { outcome: "applied", record };
}

function requireExpectedRecord(db: Database, input: MutationInput): CanonicalMemoryRecord {
  const record = requireRecord(db, input);
  if (record.unit.revision !== input.expectedRevision) throw new Error(`MEMORY_REVISION_MISMATCH:${record.unit.revision}`);
  return record;
}

function replayMutation(db: Database, input: MutationInput, operation: "edit" | "invalidate" | "restore"): MutationResult | undefined {
  const previous = receiptRow(db, input.epochId, input.requestId); if (!previous) return undefined;
  if (previous.requestHash !== input.requestHash || previous.operation !== operation) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
  const stored = MutationReceiptSchema.parse(previous.result);
  const record = readSnapshot(db, { epochId: input.epochId, bankId: stored.bankId, memoryId: stored.memoryId, revision: stored.revision });
  if (!record) throw new Error("MEMORY_INTEGRITY_ERROR: mutation receipt snapshot missing");
  return MutationResultSchema.parse({ outcome: stored.outcome, record });
}

function replayRetain(previous: { requestHash: string; result: unknown }, hash: string): RetainResult {
  if (previous.requestHash !== hash) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
  const parsed = RetainResultSchema.parse(previous.result);
  return { documentId: parsed.documentId, sourceRevision: parsed.sourceRevision, memories: parsed.memories };
}

function updateUnit(db: Database, record: CanonicalMemoryRecord): void {
  const unit = record.unit;
  db.prepare("UPDATE canonical_memory_units SET text=:text,context=:context,occurred_start=:start,occurred_end=:end,fact_type=:fact,entities_json=:entities,tags_json=:tags,revision=:revision,edited_at=:edited,updated_at=:updated WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory")
    .run({ epoch: unit.authorityEpochId, bank: unit.bankId, memory: unit.memoryId, text: unit.text, context: unit.context, start: unit.occurredStart, end: unit.occurredEnd, fact: unit.factType, entities: JSON.stringify(unit.entities), tags: JSON.stringify(unit.tags), revision: unit.revision, edited: unit.editedAt, updated: unit.updatedAt });
  db.prepare("UPDATE canonical_memory_policy SET layer_id=:layer,visibility=:visibility,retention_json=:retention,updated_at=:updated WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory")
    .run({ layer: record.policy.layerId, visibility: record.policy.visibility, retention: JSON.stringify(record.policy.retention), updated: record.policy.updatedAt, epoch: unit.authorityEpochId, bank: unit.bankId, memory: unit.memoryId });
}

function updateLifecycle(db: Database, unit: CanonicalMemoryUnit): void {
  db.prepare("UPDATE canonical_memory_units SET state=:state,invalidation_reason=:reason,invalidated_at=:invalidated,revision=:revision,updated_at=:updated WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory")
    .run({ state: unit.state, reason: unit.invalidationReason, invalidated: unit.invalidatedAt, revision: unit.revision, updated: unit.updatedAt, epoch: unit.authorityEpochId, bank: unit.bankId, memory: unit.memoryId });
}

function controlledLayerTags(tags: string[], layerId: string): string[] {
  return [...tags.filter((tag) => !tag.startsWith("taki-layer:")), `taki-layer:${layerId}`];
}

function assertActiveEpoch(db: Database, epochId: string): void {
  const row = db.prepare("SELECT e.epoch_id,e.provider_id,e.status FROM canonical_memory_authority_state s JOIN canonical_memory_authority_epochs e ON e.epoch_id=s.active_epoch_id WHERE s.singleton=1").get();
  if (!row || row.epoch_id !== epochId || row.provider_id !== "local" || row.status !== "active") throw new Error("MEMORY_AUTHORITY_MISMATCH");
}

function receipt(db: Database, epochId: string, requestId: string): { requestHash: string; result: unknown } | undefined {
  const row = receiptRow(db, epochId, requestId);
  return row ? { requestHash: row.requestHash, result: row.result } : undefined;
}

function receiptRow(db: Database, epochId: string, requestId: string): { operation: string; requestHash: string; result: unknown } | undefined {
  const row = db.prepare("SELECT operation,request_hash,result_json FROM canonical_memory_operation_receipts WHERE authority_epoch_id=:epoch AND request_id=:request").get({ epoch: epochId, request: requestId });
  return row ? { operation: String(row.operation), requestHash: String(row.request_hash), result: JSON.parse(String(row.result_json)) } : undefined;
}

function saveReceipt(db: Database, input: { epochId: string; requestId: string; operation: string; requestHash: string; result: unknown; createdAt: string }): void {
  db.prepare("INSERT INTO canonical_memory_operation_receipts (authority_epoch_id,request_id,operation,request_hash,result_json,created_at) VALUES (:epoch,:request,:operation,:hash,:result,:created)")
    .run({ epoch: input.epochId, request: input.requestId, operation: input.operation, hash: input.requestHash, result: JSON.stringify(input.result), created: input.createdAt });
}

function saveMutationReceipt(input: { db: Database; input: MutationInput; operation: string; outcome: "applied" | "unchanged"; revision: number }): void {
  saveReceipt(input.db, { epochId: input.input.epochId, requestId: input.input.requestId, operation: input.operation, requestHash: input.input.requestHash, result: { outcome: input.outcome, bankId: input.input.bankId, memoryId: input.input.memoryId, revision: input.revision }, createdAt: input.input.now });
}

function readRecord(db: Database, input: { epochId: string; bankId: string; memoryId: string }): CanonicalMemoryRecord | undefined {
  const row = db.prepare("SELECT u.*,p.layer_id,p.importance,p.visibility,p.disclosure,p.origin,p.emotional_weight,p.retention_json,p.policy_version,p.updated_at AS policy_updated,s.provenance_json,(SELECT json_group_array(source_memory_id) FROM canonical_memory_unit_sources l WHERE l.authority_epoch_id=u.authority_epoch_id AND l.bank_id=u.bank_id AND l.memory_id=u.memory_id) AS source_memory_ids FROM canonical_memory_units u JOIN canonical_memory_policy p ON p.authority_epoch_id=u.authority_epoch_id AND p.bank_id=u.bank_id AND p.memory_id=u.memory_id LEFT JOIN canonical_memory_sources s ON s.authority_epoch_id=u.authority_epoch_id AND s.bank_id=u.bank_id AND s.document_id=u.document_id WHERE u.authority_epoch_id=:epoch AND u.bank_id=:bank AND u.memory_id=:memory")
    .get({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId });
  return row ? parseRecord(row) : undefined;
}

function requireRecord(db: Database, input: { epochId: string; bankId: string; memoryId: string }): CanonicalMemoryRecord {
  const record = readRecord(db, input); if (!record) throw new Error("MEMORY_NOT_FOUND"); return record;
}

function parseRecord(row: SqlRow): CanonicalMemoryRecord {
  const unit = CanonicalMemoryUnitSchema.parse({ authorityEpochId: row.authority_epoch_id, bankId: row.bank_id, memoryId: row.memory_id, documentId: row.document_id, chunkId: row.chunk_id, text: row.text, context: row.context, factType: row.fact_type, state: row.state, revision: row.revision, tags: JSON.parse(String(row.tags_json)), metadata: JSON.parse(String(row.metadata_json)), entities: JSON.parse(String(row.entities_json)), sourceMemoryIds: JSON.parse(String(row.source_memory_ids ?? "[]")), observationScopes: row.observation_scopes_json ? JSON.parse(String(row.observation_scopes_json)) : null, eventDate: row.event_date, occurredStart: row.occurred_start, occurredEnd: row.occurred_end, mentionedAt: row.mentioned_at, createdAt: row.created_at, updatedAt: row.updated_at, editedAt: row.edited_at, consolidatedAt: row.consolidated_at, consolidationFailedAt: row.consolidation_failed_at, invalidationReason: row.invalidation_reason, invalidatedAt: row.invalidated_at, proofCount: row.proof_count });
  const policy = TakiMemoryPolicyProjectionSchema.parse({ authorityEpochId: row.authority_epoch_id, bankId: row.bank_id, memoryId: row.memory_id, layerId: row.layer_id, importance: row.importance, visibility: row.visibility, disclosure: row.disclosure, origin: row.origin, emotionalWeight: row.emotional_weight, retention: JSON.parse(String(row.retention_json)), policyVersion: row.policy_version, updatedAt: row.policy_updated });
  const provenance = row.provenance_json ? CanonicalMemorySourceSchema.shape.provenance.parse(JSON.parse(String(row.provenance_json))) : providerDerivedProvenance(unit);
  return CanonicalMemoryRecordSchema.parse({ unit, policy, provenance });
}

function providerDerivedProvenance(unit: CanonicalMemoryUnit) {
  return { actor: "provider" as const, origin: "provider-derived" as const, characterId: null, timelineFromSeq: null, timelineToSeq: null, capturedAt: unit.createdAt, sanitized: true as const, sourceRef: null };
}

function saveSnapshot(db: Database, record: CanonicalMemoryRecord, createdAt: string): void {
  db.prepare("INSERT INTO canonical_memory_revision_snapshots (authority_epoch_id,bank_id,memory_id,revision,record_json,created_at) VALUES (:epoch,:bank,:memory,:revision,:record,:created)")
    .run({ epoch: record.unit.authorityEpochId, bank: record.unit.bankId, memory: record.unit.memoryId, revision: record.unit.revision, record: JSON.stringify(record), created: createdAt });
}

function readSnapshot(db: Database, input: { epochId: string; bankId: string; memoryId: string; revision: number }): CanonicalMemoryRecord | undefined {
  const row = db.prepare("SELECT record_json FROM canonical_memory_revision_snapshots WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory AND revision=:revision").get({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId, revision: input.revision });
  return row ? CanonicalMemoryRecordSchema.parse(JSON.parse(String(row.record_json))) : undefined;
}

function addLineage(db: Database, input: { epochId: string; bankId: string; memoryId: string; sourceMemoryId: string }): void {
  if (input.memoryId === input.sourceMemoryId) throw new Error("MEMORY_INVALID_REQUEST: lineage self-edge");
  db.prepare("INSERT INTO canonical_memory_unit_sources (authority_epoch_id,bank_id,memory_id,source_memory_id) VALUES (:epoch,:bank,:memory,:source)")
    .run({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId, source: input.sourceMemoryId });
}

function saveDerived(db: Database, input: CanonicalDerivedMemory): void {
  const parsed = CanonicalDerivedMemorySchema.parse(input); const payload = parsed.payload;
  const objectId = payload.kind === "mental_model" ? payload.mentalModelId : payload.directiveId;
  db.prepare("INSERT OR REPLACE INTO canonical_memory_derived (authority_epoch_id,bank_id,object_id,kind,payload_json,object_revision) VALUES (:epoch,:bank,:id,:kind,:payload,:revision)")
    .run({ epoch: parsed.authorityEpochId, bank: parsed.bankId, id: objectId, kind: payload.kind, payload: JSON.stringify(payload), revision: parsed.objectRevision });
}

function getDerived(db: Database, input: { epochId: string; bankId: string; kind: CanonicalDerivedMemory["payload"]["kind"]; objectId: string }): CanonicalDerivedMemory | undefined {
  const row = db.prepare("SELECT * FROM canonical_memory_derived WHERE authority_epoch_id=:epoch AND bank_id=:bank AND kind=:kind AND object_id=:id")
    .get({ epoch: input.epochId, bank: input.bankId, kind: input.kind, id: input.objectId });
  if (!row) return undefined;
  const derived = CanonicalDerivedMemorySchema.parse({ authorityEpochId: row.authority_epoch_id, bankId: row.bank_id, objectRevision: row.object_revision, payload: JSON.parse(String(row.payload_json)) });
  const payloadId = derived.payload.kind === "mental_model" ? derived.payload.mentalModelId : derived.payload.directiveId;
  if (derived.payload.kind !== row.kind || payloadId !== row.object_id) throw new Error("MEMORY_INTEGRITY_ERROR: derived identity mismatch");
  return derived;
}

function replaceFts(db: Database, unit: CanonicalMemoryUnit, searchTerms: string): void { removeFts(db, { epochId: unit.authorityEpochId, bankId: unit.bankId, memoryId: unit.memoryId }); upsertFts(db, unit, searchTerms); }
function removeFts(db: Database, input: { epochId: string; bankId: string; memoryId: string }): void { db.prepare("DELETE FROM canonical_memory_fts WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory").run({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId }); }
function upsertFts(db: Database, unit: CanonicalMemoryUnit, searchTerms: string): void { db.prepare("INSERT INTO canonical_memory_fts (authority_epoch_id,bank_id,memory_id,text,context,search_terms) VALUES (:epoch,:bank,:memory,:text,:context,:terms)").run({ epoch: unit.authorityEpochId, bank: unit.bankId, memory: unit.memoryId, text: unit.text, context: unit.context, terms: searchTerms }); }
function sourceRow(source: CanonicalMemorySource, revision: number): SqlRow { return { epoch: source.authorityEpochId, bank: source.bankId, doc: source.documentId, hash: source.contentHash, text: source.retainedText, context: source.context, tags: JSON.stringify(source.tags), metadata: JSON.stringify(source.metadata), scopes: source.observationScopes ? JSON.stringify(source.observationScopes) : null, provenance: JSON.stringify(source.provenance), revision, created: source.createdAt, updated: source.updatedAt }; }
function unitRow(unit: CanonicalMemoryUnit): SqlRow { return { epoch: unit.authorityEpochId, bank: unit.bankId, memory: unit.memoryId, doc: unit.documentId, chunk: unit.chunkId, text: unit.text, context: unit.context, fact: unit.factType, state: unit.state, revision: unit.revision, tags: JSON.stringify(unit.tags), metadata: JSON.stringify(unit.metadata), entities: JSON.stringify(unit.entities), scopes: unit.observationScopes ? JSON.stringify(unit.observationScopes) : null, event: unit.eventDate, start: unit.occurredStart, end: unit.occurredEnd, mentioned: unit.mentionedAt, created: unit.createdAt, updated: unit.updatedAt, edited: unit.editedAt, consolidated: unit.consolidatedAt, failed: unit.consolidationFailedAt, reason: unit.invalidationReason, invalidated: unit.invalidatedAt, proof: unit.proofCount }; }
function policyRow(policy: TakiMemoryPolicyProjection): SqlRow { return { epoch: policy.authorityEpochId, bank: policy.bankId, memory: policy.memoryId, layer: policy.layerId, importance: policy.importance, visibility: policy.visibility, disclosure: policy.disclosure, origin: policy.origin, weight: policy.emotionalWeight, retention: JSON.stringify(policy.retention), version: policy.policyVersion, updated: policy.updatedAt }; }
