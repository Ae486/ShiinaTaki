/**
 * INPUT:  a shared Memory Authority fence, synchronous B4 promotion repository, and prepared promotion request
 * OUTPUT: bounded Local quiescence followed by one atomic Hindsight authority promotion
 * POS:    core/memory/hindsight — Wave 4 transition seam; successful promotion permanently retires Local admissions
 */
import type { Database } from "../../db/sqlite.ts";
import { promoteHindsightAuthority, type HindsightPromotionInput, type HindsightPromotionResult } from "../../db/hindsight-authority-repo.ts";
import type { MemoryAuthorityFence } from "../legacy-migration/memory-authority-fence.ts";

export async function promoteHindsightWithFence(input: {
  db: Database;
  fence: MemoryAuthorityFence;
  timeoutMs: number;
  promotion: HindsightPromotionInput;
}): Promise<HindsightPromotionResult> {
  return input.fence.quiesce({ timeoutMs: input.timeoutMs, retireOnSuccess: true }, async () =>
    promoteHindsightAuthority(input.db, input.promotion));
}
