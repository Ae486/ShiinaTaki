import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { logHealthyTransitionFailure } from "./transition-healthy-execution.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("healthy failure diagnostics", () => {
  it("logs only closed codes and never arbitrary message, name or stack, even when the sink throws", () => {
    const { logger, records } = createCaptureLogger();
    const error = new Error("private body credential"); error.name = "private error name";
    logHealthyTransitionFailure(logger, error, "candidate");
    logHealthyTransitionFailure(logger, new Error("MEMORY_TRANSITION_LEASE_LOST"), "publication");
    const serialized = JSON.stringify(records);
    expect(serialized).toContain("MEMORY_TRANSITION_UNCLASSIFIED");
    expect(serialized).toContain("MEMORY_TRANSITION_LEASE_LOST");
    expect(serialized).not.toContain("private"); expect(serialized).not.toContain("stack");
    const malformed = Object.defineProperty(new Error(), "message", { get() { throw new Error("malformed error metadata"); } });
    expect(() => logHealthyTransitionFailure(logger, malformed, "service")).not.toThrow();
    vi.spyOn(logger, "warn").mockImplementation(() => { throw new Error("sink failure"); });
    expect(() => logHealthyTransitionFailure(logger, error, "service")).not.toThrow();
  });

  it("records the actual failed production stage without changing abort or publication truth", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      vi.spyOn(h.runtime.transitions, "publish").mockImplementationOnce(() => { throw new Error("MEMORY_TRANSITION_LEASE_LOST"); });
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      expect(h.owner.status(admitted.operationId).state).toBe("failed");
      expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(0);
      expect(h.records).toContainEqual(expect.objectContaining({ obj: { code: "MEMORY_TRANSITION_LEASE_LOST", stage: "publication" } }));
    } finally { await h.close(); }
  });
});
