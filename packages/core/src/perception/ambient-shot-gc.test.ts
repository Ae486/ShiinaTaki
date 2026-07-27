import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AmbientRetention } from "../config/ambient-screenshot-config.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { startAmbientShotGc } from "./ambient-shot-gc.ts";
import type { AmbientShotStore } from "./ambient-shot-store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-26T10:00:00.000Z");

function harness(retention: AmbientRetention) {
  const cutoffs: number[] = [];
  const store: AmbientShotStore = {
    save: () => null,
    discard: () => undefined,
    sweepOlderThan: (cutoffMs) => {
      cutoffs.push(cutoffMs);
      return { removedCount: 1, freedBytes: 10 };
    },
  };
  const { logger, records } = createCaptureLogger();
  return { store, cutoffs, logger, records, retention };
}

describe("startAmbientShotGc", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sweeps at boot and on a 6h interval", () => {
    const h = harness({ mode: "delete-after-days", days: 3, ttlMs: 3 * DAY_MS });
    startAmbientShotGc({ store: h.store, retention: h.retention, logger: h.logger, now: () => NOW });
    expect(h.cutoffs).toEqual([NOW - 3 * DAY_MS]); // boot sweep, cutoff = now - TTL
    vi.advanceTimersByTime(SWEEP_INTERVAL_MS);
    expect(h.cutoffs).toHaveLength(2);
    expect(h.records.some((r) => r.msg?.includes("ambient frames swept"))).toBe(true);
  });

  it("reclaims EVERY leftover frame under drop-after-describe (the crash backstop)", () => {
    const h = harness({ mode: "drop-after-describe" });
    startAmbientShotGc({ store: h.store, retention: h.retention, logger: h.logger, now: () => NOW });
    expect(h.cutoffs).toEqual([NOW]); // everything already on disk predates now
  });

  it("schedules nothing at all under keep — the user asked for those frames", () => {
    const h = harness({ mode: "keep" });
    startAmbientShotGc({ store: h.store, retention: h.retention, logger: h.logger, now: () => NOW });
    vi.advanceTimersByTime(10 * SWEEP_INTERVAL_MS);
    expect(h.cutoffs).toHaveLength(0);
  });
});
