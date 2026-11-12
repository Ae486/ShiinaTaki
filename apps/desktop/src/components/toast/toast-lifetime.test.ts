import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_DISMISS_MS, createToastLifetime } from "./toast-lifetime.ts";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());

describe("Toast reading lifetime", () => {
  it("expires an ordinary unheld notice after exactly six seconds", () => {
    const expire = vi.fn();
    const lifetime = createToastLifetime(expire);
    lifetime.start();
    vi.advanceTimersByTime(AUTO_DISMISS_MS - 1);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("waits for both hover and keyboard focus to leave, then uses only the remaining time", () => {
    const expire = vi.fn();
    const lifetime = createToastLifetime(expire);
    lifetime.start();
    vi.advanceTimersByTime(2_000);
    lifetime.pause("pointer");
    lifetime.pause("focus");
    vi.advanceTimersByTime(9_000);
    lifetime.resume("pointer");
    vi.advanceTimersByTime(9_000);
    expect(expire).not.toHaveBeenCalled();
    lifetime.resume("focus");
    vi.advanceTimersByTime(3_999);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("keeps a deliberately held notice until explicit dismissal despite pointer/focus leaving", () => {
    const expire = vi.fn();
    const lifetime = createToastLifetime(expire);
    lifetime.start();
    lifetime.pause("focus");
    lifetime.hold();
    lifetime.resume("focus");
    lifetime.resume("pointer");
    vi.advanceTimersByTime(AUTO_DISMISS_MS * 10);
    expect(expire).not.toHaveBeenCalled();
    lifetime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up on unmount and preserves remaining time across Effect cleanup/setup replay", () => {
    const expire = vi.fn();
    const lifetime = createToastLifetime(expire);
    lifetime.start();
    vi.advanceTimersByTime(1_000);
    lifetime.stop();
    expect(vi.getTimerCount()).toBe(0);
    lifetime.start();
    vi.advanceTimersByTime(4_999);
    expect(expire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(expire).toHaveBeenCalledTimes(1);
    lifetime.stop();
    vi.advanceTimersByTime(AUTO_DISMISS_MS);
    expect(expire).toHaveBeenCalledTimes(1);
  });
});
