import { afterEach, describe, expect, it, vi } from "vitest";
import { createCurrentTimeTool } from "./current-time-tool.ts";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function getTool() {
  const set = createCurrentTimeTool();
  const tool = set.get_current_time;
  if (!tool) throw new Error("get_current_time not registered");
  return tool;
}

describe("get_current_time tool", () => {
  it("reports exact UTC wall time from the configured User Timezone with one live read", async () => {
    const at = new Date("2026-09-28T10:40:45.678Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at);
    const userTimezone = vi.fn(() => "UTC");
    const set = createCurrentTimeTool({ userTimezone });
    expect(userTimezone).not.toHaveBeenCalled();

    const result = await set.get_current_time?.execute?.({}, { toolCallId: "utc-time", messages: [], context: undefined });

    expect(result).toEqual({ ok: true, iso: "2026-09-28T10:40:45.678Z", capturedAt: "2026-09-28T10:40:45.678Z",
      epochMs: 1790592045678, timezone: "UTC", local: at.toLocaleString(undefined, { timeZone: "UTC" }) });
    expect(userTimezone).toHaveBeenCalledOnce();
  });

  it("reads a changed user zone on every execution and crosses the civil-day boundary", async () => {
    const at = new Date("2026-09-28T00:30:45.678Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at);
    let timezone = "America/New_York";
    const set = createCurrentTimeTool({ userTimezone: () => timezone });
    const first = await set.get_current_time?.execute?.({}, { toolCallId: "first-time", messages: [], context: undefined });
    expect(first).toMatchObject({ timezone: "America/New_York", local: at.toLocaleString(undefined, { timeZone: timezone }) });

    timezone = "Pacific/Kiritimati";
    const second = await set.get_current_time?.execute?.({}, { toolCallId: "second-time", messages: [], context: undefined });
    expect(second).toMatchObject({ timezone, local: at.toLocaleString(undefined, { timeZone: timezone }) });
    expect(second).not.toEqual(first);
  });

  it("returns a structured error when the supplied authority cannot be read instead of falling back to the host", async () => {
    const set = createCurrentTimeTool({ userTimezone: () => { throw new Error("timezone unavailable"); } });
    const result = await set.get_current_time?.execute?.({}, { toolCallId: "failed-time", messages: [], context: undefined });
    expect(result).toEqual({
      ok: false, code: "INTERNAL_ERROR", message: "timezone unavailable",
    });
  });

  it("registers under the snake_case name get_current_time", () => {
    expect(Object.keys(createCurrentTimeTool())).toEqual(["get_current_time"]);
  });

  it("returns a structured, valid time result and never throws", async () => {
    const tool = getTool();
    const result = (await tool.execute?.({}, { toolCallId: "t1", messages: [] } as never)) as {
      ok: boolean;
      iso: string;
      local: string;
      timezone: string;
      epochMs: number;
      capturedAt: string;
    };
    expect(result.ok).toBe(true);
    expect(Number.isNaN(Date.parse(result.iso))).toBe(false);
    expect(typeof result.local).toBe("string");
    expect(result.local.length).toBeGreaterThan(0);
    expect(typeof result.timezone).toBe("string");
    expect(result.timezone.length).toBeGreaterThan(0);
    expect(result.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(result.local).toBe(new Date(result.iso).toLocaleString());
    expect(typeof result.epochMs).toBe("number");
    // Q5 class marker: identical to `iso` BY CONSTRUCTION (same Date) — the state-snapshot family is uniformly
    // foldable by capturedAt (batch 7 reads one field name across the class).
    expect(result.capturedAt).toBe(result.iso);
  });

  it("documents when NOT to use it and takes no arguments", () => {
    const tool = getTool();
    expect(tool.description).toMatch(/do not call it/i);
    expect(tool.description).toMatch(/already in your instructions/i);
  });
});
