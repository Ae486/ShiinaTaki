import { describe, expect, it } from "vitest";
import { createSchedulePatternAdapter } from "./schedule-pattern.ts";

describe("schedule pattern adapter", () => {
  const adapter = createSchedulePatternAdapter();
  it("calculates at and anchored every slots", () => {
    expect(adapter.next({ kind: "at", at: "2026-08-25T00:00:00.000Z" }, "UTC", new Date("2026-08-24T00:00:00.000Z"))?.scheduledFor).toBe("2026-08-25T00:00:00.000Z");
    expect(adapter.next({ kind: "every", everyMs: 60_000, anchorAt: "2026-08-25T00:00:00.000Z" }, "UTC", new Date("2026-08-25T00:00:30.000Z"))?.scheduledFor).toBe("2026-08-25T00:01:00.000Z");
    expect(adapter.latestDue({ kind: "every", everyMs: 60_000, anchorAt: "2026-08-25T00:00:00.000Z" }, "UTC", new Date("2026-08-25T00:01:30.000Z"))).toBe("2026-08-25T00:01:00.000Z");
  });
  it("uses Croner for timezone and DST", () => {
    const pattern = { kind: "cron" as const, expression: "0 30 2 * * *" };
    expect(adapter.next(pattern, "America/New_York", new Date("2026-03-08T06:00:00.000Z"))?.scheduledFor).toBe("2026-03-08T07:30:00.000Z");
    expect(adapter.latestDue({ kind: "cron", expression: "0 30 1 * * *" }, "America/New_York", new Date("2026-11-01T07:00:00.000Z"))).toBe("2026-11-01T05:30:00.000Z");
    expect(() => adapter.validate({ kind: "cron", expression: "nope" }, "UTC")).toThrow();
  });
});
