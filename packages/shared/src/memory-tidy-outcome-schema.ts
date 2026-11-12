/**
 * INPUT: content-free Local tidy progress and settled producer observations
 * OUTPUT: validated progress and full outcomes retained by the existing memory operation owner
 * POS: shared/protocol — durable tidy facts; legacy memory.tidy response compatibility stays separate
 */
import { z } from "zod";
import { MemoryTidyResultSchema } from "./memory-schema.ts";
import { MemoryTidyFailureReasonSchema, MemoryTidyIssueSchema } from "./memory-tidy-diagnostics-schema.ts";

export const MemoryTidyProgressSchema = z.strictObject({
  edits: z.int().nonnegative(),
  steps: z.int().nonnegative(),
  reviewed: z.int().nonnegative(),
  remaining: z.int().nonnegative().nullable(),
});
export type MemoryTidyProgress = z.infer<typeof MemoryTidyProgressSchema>;

export const MemoryTidyOutcomeSchema = z.strictObject({
  ...MemoryTidyResultSchema.omit({ status: true }).shape,
  status: z.enum(["clean", "ran", "partial", "failed"]),
  reason: MemoryTidyFailureReasonSchema.optional(),
  issues: z.array(MemoryTidyIssueSchema).max(20).optional(),
  issueCount: z.int().nonnegative().optional(),
  reviewed: z.int().nonnegative().optional(),
  remaining: z.int().nonnegative().optional(),
  recoveredIssues: z.int().nonnegative().optional(),
  skippedIssues: z.int().nonnegative().optional(),
  nextAction: z.enum(["none", "continue", "retry", "manual-retry", "check-settings"]).optional(),
  retryAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type MemoryTidyOutcome = z.infer<typeof MemoryTidyOutcomeSchema>;
