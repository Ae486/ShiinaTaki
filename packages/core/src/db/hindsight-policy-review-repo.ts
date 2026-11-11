/**
 * INPUT:  exact Bank namespace, calendar progress and measured curator work counts
 * OUTPUT: durable coalesced occurrences and read-only operator progress, preserved across runtime loss
 * POS:    core/db — schedule aggregate only; item claims/results remain hindsight_policy_work's responsibility
 */
import { z } from "zod";
import { MemoryPolicyReviewStatusSchema, type MemoryPolicyReviewStatus } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { HindsightPolicyWorkScopeSchema, type HindsightPolicyWorkScope } from "./hindsight-policy-work-contract.ts";
import { policyWorkParams } from "./hindsight-policy-work-storage.ts";
import { readHindsightPolicyWorkProgress } from "./hindsight-policy-work-progress.ts";

const Time = z.iso.datetime({ offset: true });
const Occurrence = z.strictObject({ id: z.string(), at: Time });
export const HindsightPolicyReviewProgressSchema = z.strictObject({
  scope: HindsightPolicyWorkScopeSchema,
  scheduleRevision: z.string(), anchorAt: Time, nextDueAt: Time,
  pending: Occurrence.extend({ reason: z.enum(["scheduled", "threshold", "catch-up", "recovery"]) }).nullable(),
  lastAttempted: Occurrence.nullable(), lastCompleted: Occurrence.nullable(),
  catchUpOccurrenceId: z.string().nullable(),
  state: MemoryPolicyReviewStatusSchema.shape.state,
  retryAt: Time.nullable(), failures: z.int().nonnegative(),
  eligibleRemaining: z.int().nonnegative().nullable(), savedAwaitingPublication: z.int().nonnegative().nullable(),
  observedStateCursor: z.int().nonnegative().nullable(),
});
export type HindsightPolicyReviewProgress = z.infer<typeof HindsightPolicyReviewProgressSchema>;
const WHERE = "authority_epoch_id=:epoch AND bank_id=:bank AND provider_lineage=:lineage AND bank_generation=:generation";

export function createHindsightPolicyReviewRepo(db: Database) {
  return {
    get(scope: HindsightPolicyWorkScope): HindsightPolicyReviewProgress | undefined {
      const row = db.prepare(`SELECT progress_json FROM hindsight_policy_review_schedule WHERE ${WHERE}`).get(policyWorkParams(scope));
      return row ? HindsightPolicyReviewProgressSchema.parse(JSON.parse(String(row.progress_json))) : undefined;
    },
    save(progress: HindsightPolicyReviewProgress): void {
      const value = HindsightPolicyReviewProgressSchema.parse(progress);
      db.prepare(`INSERT INTO hindsight_policy_review_schedule VALUES(:epoch,:bank,:lineage,:generation,:json)
        ON CONFLICT(authority_epoch_id,bank_id,provider_lineage,bank_generation) DO UPDATE SET progress_json=excluded.progress_json`)
        .run({ ...policyWorkParams(value.scope), json: JSON.stringify(value) });
    },
  };
}

/** Unavailable runtimes still expose their obligation; stale eligibility is explicitly unknown. */
export function readHindsightPolicyReviewStatus(db: Database, input: { epochId: string; available: boolean }): MemoryPolicyReviewStatus[] {
  return db.prepare(`SELECT s.progress_json,c.state_cursor FROM hindsight_policy_review_schedule s
    JOIN hindsight_application_replica_checkpoints c ON c.authority_epoch_id=s.authority_epoch_id AND c.bank_id=s.bank_id
    AND c.provider_lineage=s.provider_lineage AND c.bank_generation=s.bank_generation AND c.bank_deleted=0
    WHERE s.authority_epoch_id=:epoch ORDER BY s.bank_id`)
    .all({ epoch: input.epochId }).map((row) => {
      const value = HindsightPolicyReviewProgressSchema.parse(JSON.parse(String(row.progress_json)));
      const work = readHindsightPolicyWorkProgress(db, value.scope, new Date().toISOString());
      const measured = value.state !== "running" && work.saved === value.savedAwaitingPublication;
      return { bankId: value.scope.bankId, state: !input.available && value.pending ? "paused" : value.state,
        dueSince: value.pending?.at ?? null,
        eligibleRemaining: input.available && measured && row.state_cursor === value.observedStateCursor ? value.eligibleRemaining : null,
        savedAwaitingPublication: work.saved, lastCompletedAt: value.lastCompleted?.at ?? null,
        catchUpOccurrenceId: value.catchUpOccurrenceId };
    });
}
