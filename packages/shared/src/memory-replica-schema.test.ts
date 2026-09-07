import { describe, expect, it } from "vitest";
import { MemoryReplicaJournalPageSchema, MemoryReplicaRecordSchema, MEMORY_REPLICA_PAGE_LIMIT } from "./memory-replica-schema.ts";

const lineage = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const batch = "33333333-3333-4333-8333-333333333333";
const at = "2026-09-05T00:00:00.000Z";

function page(size = 2) {
  return { bankId: "global", providerLineageId: lineage, bankGeneration: generation,
    predecessorCursor: 8, nextCursor: 8 + size, currentCursor: 8 + size, minimumAvailableCursor: 0, hasMore: false,
    records: Array.from({ length: size }, (_, index) => ({ bankId: "global", cursor: 9 + index,
      providerLineageId: lineage, bankGeneration: generation, batchId: batch, batchIndex: index, batchSize: size,
      objectKind: "directive" as const, objectId: `d-${index}`, objectRevision: 1, operation: "tombstone" as const,
      payload: null, recordedAt: at })),
  };
}

describe("B5 journal contracts", () => {
  it("accepts a caught-up empty page without advancing the cursor", () => {
    expect(MemoryReplicaJournalPageSchema.safeParse(page(0)).success).toBe(true);
    expect(MemoryReplicaJournalPageSchema.safeParse({ ...page(0), currentCursor: 9, hasMore: true }).success).toBe(false);
    expect(MemoryReplicaJournalPageSchema.safeParse({ ...page(0), nextCursor: 9, currentCursor: 9 }).success).toBe(false);
  });
  it("accepts complete transactions beyond the requested soft limit and rejects a truncated transaction", () => {
    expect(MemoryReplicaJournalPageSchema.safeParse(page(501)).success).toBe(true);
    const value = page(); value.records.pop(); value.nextCursor = 9; value.hasMore = true;
    expect(MemoryReplicaJournalPageSchema.safeParse(value).success).toBe(false);
    const oversized = page(1); oversized.records[0]!.batchSize = MEMORY_REPLICA_PAGE_LIMIT + 1;
    expect(MemoryReplicaJournalPageSchema.safeParse(oversized).success).toBe(false);
  });
  it("rejects cursor gaps, skipped targets, wrong batch order, and expired windows", () => {
    const gap = page(); gap.records[1]!.cursor = 11; gap.currentCursor = 11; gap.nextCursor = 11;
    const skipped = { ...page(), nextCursor: 11, currentCursor: 11 };
    const order = page(); order.records[1]!.batchIndex = 0;
    const wrongBank = page(); wrongBank.records[0]!.bankId = "other";
    for (const value of [gap, skipped, order, wrongBank, { ...page(), minimumAvailableCursor: 9 }]) {
      expect(MemoryReplicaJournalPageSchema.safeParse(value).success).toBe(false);
    }
  });
  it("rejects interleaved batches and reused transaction identities", () => {
    const value = page(4); const other = "44444444-4444-4444-8444-444444444444";
    value.records.forEach((record, index) => { record.batchId = index % 2 ? other : batch; record.batchIndex = Math.floor(index / 2); record.batchSize = 2; });
    expect(MemoryReplicaJournalPageSchema.safeParse(value).success).toBe(false);
  });
  it("rejects duplicate logical objects inside one provider transaction", () => {
    const value = page(); value.records[1]!.objectId = value.records[0]!.objectId;
    expect(MemoryReplicaJournalPageSchema.safeParse(value).success).toBe(false);
  });
  it("accepts successive revisions of the same object across distinct provider transactions", () => {
    const value = page();
    value.records.forEach((record, index) => { record.objectId = "same-object"; record.objectRevision = index + 1;
      record.batchId = index === 0 ? batch : generation; record.batchIndex = 0; record.batchSize = 1; });
    expect(MemoryReplicaJournalPageSchema.safeParse(value).success).toBe(true);
  });
  it("requires matching canonical kind, Bank, identity, and authoritative revision", () => {
    const value = { bankId: "global", objectKind: "bank", objectId: "global", objectRevision: 1, operation: "upsert", payload: {
      kind: "bank", value: { authorityEpochId: "epoch", bankId: "global", scope: { kind: "global", characterId: null },
        name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {},
        revision: 1, createdAt: at, updatedAt: at },
    } };
    expect(MemoryReplicaRecordSchema.safeParse(value).success).toBe(true);
    for (const invalid of [{ ...value, objectKind: "document" }, { ...value, objectId: "other" },
      { ...value, bankId: "other" }, { ...value, objectRevision: 2 }, { ...value, payload: { secret: "raw" } },
      { ...value, payload: { ...value.payload, value: { ...value.payload.value, config: { llm_api_key: "secret-value" } } } },
      { ...value, operation: "tombstone" }]) expect(MemoryReplicaRecordSchema.safeParse(invalid).success).toBe(false);
  });
});
