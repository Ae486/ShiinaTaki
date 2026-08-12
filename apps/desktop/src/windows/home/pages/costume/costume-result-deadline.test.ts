import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIMING_POLICY_DEVELOPMENT_DEFAULTS, type TimingPolicy } from "@taki/shared";
import { startCostumeResultDeadline } from "./costume-result-deadline.ts";

function policy(homeResultMs: number): TimingPolicy {
  return { ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, homeResultMs };
}

describe("costume result deadline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("captures the window-owned policy once and does not restart when the client generation changes", () => {
    let current = policy(45);
    const currentTimingPolicy = vi.fn(() => current);
    const onTimeout = vi.fn();

    startCostumeResultDeadline("taki-summer", currentTimingPolicy, onTimeout);
    current = policy(5);
    vi.advanceTimersByTime(5);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);

    expect(currentTimingPolicy).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith("taki-summer");
  });
});
