import { describe, expect, it } from "vitest";
import {
  TIMELINE_METHODS,
  TimelineEntrySchema,
  TimelineHistoryParamsSchema,
  TimelineHistoryResultSchema,
  TimelineRoleSchema,
  TimelineSubscribeParamsSchema,
} from "./timeline-schema.ts";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const entry = {
  seq: 1,
  id: VALID_UUID,
  characterId: "taki",
  role: "user" as const,
  content: "hello",
  createdAt: "2026-07-10T00:00:00.000Z",
};

describe("TIMELINE_METHODS", () => {
  it("names the three timeline methods", () => {
    expect(TIMELINE_METHODS).toEqual({
      history: "timeline.history",
      subscribe: "timeline.subscribe",
      appended: "timeline.appended",
    });
  });
});

describe("TimelineRoleSchema", () => {
  it.each(["user", "assistant"])("accepts the %s role", (role) => {
    expect(TimelineRoleSchema.safeParse(role).success).toBe(true);
  });

  it("rejects connect roles (operator/node are not timeline roles)", () => {
    expect(TimelineRoleSchema.safeParse("operator").success).toBe(false);
    expect(TimelineRoleSchema.safeParse("node").success).toBe(false);
  });
});

describe("TimelineEntrySchema", () => {
  it("round-trips a valid entry", () => {
    expect(TimelineEntrySchema.parse(entry)).toEqual(entry);
  });

  it("rejects a non-uuid id", () => {
    expect(TimelineEntrySchema.safeParse({ ...entry, id: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a non-positive seq", () => {
    expect(TimelineEntrySchema.safeParse({ ...entry, seq: 0 }).success).toBe(false);
    expect(TimelineEntrySchema.safeParse({ ...entry, seq: -1 }).success).toBe(false);
  });

  it("rejects an unknown role", () => {
    expect(TimelineEntrySchema.safeParse({ ...entry, role: "system" }).success).toBe(false);
  });

  it("rejects a missing characterId", () => {
    expect(TimelineEntrySchema.safeParse({ ...entry, characterId: "" }).success).toBe(false);
  });
});

describe("TimelineHistoryParamsSchema", () => {
  it("defaults limit to 50 and leaves before optional", () => {
    const parsed = TimelineHistoryParamsSchema.parse({ characterId: "taki" });
    expect(parsed.limit).toBe(50);
    expect(parsed.before).toBeUndefined();
  });

  it("accepts a before cursor", () => {
    expect(TimelineHistoryParamsSchema.parse({ characterId: "taki", before: 42 }).before).toBe(42);
  });

  it.each([0, -1, 201])("rejects limit %d", (limit) => {
    expect(TimelineHistoryParamsSchema.safeParse({ characterId: "taki", limit }).success).toBe(false);
  });

  it("accepts limit at the 200 max", () => {
    expect(TimelineHistoryParamsSchema.parse({ characterId: "taki", limit: 200 }).limit).toBe(200);
  });

  it("rejects an empty characterId", () => {
    expect(TimelineHistoryParamsSchema.safeParse({ characterId: "" }).success).toBe(false);
  });
});

describe("TimelineHistoryResultSchema", () => {
  it("accepts entries with a numeric nextBefore", () => {
    expect(TimelineHistoryResultSchema.safeParse({ entries: [entry], nextBefore: 1 }).success).toBe(true);
  });

  it("accepts a null nextBefore (last page)", () => {
    expect(TimelineHistoryResultSchema.safeParse({ entries: [], nextBefore: null }).success).toBe(true);
  });
});

describe("TimelineSubscribeParamsSchema", () => {
  it("requires a characterId", () => {
    expect(TimelineSubscribeParamsSchema.safeParse({}).success).toBe(false);
    expect(TimelineSubscribeParamsSchema.parse({ characterId: "taki" }).characterId).toBe("taki");
  });
});
