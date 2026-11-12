import { describe, expect, it, vi } from "vitest";
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
  it("notifies after admitted samples and preserves the current-before-dwell distinction", () => {
    const onChange = vi.fn();
    const state = createActivityState(CONFIG, onChange);
    state.push(sample(), 0);
    expect(onChange).toHaveBeenCalledExactlyOnceWith();
    expect(state.current()?.samples).toBe(1);
    expect(state.entries()).toEqual([]);
    state.push(sample(), 30_000);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(state.entries()[0]?.samples).toBe(2);
  });

  it("notifies only an effective seal, without carrying a declined sample or reason", () => {
    const onChange = vi.fn();
    const state = createActivityState(CONFIG, onChange);
    state.seal();
    state.push(sample({ available: false }), 0);
    expect(onChange).not.toHaveBeenCalled();
    state.push(sample(), 30_000);
    state.seal();
    state.seal();
    state.push(sample({ available: false, processName: "private", windowTitle: "secret" }), 60_000);
    expect(onChange.mock.calls).toEqual([[], []]);
    expect(state.current()).toBeUndefined();
  });

  it("publishes only after span/cap pruning has produced the coherent retained state", () => {
    const visible: string[][] = [];
    const state = createActivityState({ ...CONFIG, dwellMinSamples: 1, maxEntries: 2, spanMs: 100_000 }, () => {
      visible.push(state.entries().map((entry) => entry.windowTitle));
    });
    state.push(sample({ windowTitle: "a" }), 0);
    state.push(sample({ windowTitle: "b" }), 30_000);
    state.push(sample({ windowTitle: "c" }), 60_000);
    state.push(sample({ windowTitle: "d" }), 500_000);
    expect(visible).toEqual([["a"], ["a", "b"], ["b", "c"], ["d"]]);
  });

  it("an observer failure cannot make an admitted sample or effective seal fail", () => {
    const state = createActivityState(CONFIG, () => { throw new Error("observer retired"); });
    expect(() => state.push(sample(), 0)).not.toThrow();
    expect(state.current()?.windowTitle).toBe("main.ts");
    expect(() => state.seal()).not.toThrow();
    expect(state.current()).toBeUndefined();
  });

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

  it("seal() ends the live stretch with no record: current() goes undefined and the next push opens a NEW entry", () => {
    const state = createActivityState({ ...CONFIG, dwellMinSamples: 1 });
    state.push(sample(), 0);
    state.push(sample(), 30_000);
    expect(state.entries()).toHaveLength(1);

    state.seal(); // the sensitive-app skip's signal: "the foreground left" — carrying no name, title or timestamp
    expect(state.current()).toBeUndefined();
    expect(state.entries()).toHaveLength(1); // sealing records nothing of its own

    state.push(sample(), 45_000); // identical sample, inside pulsetime — sealed means it may NOT extend the stretch
    expect(state.entries()).toHaveLength(2);
    expect(state.current()).toMatchObject({ startedAt: 45_000, samples: 1 });
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
