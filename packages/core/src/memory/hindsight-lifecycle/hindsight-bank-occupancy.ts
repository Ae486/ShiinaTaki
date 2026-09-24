/**
 * INPUT:  an authenticated Hindsight client, one native Bank id and the caller's bounded call context
 * OUTPUT: assertHindsightBankUnoccupied() — resolves for an absent or empty native Bank, throws HINDSIGHT_BANK_OCCUPIED when
 *         it already holds memory, documents, observations or pending operations
 * POS:    core/memory/hindsight-lifecycle — read-only probe before the first PUT for a scope with no B3 row of ours (grill G5)
 */
import type { HindsightCallContext, HindsightClient } from "../hindsight/hindsight-client.ts";
import { hindsightError } from "../hindsight/hindsight-errors.ts";

export async function assertHindsightBankUnoccupied(input: { client: HindsightClient; bankId: string; context: HindsightCallContext }): Promise<void> {
  const stats = await input.client.bankStats(input.bankId, input.context);
  if (stats.bank_id !== input.bankId) throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
  // Native stats aggregate by bank_id, so an absent Bank reports zeros; any content means a Bank we never created.
  if (stats.total_nodes > 0 || stats.total_documents > 0 || stats.total_observations > 0 || stats.pending_operations > 0) {
    throw hindsightError("HINDSIGHT_BANK_OCCUPIED");
  }
}
