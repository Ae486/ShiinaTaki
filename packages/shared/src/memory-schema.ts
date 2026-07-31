/**
 * INPUT:  candidate memory.* params/result payloads (parsed WS frames from a Pet UI operator)
 * OUTPUT: MEMORY_METHODS + MemoryTidy param & result schemas (the operator-invoked store-maintenance pass)
 * POS:    shared/protocol — the memory maintenance contract (invariants 3, 7); operator-only, NO Rust mirror; counts
 *         only — memory content never rides this surface
 */
import { z } from "zod";

export const MEMORY_METHODS = {
  tidy: "memory.tidy", // operator → core: run the tidy pass NOW (bypasses the write-count trigger)
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
