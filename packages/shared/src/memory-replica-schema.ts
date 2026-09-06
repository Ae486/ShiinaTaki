/**
 * INPUT:  canonical replica objects, ordered provider journal pages, and Core-owned lease references
 * OUTPUT: strict bounded replica, transaction-batch, checkpoint, and lease contracts
 * POS:    shared contract — B5 data-plane validation; no authority mutation or arbitrary extension payloads
 */
import { z } from "zod";
import {
  CanonicalDerivedMemorySchema, CanonicalMemoryBankSchema, CanonicalMemoryRecordSchema,
  CanonicalMemorySourceSchema,
} from "./memory-provider-domain-schema.ts";
import { HindsightLogicalObjectKindSchema } from "./hindsight-cutover-schema.ts";

const Id = z.string().min(1).max(256);
const Timestamp = z.iso.datetime({ offset: true });
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
// Provider page size is a soft limit. Larger complete transactions are refused, never truncated.
export const MEMORY_REPLICA_PAGE_LIMIT = 10_000;
export const MemoryReplicaObjectKindSchema = HindsightLogicalObjectKindSchema;
export type MemoryReplicaObjectKind = z.infer<typeof MemoryReplicaObjectKindSchema>;
export const MemoryReplicaPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bank"), value: CanonicalMemoryBankSchema }),
  z.strictObject({ kind: z.literal("document"), value: CanonicalMemorySourceSchema }),
  z.strictObject({ kind: z.literal("memory_unit"), value: CanonicalMemoryRecordSchema }),
  z.strictObject({ kind: z.enum(["mental_model", "directive"]), value: CanonicalDerivedMemorySchema }),
]).superRefine((value, context) => {
  if (containsCredentialField(value)) context.addIssue({ code: "custom", message: "replica payload contains credential configuration" });
});
export type MemoryReplicaPayload = z.infer<typeof MemoryReplicaPayloadSchema>;

export const MemoryReplicaRecordSchema = z.strictObject({
  bankId: Id, objectKind: MemoryReplicaObjectKindSchema, objectId: Id, objectRevision: z.int().min(1),
  operation: z.enum(["upsert", "tombstone"]), payload: MemoryReplicaPayloadSchema.nullable(),
}).superRefine((record, context) => {
  if ((record.operation === "upsert") !== (record.payload !== null)) {
    context.addIssue({ code: "custom", path: ["payload"], message: "operation and payload presence disagree" });
  }
  if (record.payload === null) return;
  const identity = payloadIdentity(record.payload);
  if (record.payload.kind !== identity.kind || record.objectKind !== identity.kind || record.objectId !== identity.id
    || record.bankId !== identity.bankId || record.objectRevision !== identity.revision) {
    context.addIssue({ code: "custom", path: ["payload"], message: "canonical payload kind, Bank, identity, or revision mismatch" });
  }
});
export type MemoryReplicaRecord = z.infer<typeof MemoryReplicaRecordSchema>;

export const MemoryReplicaJournalRecordSchema = MemoryReplicaRecordSchema.safeExtend({
  providerLineageId: z.string().uuid(), bankGeneration: z.string().uuid(),
  cursor: z.int().min(1), batchId: z.string().uuid(), batchIndex: z.int().min(0),
  batchSize: z.int().min(1).max(MEMORY_REPLICA_PAGE_LIMIT), recordedAt: Timestamp,
});
export type MemoryReplicaJournalRecord = z.infer<typeof MemoryReplicaJournalRecordSchema>;

export const MemoryReplicaJournalPageSchema = z.strictObject({
  bankId: Id, providerLineageId: z.string().uuid(), bankGeneration: z.string().uuid(),
  predecessorCursor: z.int().min(0), nextCursor: z.int().min(0), currentCursor: z.int().min(0),
  minimumAvailableCursor: z.int().min(0), hasMore: z.boolean(),
  records: z.array(MemoryReplicaJournalRecordSchema).max(MEMORY_REPLICA_PAGE_LIMIT),
}).superRefine(validatePage);
export type MemoryReplicaJournalPage = z.infer<typeof MemoryReplicaJournalPageSchema>;

export const MemoryReplicaCheckpointSchema = z.strictObject({
  providerLineageId: z.string().uuid(), bankId: Id, bankGeneration: z.string().uuid(),
  authorityEpochId: Id, replicaEpochId: z.string().uuid(), endCursor: z.int().min(0),
  snapshotId: z.string().uuid(), snapshotCursor: z.int().min(0), snapshotManifestDigest: Hash,
  manifestDigest: Hash, verifiedAt: Timestamp,
}).refine((value) => value.endCursor >= value.snapshotCursor, "checkpoint precedes its verified snapshot");
export type MemoryReplicaCheckpoint = z.infer<typeof MemoryReplicaCheckpointSchema>;

export const MemoryReplicaLeaseSchema = z.strictObject({
  bankId: Id, runId: z.string().uuid(), ownerId: Id, fence: z.int().min(1), expiresAt: Timestamp,
});
export type MemoryReplicaLease = z.infer<typeof MemoryReplicaLeaseSchema>;

function payloadIdentity(payload: MemoryReplicaPayload) {
  if (payload.kind === "bank") return { kind: payload.kind, id: payload.value.bankId, bankId: payload.value.bankId, revision: payload.value.revision };
  if (payload.kind === "document") return { kind: payload.kind, id: payload.value.documentId, bankId: payload.value.bankId, revision: payload.value.revision };
  if (payload.kind === "memory_unit") return { kind: payload.kind, id: payload.value.unit.memoryId, bankId: payload.value.unit.bankId, revision: payload.value.unit.revision };
  const derived = payload.value;
  return { kind: derived.payload.kind, id: derived.payload.kind === "mental_model" ? derived.payload.mentalModelId : derived.payload.directiveId,
    bankId: derived.bankId, revision: derived.objectRevision };
}

function containsCredentialField(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => /api[_-]?key|authorization|password|access[_-]?token|refresh[_-]?token|client[_-]?secret/i.test(key)
    || containsCredentialField(item));
}

function validatePage(page: {
  bankId: string; providerLineageId: string; bankGeneration: string; predecessorCursor: number; nextCursor: number;
  currentCursor: number; minimumAvailableCursor: number; hasMore: boolean; records: MemoryReplicaJournalRecord[];
}, context: z.RefinementCtx): void {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (page.predecessorCursor < page.minimumAvailableCursor || page.nextCursor > page.currentCursor) fail("cursor outside provider window");
  if (page.hasMore !== (page.nextCursor < page.currentCursor)) fail("hasMore contradicts current cursor");
  if (page.nextCursor !== (page.records.at(-1)?.cursor ?? page.predecessorCursor)) fail("page must end at its last record cursor");
  if (page.records.length === 0 && page.hasMore) fail("nonterminal empty page cannot make progress");
  let previousCursor = page.predecessorCursor;
  let batch: MemoryReplicaJournalRecord | undefined;
  const seen = new Set<string>(); const batchObjects = new Set<string>();
  for (const record of page.records) {
    if (record.bankId !== page.bankId || record.providerLineageId !== page.providerLineageId || record.bankGeneration !== page.bankGeneration) fail("journal lineage mismatch");
    if (record.cursor !== previousCursor + 1) fail("journal cursors must be contiguous");
    if (!batch || record.batchId !== batch.batchId) {
      if (batch && batch.batchIndex !== batch.batchSize - 1) fail("previous batch is incomplete");
      if (seen.has(record.batchId) || record.batchIndex !== 0) fail("batch must begin once at index zero");
      seen.add(record.batchId); batchObjects.clear();
    } else if (record.batchSize !== batch.batchSize || record.batchIndex !== batch.batchIndex + 1) fail("batch order or size mismatch");
    if (record.batchIndex >= record.batchSize) fail("batch index exceeds its size");
    const objectKey = `${record.objectKind}\0${record.objectId}`;
    if (batchObjects.has(objectKey)) fail("provider transaction contains a duplicate logical object");
    batchObjects.add(objectKey);
    previousCursor = record.cursor; batch = record;
  }
  if (batch && batch.batchIndex !== batch.batchSize - 1) fail("final transaction is incomplete");
}
