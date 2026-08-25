import { describe, expect, it } from "vitest";
import { ScheduledTaskCreateParamsSchema } from "./scheduled-task-schema.ts";
describe("Scheduled Task schemas", () => {
  const base = { characterId: "taki", name: "Reminder", controlInput: "Review the agenda", timezone: { kind: "fixed" as const, timezone: "Asia/Shanghai" } };
  it("accepts canonical forms", () => {
    expect(ScheduledTaskCreateParamsSchema.parse({ ...base, pattern: { kind: "at", at: "2026-08-25T00:00:00.000Z" } }).pattern.kind).toBe("at");
    expect(ScheduledTaskCreateParamsSchema.parse({ ...base, pattern: { kind: "every", everyMs: 60_000, anchorAt: "2026-08-25T00:00:00.000Z" } }).pattern.kind).toBe("every");
  });
  it("rejects invalid timezone and empty control input", () => {
    expect(ScheduledTaskCreateParamsSchema.safeParse({ ...base, timezone: { kind: "fixed", timezone: "bad/timezone" }, pattern: { kind: "cron", expression: "* * * * *" } }).success).toBe(false);
    expect(ScheduledTaskCreateParamsSchema.safeParse({ ...base, controlInput: "", pattern: { kind: "cron", expression: "* * * * *" } }).success).toBe(false);
  });
});
