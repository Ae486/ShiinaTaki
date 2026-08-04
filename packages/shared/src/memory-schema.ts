/**
 * INPUT:  candidate memory.* params/result payloads (parsed WS frames from a Pet UI operator)
 * OUTPUT: MEMORY_METHODS + MemoryTidy and MemoryStatus param & result schemas (the operator maintenance surface)
 * POS:    shared/protocol — the memory maintenance contract (invariants 3, 7); operator-only, NO Rust mirror; counts
 *         only — memory content never rides this surface
 */
import { z } from "zod";

export const MEMORY_METHODS = {
  tidy: "memory.tidy", // operator → core: run the tidy pass NOW (bypasses the write-count trigger)
  status: "memory.status", // operator → core: read the memory/context maintenance counters (never the content)
} as const;

export const MemoryTidyParamsSchema = z.object({ characterId: z.string().min(1) });
export type MemoryTidyParams = z.infer<typeof MemoryTidyParamsSchema>;

// The five report classes (rc §Concrete recommendation): candidate COUNTS, never the candidates themselves.
export const MemoryTidyDefectsSchema = z.object({
  missingDisclosure: z.int().min(0),
  overBudget: z.int().min(0),
  stale: z.int().min(0),
  nearDuplicate: z.int().min(0),
  misfiled: z.int().min(0),
});
export type MemoryTidyDefects = z.infer<typeof MemoryTidyDefectsSchema>;

export const MemoryTidyResultSchema = z.object({
  // "clean" = nothing to judge, ZERO model calls were made; "ran" = the maintenance model reviewed the store.
  status: z.enum(["clean", "ran"]),
  defects: MemoryTidyDefectsSchema,
  edits: z.int().min(0),
  steps: z.int().min(0),
  // The utility slot's cumulative spend since boot (T5-R11 "background token spend must be reportable").
  usage: z.object({
    calls: z.int().min(0),
    inputTokens: z.int().min(0),
    outputTokens: z.int().min(0),
    usageUnknown: z.int().min(0),
  }),
});
export type MemoryTidyResult = z.infer<typeof MemoryTidyResultSchema>;

export const MemoryStatusParamsSchema = z.strictObject({ characterId: z.string().min(1) });
export type MemoryStatusParams = z.infer<typeof MemoryStatusParamsSchema>;

/** One model slot's persisted window calibration (the operations page's "how big is the real window" card). */
export const MemoryWindowSlotSchema = z.strictObject({
  slot: z.string().min(1),
  effectiveWindow: z.int().positive(),
  factor: z.number().positive(),
  updatedAt: z.string().min(1),
});
export type MemoryWindowSlot = z.infer<typeof MemoryWindowSlotSchema>;

// strictObject on purpose: the summary's TEXT must never ride this surface, so a payload carrying one is REJECTED
// rather than silently stripped. Length is the only thing the panel needs to size the compaction state.
export const MemorySummaryStatusSchema = z.strictObject({
  throughSeq: z.int().min(0),
  textChars: z.int().min(0),
  updatedAt: z.string().min(1),
});
export type MemorySummaryStatus = z.infer<typeof MemorySummaryStatusSchema>;

export const MemoryAutoStatusSchema = z.strictObject({
  lastEpisodicSeq: z.int().min(0),
  lastFlushSeq: z.int().min(0),
  /** ISO timestamp of the last completed tidy pass; null = never tidied. */
  lastTidyAt: z.string().min(1).nullable(),
});
export type MemoryAutoStatus = z.infer<typeof MemoryAutoStatusSchema>;

export const MemoryStatusResultSchema = z.strictObject({
  windowSlots: z.array(MemoryWindowSlotSchema),
  /** null = the character has never been compacted. */
  summary: MemorySummaryStatusSchema.nullable(),
  auto: MemoryAutoStatusSchema,
});
export type MemoryStatusResult = z.infer<typeof MemoryStatusResultSchema>;
