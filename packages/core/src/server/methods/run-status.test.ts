import { describe, expect, it } from "vitest";
import { runStatusMethod } from "./run-status.ts";

describe("runStatusMethod", () => {
  it("is operator-only and delegates by runId", () => {
    const expected = { run: { runId: "r" }, attempts: [] } as never;
    const method = runStatusMethod({ status: (runId) => { expect(runId).toBe("r"); return expected; } });
    expect(method.method).toBe("run.status");
    expect(method.roles).toEqual(["operator"]);
    expect(method.handler({ runId: "r" }, {} as never)).toBe(expected);
  });
});
