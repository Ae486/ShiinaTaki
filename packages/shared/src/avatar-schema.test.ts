import { describe, expect, it } from "vitest";
import {
  AVATAR_METHODS,
  AvatarCommandSchema,
  AvatarReportParamsSchema,
  AvatarReportResultSchema,
  AvatarSubscribeParamsSchema,
  AvatarSubscribeResultSchema,
} from "./avatar-schema.ts";

describe("AVATAR_METHODS", () => {
  it("exposes the three avatar method names", () => {
    expect(AVATAR_METHODS).toEqual({
      subscribe: "avatar.subscribe",
      report: "avatar.report",
      command: "avatar.command",
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
    const command = { characterId: "taki", kind: "expression", name: "shame01" };
    expect(AvatarCommandSchema.parse(command)).toEqual(command);
  });

  it("parses a motion command carrying priority + loop", () => {
    const command = { characterId: "taki", kind: "motion", name: "angry01", priority: "force", loop: false };
    expect(AvatarCommandSchema.parse(command)).toEqual(command);
  });

  it("rejects an unknown kind, an empty name, and an unknown priority", () => {
    expect(AvatarCommandSchema.safeParse({ characterId: "taki", kind: "wave", name: "x" }).success).toBe(false);
    expect(AvatarCommandSchema.safeParse({ characterId: "taki", kind: "motion", name: "" }).success).toBe(false);
    expect(
      AvatarCommandSchema.safeParse({ characterId: "taki", kind: "motion", name: "x", priority: "urgent" }).success,
    ).toBe(false);
  });
});
