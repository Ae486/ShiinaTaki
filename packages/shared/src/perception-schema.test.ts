import { describe, expect, it } from "vitest";
import {
  PERCEPTION_METHODS,
  PerceptionActivityEntrySchema,
  PerceptionCardSchema,
  PerceptionPauseSetParamsSchema,
  PerceptionPauseStateSchema,
} from "./perception-schema.ts";

const ENTRY = {
  processName: "Code.exe",
  windowTitle: "main.ts",
  startedAt: 1_700_000_000_000,
  durationMs: 60_000,
  samples: 3,
  idle: false,
};

describe("PERCEPTION_METHODS", () => {
  it("names the three perception methods", () => {
    expect(PERCEPTION_METHODS).toEqual({
      pauseGet: "perception.pauseGet",
      pauseSet: "perception.pauseSet",
      card: "perception.card",
    });
  });
});

describe("perception pause schemas", () => {
  it("round-trips both pause shapes: a deadline and a manual resume", () => {
    expect(PerceptionPauseStateSchema.parse({ paused: true, until: 1_700_000_000_000 })).toEqual({
      paused: true,
      until: 1_700_000_000_000,
    });
    expect(PerceptionPauseStateSchema.parse({ paused: false, until: null })).toEqual({ paused: false, until: null });
  });

  it("rejects a non-epoch deadline and an unknown key", () => {
    expect(PerceptionPauseStateSchema.safeParse({ paused: true, until: -1 }).success).toBe(false);
    expect(PerceptionPauseStateSchema.safeParse({ paused: true, until: 1.5 }).success).toBe(false);
    expect(PerceptionPauseStateSchema.safeParse({ paused: true, until: null, forever: true }).success).toBe(false);
  });

  it("accepts pause-until-resumed, pause-until-deadline and resume", () => {
    expect(PerceptionPauseSetParamsSchema.parse({ paused: true })).toEqual({ paused: true });
    expect(PerceptionPauseSetParamsSchema.parse({ paused: true, until: 42 })).toEqual({ paused: true, until: 42 });
    expect(PerceptionPauseSetParamsSchema.parse({ paused: false })).toEqual({ paused: false });
  });

  it("refuses a resume that carries a deadline (the union makes the nonsense unrepresentable)", () => {
    expect(PerceptionPauseSetParamsSchema.safeParse({ paused: false, until: 42 }).success).toBe(false);
  });
});

describe("perception card schemas", () => {
  it("round-trips a full card", () => {
    const card = {
      current: ENTRY,
      recent: [ENTRY],
      samplingStatus: { foreground: true, ambientScreen: false },
      pauseState: { paused: false, until: null },
    };
    expect(PerceptionCardSchema.parse(card)).toEqual(card);
  });

  it("round-trips an empty card (nothing observed yet)", () => {
    const card = {
      current: null,
      recent: [],
      samplingStatus: { foreground: false, ambientScreen: false },
      pauseState: { paused: true, until: null },
    };
    expect(PerceptionCardSchema.parse(card)).toEqual(card);
  });

  it("rejects a malformed entry and an unknown sampling tier", () => {
    expect(PerceptionActivityEntrySchema.safeParse({ ...ENTRY, samples: 0 }).success).toBe(false);
    expect(PerceptionActivityEntrySchema.safeParse({ ...ENTRY, durationMs: -1 }).success).toBe(false);
    expect(
      PerceptionCardSchema.safeParse({
        current: null,
        recent: [],
        samplingStatus: { foreground: true, ambientScreen: true, microphone: true },
        pauseState: { paused: false, until: null },
      }).success,
    ).toBe(false);
  });
});
