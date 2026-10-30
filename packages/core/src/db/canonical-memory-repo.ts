/**
 * INPUT:  validated canonical source/unit/policy payloads and synchronous SQLite transactions
 * OUTPUT: atomic retain, revisioned mutation, lifecycle, lineage, and minimal idempotency receipts
 * POS:    core/db — canonical Local aggregate writer; Markdown and legacy memory tables are never touched
 */
import { createHash } from "node:crypto";
import {
  CanonicalDerivedMemorySchema, HindsightCurrentCanonicalRecordSchema as CanonicalMemoryRecordSchema,
  HindsightCurrentCanonicalSourceSchema as CanonicalMemorySourceSchema,
  HindsightCurrentCanonicalUnitSchema as CanonicalMemoryUnitSchema, RetainCompletedResultSchema, TakiMemoryPolicyProjectionSchema,
  type CanonicalDerivedMemory, type CanonicalMemoryRecord, type CanonicalMemorySource,
  type CanonicalMemoryUnit, type AppliedMutationResult as MutationResult, type TakiMemoryPolicyProjection,
} from "@taki/shared";
import { z } from "zod";
import type { Database } from "./sqlite.ts";
import {
  canonicalMemoryAtomic as atomic, assertCanonicalLocalAuthority as assertActiveEpoch,
  readCanonicalReceipt as receiptRow, saveCanonicalReceipt as saveReceipt,
  saveCanonicalSnapshot as saveSnapshot, readCanonicalSnapshot as readSnapshot,
} from "./canonical-memory-maintenance-storage.ts";
import {
  readCanonicalRecord as readRecord, requireCanonicalRecord as requireRecord,
  upsertCanonicalSource as upsertSource, insertCanonicalUnitAndPolicy as insertUnitAndPolicy,
  updateCanonicalRecord as updateUnit, updateCanonicalLifecycle as updateLifecycle,
  canonicalControlledLayerTags as controlledLayerTags, addCanonicalLineage as addLineage,
  replaceCanonicalFts as replaceFts, removeCanonicalFts as removeFts, upsertCanonicalFts as upsertFts,
} from "./canonical-memory-maintenance-records.ts";

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

function retain(db: Database, input: CanonicalRetainInput): RetainResult {
  const previous = receiptRow(db, input.epochId, input.requestId);
  if (previous?.operation !== undefined && previous.operation !== "retain") throw new Error("MEMORY_REQUEST_ID_CONFLICT");
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
  updateUnit(db, { record, expectedRevision: input.expectedRevision });
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
    // Imported records can predate Local mutation history. The unchanged receipt
    // must still name a durable snapshot, including after a later edit or deletion.
    if (!readSnapshot(db, { epochId: input.epochId, bankId: input.bankId,
      memoryId: input.memoryId, revision: current.unit.revision })) saveSnapshot(db, current, input.now);
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
  if (stored.bankId !== input.bankId || stored.memoryId !== input.memoryId) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
  return { outcome: stored.outcome, record };
}

function replayRetain(previous: { requestHash: string; result: unknown }, hash: string): RetainResult {
  if (previous.requestHash !== hash) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
  const parsed = RetainCompletedResultSchema.parse(previous.result);
  return { documentId: parsed.documentId, sourceRevision: parsed.sourceRevision, memories: parsed.memories };
}

function receipt(db: Database, epochId: string, requestId: string): { requestHash: string; result: unknown } | undefined {
  const row = receiptRow(db, epochId, requestId);
  return row ? { requestHash: row.requestHash, result: row.result } : undefined;
}

function saveMutationReceipt(input: { db: Database; input: MutationInput; operation: string; outcome: "applied" | "unchanged"; revision: number }): void {
  saveReceipt(input.db, { epochId: input.input.epochId, requestId: input.input.requestId, operation: input.operation, requestHash: input.input.requestHash, result: { outcome: input.outcome, bankId: input.input.bankId, memoryId: input.input.memoryId, revision: input.revision }, createdAt: input.input.now });
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
