import { describe, expect, it } from "vitest";
import { HindsightJournalPageSchema } from "./hindsight-journal-schema.ts";
import { MEMORY_REPLICA_PAGE_LIMIT } from "./memory-replica-schema.ts";

const lineage = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const batch = "33333333-3333-4333-8333-333333333333";

function page(size = 2) {
  return { bankId: "global", providerLineageId: lineage, bankGeneration: generation,
    predecessorCursor: 8, nextCursor: 8 + size, currentCursor: 8 + size, minimumAvailableCursor: 0, hasMore: false,
    changes: Array.from({ length: size }, (_, index) => ({ cursor: 9 + index,
      providerLineageId: lineage, bankGeneration: generation, batchId: batch, batchIndex: index, batchSize: size,
      objectKind: "directive" as const, objectId: `d-${index}`, objectRevision: 1, operation: "tombstone" as const,
      payload: null, recordedAt: "2026-09-05T00:00:00.000Z" })),
  };
}

describe("Hindsight logical journal validation before projection", () => {
  it("rejects invalid provider cursor windows and empty nonterminal pages", () => {
    for (const value of [{ ...page(), minimumAvailableCursor: 9 }, { ...page(), currentCursor: 9 },
      { ...page(0), currentCursor: 9, hasMore: true }]) {
      expect(HindsightJournalPageSchema.safeParse(value).success).toBe(false);
    }
  });
  it("rejects per-change lineage and Bank generation drift", () => {
    for (const key of ["providerLineageId", "bankGeneration"] as const) {
      const value = page(); value.changes[0]![key] = batch;
      expect(HindsightJournalPageSchema.safeParse(value).success).toBe(false);
    }
  });
  it("rejects repeated transaction identities and duplicate objects within a transaction", () => {
    const repeated = page(3);
    repeated.changes.forEach((change, index) => { change.batchSize = 1; change.batchIndex = 0; change.batchId = index === 1 ? generation : batch; });
    expect(HindsightJournalPageSchema.safeParse(repeated).success).toBe(false);
    const duplicate = page(); duplicate.changes[1]!.objectId = duplicate.changes[0]!.objectId;
    expect(HindsightJournalPageSchema.safeParse(duplicate).success).toBe(false);
  });
  it("accepts successive revisions of one object in separate complete transactions", () => {
    const value = page();
    value.changes.forEach((change, index) => { change.objectId = "same-object"; change.objectRevision = index + 1;
      change.batchId = index === 0 ? batch : generation; change.batchIndex = 0; change.batchSize = 1; });
    expect(HindsightJournalPageSchema.safeParse(value).success).toBe(true);
  });
  it("admits the full record bound and rejects the entire first oversized transaction", () => {
    expect(HindsightJournalPageSchema.safeParse(page(MEMORY_REPLICA_PAGE_LIMIT)).success).toBe(true);
    expect(HindsightJournalPageSchema.safeParse(page(MEMORY_REPLICA_PAGE_LIMIT + 1)).success).toBe(false);
  });
});
