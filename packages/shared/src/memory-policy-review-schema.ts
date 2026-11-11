/**
 * INPUT:  Core's durable per-Bank review obligations and measured journal/eligibility progress
 * OUTPUT: typed policy review status for memory.authority.status, including stable catch-up notice identity
 * POS:    shared/protocol — operator read; null state means idle, null counts mean unknown
 */
import { z } from "zod";

export const MemoryPolicyReviewStatusSchema = z.strictObject({
  bankId: z.string().min(1).max(256),
  state: z.enum(["pending", "running", "paused", "error"]).nullable(),
  dueSince: z.iso.datetime({ offset: true }).nullable(),
  eligibleRemaining: z.int().nonnegative().nullable(),
  savedAwaitingPublication: z.int().nonnegative().nullable(),
  lastCompletedAt: z.iso.datetime({ offset: true }).nullable(),
  catchUpOccurrenceId: z.string().min(1).max(256).nullable(),
});
export type MemoryPolicyReviewStatus = z.infer<typeof MemoryPolicyReviewStatusSchema>;
