/**
 * INPUT:  exact policy-work namespace and observation time
 * OUTPUT: all unfinished/saved counts and the earliest claim/retry release, including non-runnable work
 * POS:    core/db — read-only journal metadata; never treats an empty runnable page as completion
 */
import type { Database } from "./sqlite.ts";
import type { HindsightPolicyWorkScope } from "./hindsight-policy-work-contract.ts";
import { policyWorkParams } from "./hindsight-policy-work-storage.ts";

export function readHindsightPolicyWorkProgress(db: Database, scope: HindsightPolicyWorkScope, at: string) {
  const row = db.prepare(`SELECT COUNT(*) AS remaining,
    COUNT(CASE WHEN result_bytes IS NOT NULL THEN 1 END) AS saved,
    MIN(MAX(COALESCE(next_attempt_at,:at),COALESCE(claim_until,:at),:at)) AS retry
    FROM hindsight_policy_work WHERE authority_epoch_id=:epoch AND bank_id=:bank
    AND provider_lineage=:lineage AND bank_generation=:generation AND state IN ('ready','claimed','saved')`)
    .get({ ...policyWorkParams(scope), at });
  return { remaining: Number(row?.remaining ?? 0), saved: Number(row?.saved ?? 0),
    retryAt: typeof row?.retry === "string" ? row.retry : null };
}
