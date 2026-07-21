import { describe, expect, it } from "vitest";
import type { ForegroundWindowOutput } from "@taki/shared";
import { createActivityState, type ActivityConfig } from "./activity-state.ts";

const CONFIG: ActivityConfig = {
  pulsetimeMs: 60_000,
  dwellMinSamples: 2,
  idleThresholdSeconds: 180,
  spanMs: 2 * 60 * 60 * 1000,
  maxEntries: 240,
};

function sample(over: Partial<ForegroundWindowOutput> = {}): ForegroundWindowOutput {
  return { available: true, processName: "Code.exe", windowTitle: "main.ts", idleSeconds: 0, ...over };
}

describe("createActivityState", () => {
  it("merges identical samples within pulsetime into one growing entry", () => {
    const state = createActivityState(CONFIG);
    state.push(sample(), 0);
    state.push(sample(), 30_000);
    const entries = state.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ processName: "Code.exe", windowTitle: "main.ts", samples: 2, durationMs: 30_000 });
  });

  it("splits on a window-title change", () => {
    const state = createActivityState({ ...CONFIG, dwellMinSamples: 1 });
    state.push(sample({ windowTitle: "a.ts" }), 0);
    state.push(sample({ windowTitle: "b.ts" }), 30_000);
    expect(state.entries()).toHaveLength(2);
  });

  it("splits when the gap exceeds pulsetime", () => {
    const state = createActivityState({ ...CONFIG, dwellMinSamples: 1 });
    state.push(sample(), 0);
    state.push(sample(), 70_000); // > 60s pulsetime
    expect(state.entries()).toHaveLength(2);
  });

  it("never shortens an entry's duration on an out-of-order sample", () => {
    const state = createActivityState(CONFIG);
    state.push(sample(), 0);
    state.push(sample(), 30_000);
    state.push(sample(), 10_000); // earlier than the current end — must not shrink the stretch
    const [entry] = state.entries();
    expect(entry?.durationMs).toBe(30_000);
    expect(entry?.samples).toBe(3);
  });

  it("keeps a single sample out of the reportable set until dwell is met", () => {
    const state = createActivityState(CONFIG);
    state.push(sample(), 0);
    expect(state.entries()).toHaveLength(0); // 1 sample < dwell 2
    expect(state.current()).toMatchObject({ samples: 1 }); // but it IS the live entry
    state.push(sample(), 30_000);
    expect(state.entries()).toHaveLength(1); // 2 samples => reportable
  });

  it("marks the stream idle when idleSeconds crosses the threshold (splitting active from idle)", () => {
    const state = createActivityState({ ...CONFIG, dwellMinSamples: 1 });
    state.push(sample({ idleSeconds: 10 }), 0);
    state.push(sample({ idleSeconds: 200 }), 30_000); // >= 180 => idle, distinct identity
    const entries = state.entries();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.idle).toBe(false);
    expect(entries[1]?.idle).toBe(true);
  });

  it("treats unknown idleSeconds (null) as active", () => {
    const state = createActivityState(CONFIG);
    state.push(sample({ idleSeconds: null }), 0);
    state.push(sample({ idleSeconds: null }), 30_000);
    expect(state.entries()[0]?.idle).toBe(false);
  });

  it("seals the live entry on an available:false sample so the next sample opens fresh", () => {
    const state = createActivityState({ ...CONFIG, dwellMinSamples: 1 });
    state.push(sample(), 0);
    state.push(sample(), 30_000);
    state.push({ available: false, processName: null, windowTitle: null, idleSeconds: null }, 45_000);
    expect(state.current()).toBeUndefined(); // nothing is live while foreground is unavailable
    state.push(sample(), 50_000); // within pulsetime, same data — but sealed => new entry
    expect(state.entries()).toHaveLength(2);
  });

  it("enforces the hard entry cap, dropping the oldest", () => {
    const state = createActivityState({ ...CONFIG, dwellMinSamples: 1, maxEntries: 2 });
    state.push(sample({ windowTitle: "a" }), 0);
    state.push(sample({ windowTitle: "b" }), 70_000);
    state.push(sample({ windowTitle: "c" }), 140_000);
    const titles = state.entries().map((e) => e.windowTitle);
    expect(titles).toEqual(["b", "c"]);
  });

  it("drops entries older than the span window", () => {
    const state = createActivityState({ ...CONFIG, dwellMinSamples: 1, spanMs: 100_000 });
    state.push(sample({ windowTitle: "old" }), 0);
    state.push(sample({ windowTitle: "new" }), 500_000); // old entry ended long before span cutoff
    const titles = state.entries().map((e) => e.windowTitle);
    expect(titles).toEqual(["new"]);
  });
});
