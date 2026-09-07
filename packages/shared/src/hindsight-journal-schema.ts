/**
 * INPUT:  admitted Hindsight logical journal projections
 * OUTPUT: bounded complete logical-change pages using the existing B4 canonical payload vocabulary
 * POS:    shared contract — provider journal surface before Taki policy/provenance projection
 */
import { z } from "zod";
import { HindsightLogicalPayloadSchema, HindsightLogicalObjectKindSchema, HindsightLogicalSnapshotRecordSchema } from "./hindsight-cutover-schema.ts";
import { MEMORY_REPLICA_PAGE_LIMIT } from "./memory-replica-schema.ts";

const Cursor = z.int().min(0);
export const HindsightJournalChangeSchema = z.strictObject({
  cursor: z.int().min(1), providerLineageId: z.string().uuid(), bankGeneration: z.string().uuid(),
  batchId: z.string().uuid(), batchIndex: Cursor, batchSize: z.int().min(1).max(MEMORY_REPLICA_PAGE_LIMIT),
  objectKind: HindsightLogicalObjectKindSchema, objectId: z.string().min(1).max(256), objectRevision: z.int().min(1),
  operation: z.enum(["upsert", "tombstone"]), payload: HindsightLogicalPayloadSchema.nullable(),
  recordedAt: z.iso.datetime({ offset: true }),
}).superRefine((value, context) => {
  if (value.batchIndex >= value.batchSize) context.addIssue({ code: "custom", path: ["batchIndex"], message: "batch index exceeds batch size" });
  if (value.operation === "tombstone") {
    if (value.payload !== null) context.addIssue({ code: "custom", message: "tombstone cannot carry payload" });
    return;
  }
  const result = HindsightLogicalSnapshotRecordSchema.safeParse({ objectKind: value.objectKind,
    objectId: value.objectId, objectRevision: value.objectRevision, payload: value.payload });
  if (!result.success) context.addIssue({ code: "custom", message: "journal logical record is invalid" });
});
export type HindsightJournalChange = z.infer<typeof HindsightJournalChangeSchema>;

export const HindsightJournalPageSchema = z.strictObject({
  bankId: z.string().min(1).max(256), providerLineageId: z.string().uuid(), bankGeneration: z.string().uuid(),
  predecessorCursor: Cursor, nextCursor: Cursor, currentCursor: Cursor, minimumAvailableCursor: Cursor,
  hasMore: z.boolean(), changes: z.array(HindsightJournalChangeSchema).max(MEMORY_REPLICA_PAGE_LIMIT),
}).superRefine((page, context) => {
  if (page.predecessorCursor < page.minimumAvailableCursor || page.nextCursor > page.currentCursor) context.addIssue({ code: "custom", message: "cursor outside provider window" });
  if (page.nextCursor !== (page.changes.at(-1)?.cursor ?? page.predecessorCursor)) context.addIssue({ code: "custom", path: ["nextCursor"], message: "page must end at its last change cursor" });
  if (page.hasMore !== (page.nextCursor < page.currentCursor)) context.addIssue({ code: "custom", path: ["hasMore"], message: "hasMore contradicts current cursor" });
  if (page.changes.length === 0 && page.hasMore) context.addIssue({ code: "custom", message: "nonterminal empty page cannot make progress" });
  let cursor = page.predecessorCursor; let batchId: string | undefined; let batchIndex = -1; let batchSize = 0;
  const seenBatches = new Set<string>(); const batchObjects = new Set<string>();
  for (const change of page.changes) {
    if (change.providerLineageId !== page.providerLineageId || change.bankGeneration !== page.bankGeneration
      || (change.payload && change.payload.value.bankId !== page.bankId)) context.addIssue({ code: "custom", message: "journal lineage or Bank mismatch" });
    if (change.cursor !== cursor + 1) context.addIssue({ code: "custom", message: "change cursors must be contiguous" });
    if (change.batchId !== batchId) {
      if (batchId !== undefined && batchIndex !== batchSize - 1) context.addIssue({ code: "custom", message: "provider transaction page is incomplete" });
      if (seenBatches.has(change.batchId) || change.batchIndex !== 0) context.addIssue({ code: "custom", message: "provider transaction must begin once at index zero" });
      seenBatches.add(change.batchId); batchObjects.clear();
      batchId = change.batchId; batchIndex = 0; batchSize = change.batchSize;
    } else { batchIndex += 1; }
    const objectKey = `${change.objectKind}\0${change.objectId}`;
    if (batchObjects.has(objectKey)) context.addIssue({ code: "custom", message: "provider transaction contains a duplicate logical object" });
    batchObjects.add(objectKey);
    if (change.batchIndex !== batchIndex || change.batchSize !== batchSize) context.addIssue({ code: "custom", message: "provider transaction order mismatch" });
    cursor = change.cursor;
  }
  if (batchId !== undefined && batchIndex !== batchSize - 1) context.addIssue({ code: "custom", message: "provider transaction page is incomplete" });
});
export type HindsightJournalPage = z.infer<typeof HindsightJournalPageSchema>;
