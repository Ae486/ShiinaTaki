/**
 * INPUT:  classified rejected calls, fresh successful calls and explicit finish acknowledgements
 * OUTPUT: one review-local issue ledger with safe correction guidance and non-forgeable success references
 * POS:    core/memory — separates known no-write model mistakes from unresolved persistence failures
 */
import { z } from "zod";
import type { MemoryTidyIssue } from "@taki/shared";

export const TidyResolutionSchema = z.discriminatedUnion("status", [
  z.object({ issueId: z.string().min(1), status: z.literal("corrected"), correctedBy: z.string().min(1) }),
  z.object({ issueId: z.string().min(1), status: z.literal("not-needed"),
    reason: z.enum(["already-satisfied", "mistaken-request", "no-useful-change"]) }),
]);
export const TidyFinishSchema = z.object({ resolutions: z.array(TidyResolutionSchema).max(20).optional() });
type Resolution = z.infer<typeof TidyResolutionSchema>;
export interface TidyIssueObservation {
  toolName: MemoryTidyIssue["toolName"];
  callId: string;
  code: MemoryTidyIssue["code"];
  stage: NonNullable<MemoryTidyIssue["stage"]>;
  field?: MemoryTidyIssue["field"];
  action?: string;
  target?: string;
}
interface RecordedIssue { issue: MemoryTidyIssue; order: number; action?: string; target?: string; recoverable: boolean; }
interface Success { toolName: MemoryTidyIssue["toolName"]; callId: string; action?: string; target?: string; }
const NO_WRITE_CODES = new Set(["MEMORY_INVALID_REQUEST", "MEMORY_REVISION_MISMATCH", "MEMORY_NOT_FOUND", "MEMORY_CAPABILITY_UNSUPPORTED"]);

export function createTidyIssueLedger() {
  const pending = new Map<string, RecordedIssue>();
  const rejectedCalls = new Map<string, MemoryTidyIssue>();
  const successes = new Map<string, Success & { order: number }>();
  let order = 0;
  let recovered = 0;
  let skipped = 0;
  return {
    reject(input: TidyIssueObservation): MemoryTidyIssue {
      const key = `${input.callId}:${input.code}`;
      const old = rejectedCalls.get(key);
      if (old) return old;
      const issue: MemoryTidyIssue = { toolName: input.toolName, code: input.code,
        issueId: `issue-${rejectedCalls.size + 1}`, stage: input.stage, ...(input.field ? { field: input.field } : {}) };
      rejectedCalls.set(key, issue);
      pending.set(issue.issueId!, { issue, order: ++order, action: input.action, target: input.target, recoverable: NO_WRITE_CODES.has(input.code) });
      return issue;
    },
    success(input: Success): void {
      if (successes.has(input.callId)) return;
      successes.set(input.callId, { ...input, order: ++order });
      // Retain the previously supported exact-CAS repair; broader corrections require explicit finish evidence.
      for (const [id, entry] of pending) {
        if (entry.issue.code === "MEMORY_REVISION_MISMATCH" && input.action && entry.action === input.action) {
          pending.delete(id); recovered += 1;
        }
      }
    },
    resolve(resolutions: Resolution[]): boolean {
      const selected: string[] = [];
      for (const resolution of resolutions) {
        const entry = pending.get(resolution.issueId);
        if (!entry || !entry.recoverable || selected.includes(resolution.issueId)) return false;
        if (resolution.status === "corrected") {
          const success = successes.get(resolution.correctedBy);
          if (!success || success.order <= entry.order || success.toolName !== entry.issue.toolName) return false;
          // A changed payload can correct the request, but a different known target cannot.
          if (entry.target !== undefined && success.target !== entry.target) return false;
        }
        selected.push(resolution.issueId);
      }
      for (const id of selected) pending.delete(id);
      recovered += resolutions.filter((resolution) => resolution.status === "corrected").length;
      skipped += resolutions.filter((resolution) => resolution.status === "not-needed").length;
      return true;
    },
    pending: () => [...pending.values()].map((entry) => ({ ...entry.issue })),
    blocked: () => [...pending.values()].some((entry) => !entry.recoverable),
    recovered: () => recovered,
    skipped: () => skipped,
  };
}

export function tidyIssueHint(issue: MemoryTidyIssue): string {
  if (issue.code === "MEMORY_REVISION_MISMATCH") return "The record changed. Read the supplied current version before making a fresh edit.";
  if (issue.stage === "reference") return "Use a reference shown in this review or returned by a successful edit; do not invent a reference.";
  if (issue.stage === "input") return "Correct the indicated tool arguments according to its schema, or explicitly acknowledge an unnecessary request at finish.";
  return NO_WRITE_CODES.has(issue.code) ? "This request wrote nothing. Correct it or explicitly acknowledge why it is no longer needed at finish."
    : "This failure cannot be dismissed. Stop changing memory and leave the review incomplete for operator recovery.";
}
