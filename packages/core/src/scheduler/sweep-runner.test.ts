import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { startSweeper } from "./sweep-runner.ts";

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

describe("startSweeper", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rechecks recovered authority on explicit demand and cannot restart a stopped sweeper", () => {
    const { logger } = createCaptureLogger();
    let enabled = false;
    const sweep = vi.fn(() => undefined);
    const control = startSweeper({ name: "test", message: "swept", logger, enabled: () => enabled, sweep });
    expect(sweep).not.toHaveBeenCalled();
    enabled = true;
    control.runNow();
    expect(sweep).toHaveBeenCalledOnce();
    control.stop();
    control.runNow();
    vi.advanceTimersByTime(SWEEP_INTERVAL_MS);
    expect(sweep).toHaveBeenCalledOnce();
  });

  it("contains a failed authority gate and retries without running an unapproved sweep", () => {
    const { logger, records } = createCaptureLogger();
    let gateBroken = true;
    let passes = 0;
    const control = startSweeper({
      name: "memory", message: "swept", logger, intervalMs: 10,
      enabled: () => { if (gateBroken) throw new Error("private authority error"); return true; },
      sweep: () => { passes += 1; return undefined; },
    });
    expect(passes).toBe(0);
    expect(records).toEqual([{ level: "warn", obj: { code: "SWEEP_FAILED" }, msg: "retention sweep failed; will retry" }]);
    gateBroken = false;
    vi.advanceTimersByTime(10);
    expect(passes).toBe(1);
    control.stop();
  });

  it("sweeps once at boot and again on every 6h tick", () => {
    const { logger } = createCaptureLogger();
    let passes = 0;
    startSweeper({
      name: "test",
      message: "swept",
      logger,
      sweep: () => {
        passes += 1;
        return undefined;
      },
    });

    expect(passes).toBe(1); // the boot sweep covers what expired while the process was down
    vi.advanceTimersByTime(SWEEP_INTERVAL_MS * 3);
    expect(passes).toBe(4);
  });

  it("logs the pass's own count fields under a child logger named for the sweeper", () => {
    const { logger, records } = createCaptureLogger();
    startSweeper({
      name: "attachments",
      message: "expired attachments swept",
      logger,
      sweep: () => ({ removedCount: 2, freedBytes: 40 }),
    });

    expect(records).toEqual([
      { level: "info", obj: { removedCount: 2, freedBytes: 40 }, msg: "expired attachments swept" },
    ]);
  });

  it("stays silent when a pass reclaimed nothing", () => {
    const { logger, records } = createCaptureLogger();
    startSweeper({ name: "test", message: "swept", logger, sweep: () => undefined });

    vi.advanceTimersByTime(SWEEP_INTERVAL_MS * 5);
    expect(records).toEqual([]);
  });

  it("honors an interval override", () => {
    const { logger } = createCaptureLogger();
    let passes = 0;
    startSweeper({
      name: "test",
      message: "swept",
      logger,
      intervalMs: 1000,
      sweep: () => {
        passes += 1;
        return undefined;
      },
    });

    vi.advanceTimersByTime(3000);
    expect(passes).toBe(4);
  });

  it("does not hold the process open (the interval is unref'd)", () => {
    const { logger } = createCaptureLogger();
    const spy = vi.spyOn(globalThis, "setInterval");
    startSweeper({ name: "test", message: "swept", logger, sweep: () => undefined });

    const timer = spy.mock.results[0]?.value as { hasRef?: () => boolean };
    expect(timer.hasRef?.()).toBe(false);
    spy.mockRestore();
  });

  it("waits for a durable async result and skips ticks while that pass is pending", async () => {
    const { logger, records } = createCaptureLogger();
    let complete: (value: { archived: number }) => void = () => undefined;
    let passes = 0;
    const control = startSweeper({
      name: "memory", message: "memory swept", logger, intervalMs: 10,
      sweep: () => {
        passes += 1;
        return new Promise<{ archived: number }>((resolve) => { complete = resolve; });
      },
    });
    vi.advanceTimersByTime(30);
    expect(passes).toBe(1);
    expect(records).toEqual([]);
    complete({ archived: 2 });
    await Promise.resolve();
    expect(records).toEqual([{ level: "info", obj: { archived: 2 }, msg: "memory swept" }]);
    vi.advanceTimersByTime(10);
    expect(passes).toBe(2);
    control.stop();
    complete({ archived: 0 });
    await Promise.resolve();
  });

  it("contains async failure without logging private errors and retries on the next tick", async () => {
    const { logger, records } = createCaptureLogger();
    let passes = 0;
    const control = startSweeper({
      name: "memory", message: "memory swept", logger, intervalMs: 10,
      sweep: async () => {
        passes += 1;
        if (passes === 1) throw new Error("private source and provider credential");
        return { deleted: 1 };
      },
    });
    await Promise.resolve();
    expect(records).toEqual([{ level: "warn", obj: { code: "SWEEP_FAILED" }, msg: "retention sweep failed; will retry" }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(passes).toBe(2);
    expect(records.at(-1)?.obj).toEqual({ deleted: 1 });
    control.stop();
  });

  it("stops future ticks and preserves the runtime authority gate", () => {
    const { logger } = createCaptureLogger();
    let enabled = false;
    let passes = 0;
    const control = startSweeper({
      name: "memory", message: "memory swept", logger, intervalMs: 10,
      enabled: () => enabled,
      sweep: () => { passes += 1; return undefined; },
    });
    expect(passes).toBe(0);
    enabled = true;
    vi.advanceTimersByTime(10);
    expect(passes).toBe(1);
    control.stop();
    vi.advanceTimersByTime(30);
    expect(passes).toBe(1);
  });
});
