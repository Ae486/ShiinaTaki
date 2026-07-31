import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { startSweeper } from "./sweep-runner.ts";

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

describe("startSweeper", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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
});
