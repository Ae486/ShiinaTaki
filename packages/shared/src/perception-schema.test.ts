import { describe, expect, it } from "vitest";
import {
  PERCEPTION_METHODS,
  PerceptionActivityEntrySchema,
  PerceptionCardSchema,
  PerceptionChangedSchema,
  PerceptionPauseSetParamsSchema,
  PerceptionPauseStateSchema,
  PerceptionSubscribeParamsSchema,
  PerceptionSubscribeResultSchema,
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
  it("keeps the reads and writer while adding the opt-in invalidation channel", () => {
    expect(PERCEPTION_METHODS).toEqual({
      pauseGet: "perception.pauseGet",
      pauseSet: "perception.pauseSet",
      card: "perception.card",
      subscribe: "perception.subscribe",
      changed: "perception.changed",
    });
  });
});

describe("perception invalidation schemas", () => {
  it("round-trips only the empty subscription and acknowledgement", () => {
    expect(PerceptionSubscribeParamsSchema.parse({})).toEqual({});
    expect(PerceptionSubscribeResultSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
    expect(PerceptionSubscribeParamsSchema.safeParse({ hostId: "host" }).success).toBe(false);
    expect(PerceptionSubscribeResultSchema.safeParse({ status: "ok", revision: 1 }).success).toBe(false);
    expect(PerceptionSubscribeResultSchema.safeParse({ status: "unknown" }).success).toBe(false);
  });

  it("accepts only a content-free nonnegative safe integer revision", () => {
    for (const revision of [0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(PerceptionChangedSchema.parse({ revision })).toEqual({ revision });
    }
    for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "1"]) {
      expect(PerceptionChangedSchema.safeParse({ revision }).success).toBe(false);
    }
    for (const privateField of ["windowTitle", "processName", "screenshot", "description", "reason"]) {
      expect(PerceptionChangedSchema.safeParse({ revision: 1, [privateField]: "private" }).success).toBe(false);
    }
  });

  it("does not widen the existing strict card or pause results", () => {
    const pauseState = { paused: false, until: null };
    expect(PerceptionPauseStateSchema.safeParse({ ...pauseState, revision: 1 }).success).toBe(false);
    expect(PerceptionCardSchema.safeParse({
      current: null, recent: [], samplingStatus: { foreground: false, ambientScreen: false }, pauseState, revision: 1,
    }).success).toBe(false);
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
