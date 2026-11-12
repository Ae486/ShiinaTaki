import { describe, expect, it } from "vitest";
import {
  AVATAR_METHODS,
  AvatarCommandSchema,
  AvatarOutcomeParamsSchema,
  AvatarOutcomeResultSchema,
  AvatarOutcomeSchema,
  AvatarRejectReasonSchema,
  AvatarReportParamsSchema,
  AvatarReportResultSchema,
  AvatarSubscribeParamsSchema,
  AvatarSubscribeResultSchema,
} from "./avatar-schema.ts";

describe("AVATAR_METHODS", () => {
  it("exposes the four avatar method names", () => {
    expect(AVATAR_METHODS).toEqual({
      subscribe: "avatar.subscribe",
      report: "avatar.report",
      command: "avatar.command",
      outcome: "avatar.outcome",
    });
  });
});

describe("AvatarSubscribeParamsSchema", () => {
  it("accepts a valid subscribe and rejects an empty characterId", () => {
    expect(AvatarSubscribeParamsSchema.safeParse({ characterId: "taki" }).success).toBe(true);
    expect(AvatarSubscribeParamsSchema.safeParse({ characterId: "" }).success).toBe(false);
  });

  it("round-trips the ok result", () => {
    expect(AvatarSubscribeResultSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
    expect(AvatarSubscribeResultSchema.safeParse({ status: "nope" }).success).toBe(false);
  });
});

describe("AvatarReportParamsSchema", () => {
  it("accepts the reported motion/expression vocabulary", () => {
    const report = { characterId: "taki", motions: ["smile01", "angry01"], expressions: ["default", "shame01"] };
    expect(AvatarReportParamsSchema.parse(report)).toEqual(report);
  });

  it("accepts empty vocab arrays (unloaded / closed Pet UI)", () => {
    expect(AvatarReportParamsSchema.safeParse({ characterId: "taki", motions: [], expressions: [] }).success).toBe(true);
  });

  it("round-trips the optional costume id and stays valid when it is absent (1f)", () => {
    const withCostume = { characterId: "taki", motions: ["mtn_idle01_C"], expressions: [], costume: "arbeit_ring_01" };
    expect(AvatarReportParamsSchema.parse(withCostume)).toEqual(withCostume);
    // Absent costume (boot / drift self-heal report carries no formal id) is valid and stays absent.
    const noCostume = { characterId: "taki", motions: [], expressions: [] };
    expect(AvatarReportParamsSchema.parse(noCostume)).toEqual(noCostume);
    // A non-string costume is rejected.
    expect(AvatarReportParamsSchema.safeParse({ ...noCostume, costume: 7 }).success).toBe(false);
  });

  it("rejects a non-string motion entry and a missing characterId", () => {
    expect(AvatarReportParamsSchema.safeParse({ characterId: "taki", motions: [1], expressions: [] }).success).toBe(false);
    expect(AvatarReportParamsSchema.safeParse({ motions: [], expressions: [] }).success).toBe(false);
  });

  it("round-trips the ok result", () => {
    expect(AvatarReportResultSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
  });
});

describe("AvatarCommandSchema", () => {
  it("parses an expression command without motion knobs", () => {
    const command = { characterId: "taki", commandId: "cmd-1", kind: "expression", name: "shame01" };
    expect(AvatarCommandSchema.parse(command)).toEqual(command);
  });

  it("parses a motion command carrying priority + loop", () => {
    const command = { characterId: "taki", commandId: "cmd-2", kind: "motion", name: "angry01", priority: "force", loop: false };
    expect(AvatarCommandSchema.parse(command)).toEqual(command);
  });

  it("requires a non-empty Core-generated commandId", () => {
    expect(AvatarCommandSchema.safeParse({ characterId: "taki", kind: "expression", name: "x" }).success).toBe(false);
    expect(AvatarCommandSchema.safeParse({ characterId: "taki", commandId: "", kind: "expression", name: "x" }).success).toBe(false);
  });

  it("rejects an unknown kind, an empty name, and an unknown priority", () => {
    const base = { characterId: "taki", commandId: "cmd" };
    expect(AvatarCommandSchema.safeParse({ ...base, kind: "wave", name: "x" }).success).toBe(false);
    expect(AvatarCommandSchema.safeParse({ ...base, kind: "motion", name: "" }).success).toBe(false);
    expect(AvatarCommandSchema.safeParse({ ...base, kind: "motion", name: "x", priority: "urgent" }).success).toBe(false);
  });
});

describe("avatar outcome schemas", () => {
  it("enumerates the five Presentation Outcomes and five reject reasons", () => {
    expect(AvatarOutcomeSchema.options).toEqual(["applied", "rejected", "superseded", "not_rendered", "unknown"]);
    expect(AvatarRejectReasonSchema.options).toEqual(["motion_busy", "speaking", "already_active", "unknown_name", "unavailable"]);
  });

  it("accepts an applied report and a rejected report with a reason", () => {
    const applied = { characterId: "taki", commandId: "cmd", outcome: "applied" };
    expect(AvatarOutcomeParamsSchema.parse(applied)).toEqual(applied);
    const rejected = { characterId: "taki", commandId: "cmd", outcome: "rejected", reason: "motion_busy" };
    expect(AvatarOutcomeParamsSchema.parse(rejected)).toEqual(rejected);
  });

  it("refuses the Core-derived outcomes and unknown reasons on the wire", () => {
    const base = { characterId: "taki", commandId: "cmd" };
    expect(AvatarOutcomeParamsSchema.safeParse({ ...base, outcome: "not_rendered" }).success).toBe(false);
    expect(AvatarOutcomeParamsSchema.safeParse({ ...base, outcome: "unknown" }).success).toBe(false);
    expect(AvatarOutcomeParamsSchema.safeParse({ ...base, outcome: "rejected", reason: "tired" }).success).toBe(false);
    expect(AvatarOutcomeParamsSchema.safeParse({ ...base, commandId: "", outcome: "applied" }).success).toBe(false);
  });

  it("round-trips the ok result", () => {
    expect(AvatarOutcomeResultSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
  });
});
