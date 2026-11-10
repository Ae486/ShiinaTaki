/**
 * INPUT: safe failed/partial memory-maintenance observations from Core
 * OUTPUT: typed JSON-RPC error detail preserving counts without exposing memory content
 * POS: shared/protocol — additive diagnostics beside unchanged clean/ran tidy responses
 */
import { z } from "zod";
import { MemoryErrorCodeSchema } from "./memory-provider-domain-schema.ts";
import { MemoryTidyResultSchema } from "./memory-schema.ts";

export const MemoryTidyToolNameSchema = z.enum([
  "memory_reinforce", "memory_archive_supersede", "memory_set_disclosure", "memory_refile",
  "block_rethink", "memory_finish_edits", "unknown",
]);
export const MemoryTidyIssueSchema = z.strictObject({
  toolName: MemoryTidyToolNameSchema,
  code: MemoryErrorCodeSchema,
  issueId: z.string().min(1).max(96).optional(),
  stage: z.enum(["input", "reference", "write", "completion"]).optional(),
  field: z.enum(["id", "layer", "content", "disclosure", "replacement", "unknown"]).optional(),
});
export type MemoryTidyIssue = z.infer<typeof MemoryTidyIssueSchema>;
export const MemoryTidyFailureReasonSchema = z.enum(["tool-errors", "execution-failed", "review-stale", "unfinished", "timeout", "input-too-large"]);
export type MemoryTidyFailureReason = z.infer<typeof MemoryTidyFailureReasonSchema>;
export const MemoryTidyFailureDetailsSchema = z.strictObject({
  ...MemoryTidyResultSchema.omit({ status: true }).shape,
  kind: z.literal("memory-tidy"), status: z.enum(["partial", "failed"]),
  reason: MemoryTidyFailureReasonSchema,
  issues: z.array(MemoryTidyIssueSchema).max(20), issueCount: z.int().nonnegative(),
}).superRefine((value, context) => {
  if ((value.status === "partial") !== (value.edits > 0)) {
    context.addIssue({ code: "custom", path: ["status"], message: "partial requires completed edits; failed has none" });
  }
  if (value.issueCount < value.issues.length) {
    context.addIssue({ code: "custom", path: ["issueCount"], message: "issueCount must include every listed issue" });
  }
});
export type MemoryTidyFailureDetails = z.infer<typeof MemoryTidyFailureDetailsSchema>;
