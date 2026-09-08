import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PerceptionPauseState } from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";
import { createPerceptionChanges } from "./perception-changes.ts";
import { createPrivacyPause } from "./privacy-pause.ts";

function operator(): Connection {
  return { state: { status: "authenticated", deviceId: "operator", role: "operator", capabilities: [] } };
}

function harness(seed?: PerceptionPauseState) {
  const save = vi.fn();
  const changes = createPerceptionChanges({ pauseState: (at) => pause.state(at) });
  const pause = createPrivacyPause({ store: { load: () => seed, save }, onChange: changes.pauseChanged });
  const read = vi.spyOn(pause, "state");
  const sink = vi.fn();
  const connection = operator();
  return { changes, pause, read, save, sink, connection, subscribe: () => changes.subscriptions.subscribe(connection, sink) };
}

describe("Perception absolute pause projection deadline", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("does no read or timer work with zero interested connections", () => {
    const h = harness();
    h.changes.changed();
    h.pause.pauseUntil(5_000);
    expect(h.read).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(h.read).not.toHaveBeenCalled();
    expect(h.save).toHaveBeenCalledExactlyOnceWith({ paused: true, until: 5_000 });
    h.changes.dispose();
  });

  it("arms one unref'd hydrated deadline and invalidates expiry once with no writer calls", () => {
    const schedule = vi.spyOn(globalThis, "setTimeout");
    const h = harness({ paused: true, until: 5_000 });
    const resume = vi.spyOn(h.pause, "resume");
    const until = vi.spyOn(h.pause, "pauseUntil");
    const indefinite = vi.spyOn(h.pause, "pauseUntilResumed");
    h.subscribe();
    h.subscribe();
    expect(vi.getTimerCount()).toBe(1);
    expect(schedule.mock.results[0]?.value.hasRef()).toBe(false);
    expect(h.sink).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3_999);
    expect(h.sink).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.sink).toHaveBeenCalledExactlyOnceWith({ revision: 1 });
    expect(h.pause.state()).toEqual({ paused: false, until: null });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100_000);
    expect(h.sink).toHaveBeenCalledTimes(1);
    for (const writer of [h.save, resume, until, indefinite]) expect(writer).not.toHaveBeenCalled();
    h.changes.dispose();
  });

  it.each([
    { seed: { paused: true, until: 500 }, expected: { paused: false, until: null } },
    { seed: { paused: true, until: null }, expected: { paused: true, until: null } },
    { seed: { paused: false, until: null }, expected: { paused: false, until: null } },
  ])("needs no deadline for past, indefinite or unpaused hydration: $seed", ({ seed, expected }) => {
    const h = harness(seed);
    h.subscribe();
    expect(h.pause.state()).toEqual(expected);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.sink).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
    h.changes.dispose();
  });

  it("replaces a deadline and ignores an already queued old wake-up before touching the replacement", () => {
    const schedule = vi.spyOn(globalThis, "setTimeout");
    const h = harness({ paused: true, until: 5_000 });
    h.subscribe();
    const oldWake = schedule.mock.calls[0]?.[0];
    expect(typeof oldWake).toBe("function");
    h.pause.pauseUntil(9_000);
    h.read.mockClear();
    if (typeof oldWake === "function") oldWake();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.pause.state()).toEqual({ paused: true, until: 9_000 });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(4_000);
    expect(h.sink.mock.calls).toEqual([[{ revision: 1 }]]);
    vi.advanceTimersByTime(4_000);
    expect(h.sink.mock.calls).toEqual([[{ revision: 1 }], [{ revision: 2 }]]);
    expect(h.save).toHaveBeenCalledExactlyOnceWith({ paused: true, until: 9_000 });
    h.changes.dispose();
  });

  it("cancels a timed pause's wake-up on indefinite replacement or explicit resume", () => {
    const h = harness({ paused: true, until: 5_000 });
    h.subscribe();
    h.pause.pauseUntilResumed();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(4_000);
    expect(h.pause.isPaused()).toBe(true);
    h.pause.pauseUntil(9_000);
    expect(vi.getTimerCount()).toBe(1);
    h.pause.resume();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(h.sink.mock.calls).toEqual([[{ revision: 1 }], [{ revision: 2 }], [{ revision: 3 }]]);
    h.changes.dispose();
  });

  it("still delivers exactly one pending expiry when another read settled it first", () => {
    const h = harness({ paused: true, until: 5_000 });
    setTimeout(() => { expect(h.pause.state()).toEqual({ paused: false, until: null }); }, 4_000);
    h.subscribe();
    vi.advanceTimersByTime(4_000);
    expect(h.sink).toHaveBeenCalledExactlyOnceWith({ revision: 1 });
    expect(h.save).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    h.changes.dispose();
  });

  it("keeps a pending expiry across unrelated accepted-source invalidations", () => {
    const h = harness({ paused: true, until: 5_000 });
    h.subscribe();
    h.changes.changed();
    h.changes.changed();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(4_000);
    expect(h.sink.mock.calls).toEqual([[{ revision: 1 }], [{ revision: 2 }], [{ revision: 3 }]]);
    h.changes.dispose();
  });

  it("segments a long deadline without Node's overflow-to-1ms loop", () => {
    const limit = 2_147_483_647;
    const schedule = vi.spyOn(globalThis, "setTimeout");
    const h = harness({ paused: true, until: 1_000 + limit + 5_000 });
    h.subscribe();
    expect(schedule.mock.calls[0]?.[1]).toBe(limit);
    vi.advanceTimersByTime(limit);
    expect(h.sink).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    expect(schedule.mock.calls[1]?.[1]).toBe(5_000);
    vi.advanceTimersByTime(5_000);
    expect(h.sink).toHaveBeenCalledExactlyOnceWith({ revision: 1 });
    expect(h.save).not.toHaveBeenCalled();
    h.changes.dispose();
  });

  it("rechecks the absolute source after a clock jump backwards or a suspend delay", () => {
    const h = harness({ paused: true, until: 5_000 });
    h.subscribe();
    vi.setSystemTime(0);
    vi.advanceTimersByTime(4_000);
    expect(h.pause.state()).toEqual({ paused: true, until: 5_000 });
    expect(h.sink).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    vi.setSystemTime(50_000);
    vi.advanceTimersByTime(1_000);
    expect(h.sink).toHaveBeenCalledExactlyOnceWith({ revision: 1 });
    expect(h.pause.state()).toEqual({ paused: false, until: null });
    h.changes.dispose();
  });

  it("cancels on last close, reads a fresh baseline on later interest and retires on shutdown", () => {
    const schedule = vi.spyOn(globalThis, "setTimeout");
    const h = harness({ paused: true, until: 5_000 });
    h.subscribe();
    const second = operator();
    h.changes.subscriptions.subscribe(second, vi.fn());
    h.changes.subscriptions.unsubscribe(h.connection);
    expect(vi.getTimerCount()).toBe(1);
    h.changes.subscriptions.unsubscribe(second);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(4_000);
    h.subscribe();
    expect(h.pause.state()).toEqual({ paused: false, until: null });
    expect(h.sink).not.toHaveBeenCalled();
    h.pause.pauseUntil(10_000);
    const oldWake = schedule.mock.calls.at(-1)?.[0];
    h.changes.dispose();
    h.read.mockClear();
    if (typeof oldWake === "function") oldWake();
    h.changes.changed();
    h.changes.pauseChanged();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.changes.subscriptions.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.sink.mock.calls).toEqual([[{ revision: 1 }]]);
  });

  it("settles a successful already-past operator deadline without a second write or a timer", () => {
    const h = harness();
    h.subscribe();
    h.pause.pauseUntil(500);
    expect(h.sink).toHaveBeenCalledExactlyOnceWith({ revision: 1 });
    expect(h.pause.state()).toEqual({ paused: false, until: null });
    expect(h.save).toHaveBeenCalledExactlyOnceWith({ paused: true, until: 500 });
    expect(vi.getTimerCount()).toBe(0);
    h.changes.dispose();
  });
});
