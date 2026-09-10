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
  source(record: HindsightLogicalSnapshotRecord): Pick<CanonicalMemorySource, "retainedText" | "context" | "provenance">
    & Partial<Pick<CanonicalMemorySource, "metadata">>;
  memory(record: HindsightLogicalSnapshotRecord): Pick<CanonicalMemoryRecord, "policy" | "provenance">
    & { unitMetadata?: CanonicalMemoryRecord["unit"]["metadata"] };
  assertContext?(context: Omit<HindsightReplicaProjectionContext, "projection">): void;
}
export interface HindsightReplicaProjectionContext {
  authorityEpochId: string; bankId: string; projection: HindsightReplicaProjection;
  providerLineageId?: string; bankGeneration?: string;
}

export function projectHindsightReplicaRecord(raw: HindsightLogicalSnapshotRecord, context: HindsightReplicaProjectionContext): MemoryReplicaRecord {
  const record = HindsightLogicalSnapshotRecordSchema.parse(raw);
  if (record.payload.value.bankId !== context.bankId) throw new Error("HINDSIGHT_REPLICA_BANK_MISMATCH");
  context.projection.assertContext?.(context);
  const payload = MemoryReplicaPayloadSchema.parse(projectPayload(record, context));
  return MemoryReplicaRecordSchema.parse({ bankId: context.bankId, objectKind: record.objectKind,
    objectId: record.objectId, objectRevision: record.objectRevision, operation: "upsert", payload });
}

export function projectHindsightJournal(raw: HindsightJournalPage, context: HindsightReplicaProjectionContext): MemoryReplicaJournalPage {
  const page = HindsightJournalPageSchema.parse(raw);
  if (page.bankId !== context.bankId) throw new Error("HINDSIGHT_REPLICA_BANK_MISMATCH");
  const observedContext = { ...context, providerLineageId: page.providerLineageId, bankGeneration: page.bankGeneration };
  context.projection.assertContext?.(observedContext);
  const records = page.changes.map((change) => {
    const record = change.operation === "tombstone" ? { bankId: context.bankId, objectKind: change.objectKind,
      objectId: change.objectId, objectRevision: change.objectRevision, operation: "tombstone", payload: null }
      : projectHindsightReplicaRecord(HindsightLogicalSnapshotRecordSchema.parse({ objectKind: change.objectKind,
        objectId: change.objectId, objectRevision: change.objectRevision, payload: change.payload }), observedContext);
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
  if (payload.kind === "document") {
    const source = context.projection.source(record);
    return { kind: "document", value: { ...payload.value, retainedText: source.retainedText, context: source.context,
      provenance: source.provenance, metadata: source.metadata ?? payload.value.metadata,
      authorityEpochId, revision: record.objectRevision } };
  }
  if (payload.kind === "memory_unit") {
    const memory = context.projection.memory(record);
    return { kind: "memory_unit", value: { policy: memory.policy, provenance: memory.provenance,
      unit: { ...payload.value, authorityEpochId, metadata: memory.unitMetadata ?? payload.value.metadata } } };
  }
  return { kind: payload.kind, value: { authorityEpochId, bankId: context.bankId,
    objectRevision: record.objectRevision, payload: { kind: payload.kind, ...payload.value } } };
}
