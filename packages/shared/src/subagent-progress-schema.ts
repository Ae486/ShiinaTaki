/**
 * INPUT: committed task-model steps, captured interval policy and persisted model usage
 * OUTPUT: factual work check-in and cumulative child usage projections
 * POS: shared/protocol — runtime evidence only; no model-authored authority or mirrored counters
 */
import { z } from "zod";

export const SubagentCheckInPolicySchema = z.strictObject({ steps: z.int().positive(), parentApprovals: z.int().nonnegative() });
export type SubagentCheckInPolicy = z.infer<typeof SubagentCheckInPolicySchema>;
const Interval = z.strictObject({
  completedSteps: z.int().nonnegative(), intervalStartSteps: z.int().nonnegative(), intervalSteps: z.int().positive(),
  parentApprovalLimit: z.int().nonnegative(), consecutiveParentApprovals: z.int().nonnegative(),
});
export const SubagentWorkProgressSchema = Interval.extend({ workInputId: z.uuid(), tracking: z.enum(["work_start", "post_upgrade"]) });
export type SubagentWorkProgress = z.infer<typeof SubagentWorkProgressSchema>;
export const SubagentCheckInSchema = Interval.extend({ requiredActor: z.enum(["parent_or_user", "user"]), reportKind: z.literal("core_snapshot") });
export type SubagentCheckIn = z.infer<typeof SubagentCheckInSchema>;
export const SubagentTokenUsageSchema = z.strictObject({
  modelEffects: z.int().nonnegative(), inflightEffects: z.int().nonnegative(), missingUsageEffects: z.int().nonnegative(),
  inputTokens: z.int().nonnegative().nullable(), outputTokens: z.int().nonnegative().nullable(),
  totalTokens: z.int().nonnegative().nullable(), knownTotalTokens: z.int().nonnegative().nullable(), complete: z.boolean(),
});
export type SubagentTokenUsage = z.infer<typeof SubagentTokenUsageSchema>;
