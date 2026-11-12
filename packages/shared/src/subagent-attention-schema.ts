/**
 * INPUT: unresolved private work escalation and inbox reconciliation facts
 * OUTPUT: bounded operator attention entries linking exact children, work and recovery targets
 * POS: shared/protocol — runtime status, never Companion speech or automatic recovery authority
 */
import { z } from "zod";

const Id = z.string().min(1).max(200);
export const SubagentAttentionParamsSchema = z.strictObject({ characterId: Id, afterId: Id.optional(), limit: z.int().min(1).max(50).default(20) });
export type SubagentAttentionParams = z.input<typeof SubagentAttentionParamsSchema>;
export const SubagentAttentionResultSchema = z.strictObject({ entries: z.array(z.strictObject({
  attentionId: Id, kind: z.enum(["needs_user_input", "reconciliation_needed", "check_in_user", "inbox_retry_exhausted"]),
  subagentId: z.uuid(), workInputId: z.uuid(), label: z.string().min(1).max(200), eventId: Id.nullable(), consumerId: Id.nullable(),
  reason: z.string().max(2000), canResume: z.boolean(),
})).max(50), nextCursor: Id.nullable() });
export type SubagentAttentionResult = z.infer<typeof SubagentAttentionResultSchema>;
export const SubagentInboxRetryParamsSchema = z.strictObject({ characterId: Id });
export type SubagentInboxRetryParams = z.infer<typeof SubagentInboxRetryParamsSchema>;
export const SubagentInboxRetryResultSchema = z.strictObject({ status: z.enum(["scheduled", "not_needed"]) });
export type SubagentInboxRetryResult = z.infer<typeof SubagentInboxRetryResultSchema>;
