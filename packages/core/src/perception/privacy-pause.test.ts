import { describe, expect, it } from "vitest";
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
