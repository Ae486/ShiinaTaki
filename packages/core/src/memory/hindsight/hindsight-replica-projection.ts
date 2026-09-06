/**
 * INPUT:  normalized Hindsight logical records and trusted Taki Bank/policy/provenance bindings
 * OUTPUT: complete validated canonical replica payloads; missing policy evidence fails closed
 * POS:    core/memory/hindsight — B5 adapter seam; the provider snapshot contains no Taki provenance contract
 */
import {
  HindsightLogicalSnapshotRecordSchema, MemoryReplicaPayloadSchema, MemoryReplicaRecordSchema, MemoryReplicaJournalPageSchema,
  HindsightJournalPageSchema, type CanonicalMemoryRecord, type CanonicalMemorySource,
  type HindsightLogicalSnapshotRecord, type MemoryBankScope,
  type MemoryReplicaRecord, type HindsightJournalPage, type MemoryReplicaJournalPage,
} from "@taki/shared";

/** Trusted B4/B6 mapping data, never inferred from provider text or fabricated when absent. */
export interface HindsightReplicaProjection {
  bankScope(bankId: string): MemoryBankScope;
  source(record: HindsightLogicalSnapshotRecord): Pick<CanonicalMemorySource, "retainedText" | "context" | "provenance">;
  memory(record: HindsightLogicalSnapshotRecord): Pick<CanonicalMemoryRecord, "policy" | "provenance">;
}
export interface HindsightReplicaProjectionContext {
  authorityEpochId: string; bankId: string; projection: HindsightReplicaProjection;
}

export function projectHindsightReplicaRecord(raw: HindsightLogicalSnapshotRecord, context: HindsightReplicaProjectionContext): MemoryReplicaRecord {
  const record = HindsightLogicalSnapshotRecordSchema.parse(raw);
  if (record.payload.value.bankId !== context.bankId) throw new Error("HINDSIGHT_REPLICA_BANK_MISMATCH");
  const payload = MemoryReplicaPayloadSchema.parse(projectPayload(record, context));
  return MemoryReplicaRecordSchema.parse({ bankId: context.bankId, objectKind: record.objectKind,
    objectId: record.objectId, objectRevision: record.objectRevision, operation: "upsert", payload });
}

export function projectHindsightJournal(raw: HindsightJournalPage, context: HindsightReplicaProjectionContext): MemoryReplicaJournalPage {
  const page = HindsightJournalPageSchema.parse(raw);
  if (page.bankId !== context.bankId) throw new Error("HINDSIGHT_REPLICA_BANK_MISMATCH");
  const records = page.changes.map((change) => {
    const record = change.operation === "tombstone" ? { bankId: context.bankId, objectKind: change.objectKind,
      objectId: change.objectId, objectRevision: change.objectRevision, operation: "tombstone", payload: null }
      : projectHindsightReplicaRecord(HindsightLogicalSnapshotRecordSchema.parse({ objectKind: change.objectKind,
        objectId: change.objectId, objectRevision: change.objectRevision, payload: change.payload }), context);
    return { ...record, providerLineageId: change.providerLineageId, bankGeneration: change.bankGeneration,
      cursor: change.cursor, batchId: change.batchId, batchIndex: change.batchIndex, batchSize: change.batchSize,
      recordedAt: change.recordedAt };
  });
  return MemoryReplicaJournalPageSchema.parse({ bankId: page.bankId, providerLineageId: page.providerLineageId,
    bankGeneration: page.bankGeneration, predecessorCursor: page.predecessorCursor, nextCursor: page.nextCursor,
    currentCursor: page.currentCursor, minimumAvailableCursor: page.minimumAvailableCursor, hasMore: page.hasMore, records });
}

function projectPayload(record: HindsightLogicalSnapshotRecord, context: HindsightReplicaProjectionContext): unknown {
  const payload = record.payload; const authorityEpochId = context.authorityEpochId;
  if (payload.kind === "bank") return { kind: "bank", value: { ...payload.value,
    authorityEpochId, revision: record.objectRevision, scope: context.projection.bankScope(context.bankId) } };
  if (payload.kind === "document") return { kind: "document", value: { ...context.projection.source(record), ...payload.value,
    authorityEpochId, revision: record.objectRevision } };
  if (payload.kind === "memory_unit") return { kind: "memory_unit", value: {
    ...context.projection.memory(record), unit: { ...payload.value, authorityEpochId },
  } };
  return { kind: payload.kind, value: { authorityEpochId, bankId: context.bankId,
    objectRevision: record.objectRevision, payload: { kind: payload.kind, ...payload.value } } };
}
