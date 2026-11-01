import { expect, it } from "vitest";
import { MemoryTidyResultSchema } from "./memory-schema.ts";
import { MemoryTidyFailureDetailsSchema } from "./memory-tidy-diagnostics-schema.ts";

const success = { status: "ran", defects: { missingDisclosure: 0, overBudget: 0, stale: 0, nearDuplicate: 0, misfiled: 1 },
  edits: 1, steps: 2, usage: { calls: 1, inputTokens: 8, outputTokens: 3, usageUnknown: 0 } };
const partial = { ...success, kind: "memory-tidy", status: "partial", reason: "tool-errors", issueCount: 1,
  issues: [{ toolName: "memory_refile", code: "MEMORY_REVISION_MISMATCH" }] };

it("keeps original success payloads unchanged and separates incomplete results", () => {
  expect(MemoryTidyResultSchema.parse(success)).toEqual(success);
  expect(MemoryTidyFailureDetailsSchema.parse(partial)).toEqual(partial);
  expect(MemoryTidyResultSchema.safeParse(partial).success).toBe(false);
});

it("rejects misleading completion counts and truncated issue totals", () => {
  expect(MemoryTidyFailureDetailsSchema.safeParse({ ...partial, edits: 0 }).success).toBe(false);
  expect(MemoryTidyFailureDetailsSchema.safeParse({ ...partial, status: "failed" }).success).toBe(false);
  expect(MemoryTidyFailureDetailsSchema.safeParse({ ...partial, issueCount: 0 }).success).toBe(false);
  expect(MemoryTidyFailureDetailsSchema.parse({ ...partial, status: "failed", edits: 0 }).status).toBe("failed");
});

it("accepts only bounded closed diagnostics, excluding private payloads", () => {
  expect(MemoryTidyFailureDetailsSchema.safeParse({ ...partial, prompt: "private" }).success).toBe(false);
  expect(MemoryTidyFailureDetailsSchema.safeParse({ ...partial, issues: [{ ...partial.issues[0], args: "private" }] }).success).toBe(false);
  expect(MemoryTidyFailureDetailsSchema.safeParse({ ...partial, issues: [{ toolName: "untrusted", code: "secret" }] }).success).toBe(false);
  expect(MemoryTidyFailureDetailsSchema.safeParse({ ...partial, issues: Array(21).fill(partial.issues[0]), issueCount: 21 }).success).toBe(false);
});
