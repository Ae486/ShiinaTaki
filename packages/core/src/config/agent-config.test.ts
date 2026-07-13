import { describe, expect, it } from "vitest";
import { loadAgentConfig } from "./agent-config.ts";

describe("loadAgentConfig", () => {
  it("defaults maxSteps to 10 when unset", () => {
    expect(loadAgentConfig({}).maxSteps).toBe(10);
  });

  it("reads TAKI_MAX_STEPS from env", () => {
    expect(loadAgentConfig({ TAKI_MAX_STEPS: "20" }).maxSteps).toBe(20);
  });

  it("rejects non-positive, non-integer, over-cap, and non-numeric values", () => {
    for (const bad of ["0", "-3", "2.5", "999", "abc"]) {
      expect(() => loadAgentConfig({ TAKI_MAX_STEPS: bad }), bad).toThrow();
    }
  });
});
