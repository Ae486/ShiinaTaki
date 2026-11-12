import { afterEach, expect, it, vi } from "vitest";
import { createSubagentInboxRetry } from "./subagent-inbox-retry.ts";

afterEach(() => vi.useRealTimers());
it("coalesces bounded timers, resets on fresh opportunities and cancels all work at close", async () => {
  vi.useFakeTimers(); const opportunity = vi.fn(); const retry = createSubagentInboxRetry(opportunity);
  for (const delay of [1000, 5000, 15_000]) {
    retry.arm("taki"); retry.arm("taki");
    await vi.advanceTimersByTimeAsync(delay - 1); const before = opportunity.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1); expect(opportunity).toHaveBeenCalledTimes(before + 1);
  }
  retry.arm("taki"); await vi.advanceTimersByTimeAsync(100_000); expect(opportunity).toHaveBeenCalledTimes(3);
  retry.reset("taki"); retry.arm("taki"); await vi.advanceTimersByTimeAsync(1000); expect(opportunity).toHaveBeenCalledTimes(4);
  retry.arm("taki"); retry.close(); await vi.advanceTimersByTimeAsync(100_000); expect(opportunity).toHaveBeenCalledTimes(4);
});
