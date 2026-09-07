/**
 * INPUT:  authenticated Hindsight 0.9.0 changes endpoint JSON
 * OUTPUT: bounded complete journal pages normalized into the Shared logical contract
 * POS:    core/memory/hindsight — source-grounded journal wire adapter; oversized transactions are rejected whole
 */
import { z } from "zod";
import { HindsightJournalPageSchema, MEMORY_REPLICA_PAGE_LIMIT, type HindsightJournalPage } from "@taki/shared";
import { HindsightSnapshotPageWireSchema, normalizeHindsightLogicalRecord } from "./hindsight-snapshot-contracts.ts";

const Cursor = z.int().min(0);
const SnapshotRecord = HindsightSnapshotPageWireSchema.shape.records.element;
const Change = SnapshotRecord.extend({
  cursor: z.int().min(1), provider_lineage: z.string().uuid(), bank_generation: z.string().uuid(),
  batch_id: z.string().uuid(), batch_index: Cursor, batch_size: z.int().min(1).max(MEMORY_REPLICA_PAGE_LIMIT),
  operation: z.enum(["upsert", "tombstone"]), payload: SnapshotRecord.shape.payload.nullable(),
  recorded_at: z.iso.datetime({ offset: true }),
});
export const HindsightJournalWireSchema = z.strictObject({
  provider_lineage: z.string().uuid(), bank_generation: z.string().uuid(), from_cursor: Cursor,
  next_cursor: Cursor, current_cursor: Cursor, minimum_available_cursor: Cursor, has_more: z.boolean(),
  changes: z.array(Change).max(MEMORY_REPLICA_PAGE_LIMIT),
});

export function normalizeHindsightJournal(value: z.infer<typeof HindsightJournalWireSchema>, bankId: string): HindsightJournalPage {
  return HindsightJournalPageSchema.parse({ bankId, providerLineageId: value.provider_lineage,
    bankGeneration: value.bank_generation, predecessorCursor: value.from_cursor, nextCursor: value.next_cursor,
    currentCursor: value.current_cursor, minimumAvailableCursor: value.minimum_available_cursor, hasMore: value.has_more,
    changes: value.changes.map((change) => ({
      cursor: change.cursor, providerLineageId: change.provider_lineage, bankGeneration: change.bank_generation,
      batchId: change.batch_id, batchIndex: change.batch_index, batchSize: change.batch_size,
      objectKind: change.object_kind, objectId: change.object_id, objectRevision: change.object_revision,
      operation: change.operation, recordedAt: change.recorded_at,
      payload: change.payload === null ? null : normalizeHindsightLogicalRecord({ object_kind: change.object_kind,
        object_id: change.object_id, object_revision: change.object_revision, payload: change.payload }).payload,
    })),
  });
}
