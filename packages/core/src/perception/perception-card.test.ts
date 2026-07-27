import { describe, expect, it } from "vitest";
import { PerceptionCardSchema, type ForegroundWindowOutput } from "@taki/shared";
import { createActivityState, type ActivityState } from "../activity/activity-state.ts";
import { buildPerceptionCard } from "./perception-card.ts";
import { createPrivacyPause } from "./privacy-pause.ts";

const POLL = 30_000;
const SAMPLING = { foreground: true, ambientScreen: false };

function sample(processName: string, windowTitle: string): ForegroundWindowOutput {
  return { available: true, processName, windowTitle, idleSeconds: 0 };
}

function stateWith(...pushes: Array<[ForegroundWindowOutput, number]>): ActivityState {
  const state = createActivityState({
    pulsetimeMs: 2 * POLL,
    dwellMinSamples: 2,
    idleThresholdSeconds: 180,
    spanMs: 2 * 60 * 60 * 1000,
    maxEntries: 240,
  });
  for (const [output, at] of pushes) state.push(output, at);
  return state;
}

describe("buildPerceptionCard", () => {
  it("emits a schema-valid card with no activity at all", () => {
    const card = buildPerceptionCard(
      { activity: stateWith(), pause: createPrivacyPause(), sampling: () => SAMPLING },
      1_000,
    );
    expect(card).toEqual({ current: null, recent: [], samplingStatus: SAMPLING, pauseState: { paused: false, until: null } });
    expect(PerceptionCardSchema.safeParse(card).success).toBe(true);
  });

  it("reports the live window as current (before dwell) and older stretches newest-first as recent", () => {
    const activity = stateWith(
      [sample("Code.exe", "main.ts"), 0],
      [sample("Code.exe", "main.ts"), POLL],
      [sample("firefox.exe", "docs"), 2 * POLL],
      [sample("firefox.exe", "docs"), 3 * POLL],
      [sample("Slack.exe", "chat"), 4 * POLL], // one sample only: below the prompt's dwell threshold
    );
    const card = buildPerceptionCard({ activity, pause: createPrivacyPause(), sampling: () => SAMPLING }, 5 * POLL);

    expect(card.current?.processName).toBe("Slack.exe");
    // Live duration is real elapsed time on the window, not the last-sample gap.
    expect(card.current?.durationMs).toBe(POLL);
    expect(card.recent.map((entry) => entry.processName)).toEqual(["firefox.exe", "Code.exe"]);
    expect(PerceptionCardSchema.safeParse(card).success).toBe(true);
  });

  it("never repeats the live entry inside recent", () => {
    const activity = stateWith([sample("Code.exe", "main.ts"), 0], [sample("Code.exe", "main.ts"), POLL]);
    const card = buildPerceptionCard({ activity, pause: createPrivacyPause(), sampling: () => SAMPLING }, 2 * POLL);
    expect(card.current?.processName).toBe("Code.exe");
    expect(card.recent).toEqual([]);
  });

  it("carries the live pause snapshot, including a lapsed deadline that already self-resumed", () => {
    const pause = createPrivacyPause({ now: () => 0 });
    pause.pauseUntil(5_000);
    const paused = buildPerceptionCard({ activity: stateWith(), pause, sampling: () => SAMPLING }, 1_000);
    expect(paused.pauseState).toEqual({ paused: true, until: 5_000 });

    const resumed = buildPerceptionCard({ activity: stateWith(), pause, sampling: () => SAMPLING }, 6_000);
    expect(resumed.pauseState).toEqual({ paused: false, until: null });
  });

  it("reports each sampler's real scheduling state, so the badge cannot claim sampling that stopped", () => {
    const card = buildPerceptionCard(
      { activity: stateWith(), pause: createPrivacyPause(), sampling: () => ({ foreground: false, ambientScreen: true }) },
      1_000,
    );
    expect(card.samplingStatus).toEqual({ foreground: false, ambientScreen: true });
  });
});
