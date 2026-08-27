import { describe, expect, it } from "vitest";
import { MonitorModeSchema, RunMonitorListParamsSchema, RunMonitorEventSchema } from "./observability-schema.ts";

describe("observability schemas", () => {
  it("keeps the mode closed and disabled by explicit value", () => { expect(MonitorModeSchema.options).toEqual(["DISABLED", "FEEDBACK_ONLY", "FULL_LOCAL"]); });
  it("rejects oversized pages, stale ranges, and unknown filters", () => { expect(RunMonitorListParamsSchema.safeParse({ characterId: "taki", limit: 51 }).success).toBe(false); expect(RunMonitorListParamsSchema.safeParse({ characterId: "taki", from: "2026-08-28T00:00:00.000Z", to: "2026-08-27T00:00:00.000Z" }).success).toBe(false); expect(RunMonitorListParamsSchema.safeParse({ characterId: "taki", raw: true }).success).toBe(false); });
  it("keeps live notifications bounded and rejects raw payload fields", () => { expect(RunMonitorEventSchema.safeParse({ runKey: "run", cursor: 1, invalidated: true, reason: "overflow" }).success).toBe(true); expect(RunMonitorEventSchema.safeParse({ runKey: "run", cursor: 1, payload: { secret: "x" } }).success).toBe(false); });
});
