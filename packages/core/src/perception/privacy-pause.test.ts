import { describe, expect, it, vi } from "vitest";
import { createPrivacyPause, type PrivacyPauseState, type PrivacyPauseStore } from "./privacy-pause.ts";

function pauseAt(start: number) {
  let clock = start;
  const pause = createPrivacyPause({ now: () => clock });
  return { pause, advance: (ms: number) => void (clock += ms) };
}

/** A store that survives "restarts": each createPrivacyPause reads back exactly what the last one wrote. */
function fakeStore(seed?: PrivacyPauseState) {
  let stored = seed;
  const store: PrivacyPauseStore = {
    load: () => stored,
    save: (state) => void (stored = state),
  };
  return { store, saved: () => stored };
}

describe("createPrivacyPause", () => {
  it("starts unpaused with a serializable empty state", () => {
    const { pause } = pauseAt(1000);
    expect(pause.isPaused()).toBe(false);
    expect(pause.state()).toEqual({ paused: false, until: null });
  });

  it("pauses until resumed — no clock advance ever lifts it", () => {
    const { pause, advance } = pauseAt(1000);
    pause.pauseUntilResumed();
    expect(pause.state()).toEqual({ paused: true, until: null });
    advance(365 * 24 * 60 * 60 * 1000);
    expect(pause.isPaused()).toBe(true);
    pause.resume();
    expect(pause.isPaused()).toBe(false);
    expect(pause.state()).toEqual({ paused: false, until: null });
  });

  it("pauses until a deadline and self-clears once it lapses", () => {
    const { pause, advance } = pauseAt(1000);
    pause.pauseUntil(5000);
    expect(pause.state()).toEqual({ paused: true, until: 5000 });
    advance(3000); // 4000 — still inside the window
    expect(pause.isPaused()).toBe(true);
    advance(1000); // 5000 — the deadline is inclusive: the pause is over
    expect(pause.isPaused()).toBe(false);
    expect(pause.state()).toEqual({ paused: false, until: null });
  });

  it("honours an explicit `at` over the injected clock", () => {
    const { pause } = pauseAt(1000);
    pause.pauseUntil(5000);
    expect(pause.isPaused(4999)).toBe(true);
    expect(pause.isPaused(9000)).toBe(false);
  });

  it("treats an already-past deadline as not paused", () => {
    const { pause } = pauseAt(10_000);
    pause.pauseUntil(9000);
    expect(pause.isPaused()).toBe(false);
  });

  it("lets the last call win when the pause shape changes", () => {
    const { pause, advance } = pauseAt(1000);
    pause.pauseUntilResumed();
    pause.pauseUntil(2000);
    advance(1500); // 2500 — the deadline replaced the indefinite pause rather than stacking under it
    expect(pause.isPaused()).toBe(false);

    pause.pauseUntil(9000);
    pause.pauseUntilResumed();
    advance(100_000);
    expect(pause.state()).toEqual({ paused: true, until: null });
  });

  it("resumes from a deadline pause before it lapses", () => {
    const { pause } = pauseAt(1000);
    pause.pauseUntil(60_000);
    pause.resume();
    expect(pause.state()).toEqual({ paused: false, until: null });
  });
});

// A pause is a withdrawal of consent. If it evaporated on a restart, a crash/upgrade/reboot would silently resume
// observation while the card still reported "not paused" — the one failure mode this state must not have.
describe("createPrivacyPause persistence", () => {
  it("observes successful changed writes after persistence, never hydration or duplicate values", () => {
    const { store, saved } = fakeStore({ paused: true, until: null });
    const observed: Array<{ live: PrivacyPauseState; persisted: PrivacyPauseState | undefined }> = [];
    const onChange = vi.fn(() => { observed.push({ live: pause.state(), persisted: saved() }); });
    const pause = createPrivacyPause({ now: () => 1_000, store, onChange });
    expect(onChange).not.toHaveBeenCalled();
    pause.pauseUntilResumed();
    expect(onChange).not.toHaveBeenCalled();
    pause.pauseUntil(5_000);
    pause.resume();
    expect(observed).toEqual([
      { live: { paused: true, until: 5_000 }, persisted: { paused: true, until: 5_000 } },
      { live: { paused: false, until: null }, persisted: { paused: false, until: null } },
    ]);
    expect(onChange.mock.calls).toEqual([[], []]);
  });

  it("failed persistence neither changes the live pause nor publishes a successful transition", () => {
    const onChange = vi.fn();
    const pause = createPrivacyPause({
      now: () => 1_000,
      store: { load: () => ({ paused: true, until: null }), save: () => { throw new Error("write failed"); } },
      onChange,
    });
    expect(() => pause.resume()).toThrow("write failed");
    expect(pause.state()).toEqual({ paused: true, until: null });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a failed observer cannot turn a committed pause operation into a write failure", () => {
    const { store, saved } = fakeStore();
    const pause = createPrivacyPause({ store, onChange: () => { throw new Error("observer retired"); } });
    expect(() => pause.pauseUntilResumed()).not.toThrow();
    expect(saved()).toEqual({ paused: true, until: null });
    expect(pause.state()).toEqual(saved());
  });

  it("survives a restart: an indefinite pause is still paused after re-construction", () => {
    const { store, saved } = fakeStore();
    createPrivacyPause({ now: () => 1000, store }).pauseUntilResumed();
    expect(saved()).toEqual({ paused: true, until: null });

    const rebooted = createPrivacyPause({ now: () => 9_999_999, store });
    expect(rebooted.isPaused()).toBe(true);
    expect(rebooted.state()).toEqual({ paused: true, until: null });
  });

  it("survives a restart with a deadline still ahead, and settles a lapsed one with no boot-time special case", () => {
    const { store } = fakeStore();
    createPrivacyPause({ now: () => 1000, store }).pauseUntil(5000);

    expect(createPrivacyPause({ now: () => 4999, store }).state()).toEqual({ paused: true, until: 5000 });
    // The SAME stored record, read after the deadline: an absolute timestamp needs no "was it yesterday" logic.
    expect(createPrivacyPause({ now: () => 5001, store }).state()).toEqual({ paused: false, until: null });
  });

  it("comes back unpaused for a core that was never paused, and after a resume", () => {
    const { store } = fakeStore();
    expect(createPrivacyPause({ now: () => 1000, store }).isPaused()).toBe(false);

    const paused = createPrivacyPause({ now: () => 1000, store });
    paused.pauseUntilResumed();
    paused.resume();
    expect(createPrivacyPause({ now: () => 2000, store }).isPaused()).toBe(false);
  });

  it("hydrates without a store at all (memory-only is still a valid composition)", () => {
    const pause = createPrivacyPause({ now: () => 1000 });
    pause.pauseUntilResumed();
    expect(pause.isPaused()).toBe(true);
  });
});
