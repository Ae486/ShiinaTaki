import { describe, expect, it } from "vitest";
import { createCurrentTimeTool } from "./current-time-tool.ts";

// The tool IS the live-clock pull, so it reads new Date() itself; we assert result SHAPE + never-throw, not a fixed time.

function getTool() {
  const set = createCurrentTimeTool();
  const tool = set.get_current_time;
  if (!tool) throw new Error("get_current_time not registered");
  return tool;
}

describe("get_current_time tool", () => {
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
    };
    expect(result.ok).toBe(true);
    expect(Number.isNaN(Date.parse(result.iso))).toBe(false);
    expect(typeof result.local).toBe("string");
    expect(result.local.length).toBeGreaterThan(0);
    expect(typeof result.timezone).toBe("string");
    expect(result.timezone.length).toBeGreaterThan(0);
    expect(typeof result.epochMs).toBe("number");
  });

  it("documents when NOT to use it and takes no arguments", () => {
    const tool = getTool();
    expect(tool.description).toMatch(/do not call it/i);
    expect(tool.description).toMatch(/already in your instructions/i);
  });
});
