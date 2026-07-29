/**
 * INPUT:  process env (TAKI_MEMORY_PINNED_BUDGET)
 * OUTPUT: loadMemoryConfig(env) -> { pinnedBudget }; DEFAULT_PINNED_BUDGET; garbage/zero/negative = fatal at boot
 * POS:    core/config — the pinned-region safety valve (T5-R13): an absolute token cap, not a target; the panel
 *         surface for it is #26's
 */
import { z } from "zod";

// The pinned region's content is naturally bounded (promises + high-importance profile), so this number is a SAFETY
// VALVE rather than a target (T5-R13's correction). Blocks carry their own per-block budgets in the block registry.
export const DEFAULT_PINNED_BUDGET = 800;

// Env-var name IS the schema key so a fatal boot error names it. Coerce + int + positive: "abc"/"0"/"-1"/"3.5" all
// throw at boot (fail-closed — a garbage budget must never silently drop every pinned memory or lift the cap).
export const MemoryConfigSchema = z
  .object({
    TAKI_MEMORY_PINNED_BUDGET: z.coerce.number().int().positive().default(DEFAULT_PINNED_BUDGET),
  })
  .transform((env) => ({ pinnedBudget: env.TAKI_MEMORY_PINNED_BUDGET }));

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export function loadMemoryConfig(env: Record<string, string | undefined>): MemoryConfig {
  return MemoryConfigSchema.parse({ TAKI_MEMORY_PINNED_BUDGET: env.TAKI_MEMORY_PINNED_BUDGET });
}
