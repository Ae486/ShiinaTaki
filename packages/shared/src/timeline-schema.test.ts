import { describe, expect, it } from "vitest";
import {
  TIMELINE_METHODS,
  TimelineEntrySchema,
  TimelineHistoryParamsSchema,
  TimelineHistoryResultSchema,
  TimelinePartSchema,
  TimelineRemovedSchema,
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
  it("names the compatible timeline methods and complete batch notification", () => {
    expect(TIMELINE_METHODS).toEqual({
      history: "timeline.history",
      subscribe: "timeline.subscribe",
      appended: "timeline.appended",
      removed: "timeline.removed",
      committed: "timeline.committed",
    });
  });
});

describe("TimelineRemovedSchema", () => {
  it("round-trips a removed ref and rejects a non-positive seq / empty characterId", () => {
    const ref = { characterId: "taki", seq: 7 };
    expect(TimelineRemovedSchema.parse(ref)).toEqual(ref);
    expect(TimelineRemovedSchema.safeParse({ characterId: "taki", seq: 0 }).success).toBe(false);
    expect(TimelineRemovedSchema.safeParse({ characterId: "", seq: 1 }).success).toBe(false);
  });
});

describe("TimelineRoleSchema", () => {
  it.each(["user", "assistant", "tool"])("accepts the %s role", (role) => {
    expect(TimelineRoleSchema.safeParse(role).success).toBe(true);
  });

  it("rejects connect roles (operator/node are not timeline roles)", () => {
    expect(TimelineRoleSchema.safeParse("operator").success).toBe(false);
    expect(TimelineRoleSchema.safeParse("node").success).toBe(false);
  });
});

describe("TimelinePartSchema", () => {
  it("round-trips the three part kinds (v7 field names: input / output)", () => {
    const text = { type: "text", text: "hi" };
    const call = { type: "tool-call", toolCallId: "c1", toolName: "screenshot", input: { display: 1 } };
    const result = {
      type: "tool-result",
      toolCallId: "c1",
      toolName: "screenshot",
      output: { type: "json", value: { ok: true, path: "shot.png" } },
    };
    expect(TimelinePartSchema.parse(text)).toEqual(text);
    expect(TimelinePartSchema.parse(call)).toEqual(call);
    expect(TimelinePartSchema.parse(result)).toEqual(result);
  });

  it("rejects an unknown part type and a result without a tagged output", () => {
    expect(TimelinePartSchema.safeParse({ type: "reasoning", text: "hmm" }).success).toBe(false);
    expect(
      TimelinePartSchema.safeParse({ type: "tool-result", toolCallId: "c1", toolName: "t", output: "raw" }).success,
    ).toBe(false);
  });

  it("round-trips bounded display names without changing tool identity or business output", () => {
    const displayName = "🛠".repeat(120);
    const parts = [
      { type: "tool-call", toolCallId: "c1", toolName: "opaque_key", displayName },
      { type: "tool-result", toolCallId: "c1", toolName: "opaque_key", displayName,
        output: { type: "json", value: { displayName: "x".repeat(300), input: "business data" }, hash: "business-hash" } },
    ];
    for (const part of parts) expect(TimelinePartSchema.parse(part)).toEqual(part);
  });

  it("omits invalid optional display metadata while retaining strict canonical validation", () => {
    for (const displayName of [null, 7, {}, "", " \t\n", "x".repeat(241), "🛠".repeat(121)]) {
      for (const type of ["tool-call", "tool-result"] as const) {
        const part = { type, toolCallId: "c1", toolName: "opaque_key", displayName, output: { type: "text", value: "done" } };
        const parsed = TimelinePartSchema.parse(part);
        expect("displayName" in parsed ? parsed.displayName : undefined).toBeUndefined();
        expect(TimelinePartSchema.safeParse({ ...part, toolName: "" }).success).toBe(false);
      }
    }
  });

  it("round-trips an image part (#17) and rejects an unsupported media type / empty ref", () => {
    const image = { type: "image", mediaType: "image/png", ref: "attachments/abc.png" };
    expect(TimelinePartSchema.parse(image)).toEqual(image);
    expect(TimelinePartSchema.safeParse({ type: "image", mediaType: "image/svg+xml", ref: "attachments/x.svg" }).success).toBe(false);
    expect(TimelinePartSchema.safeParse({ type: "image", mediaType: "image/webp", ref: "" }).success).toBe(false);
  });
});

describe("TimelineEntrySchema", () => {
  it("round-trips a valid entry", () => {
    expect(TimelineEntrySchema.parse(entry)).toEqual(entry);
  });

  it("round-trips a tool entry carrying structured parts", () => {
    const toolEntry = {
      ...entry,
      role: "tool" as const,
      content: "[tool-result: screenshot]",
      parts: [
        { type: "tool-result" as const, toolCallId: "c1", toolName: "screenshot", output: { type: "json", value: 1 } },
      ],
    };
    expect(TimelineEntrySchema.parse(toolEntry)).toEqual(toolEntry);
  });

  it("round-trips a user entry carrying an image part (#17)", () => {
    const imageEntry = {
      ...entry,
      role: "user" as const,
      content: "[image]",
      parts: [{ type: "image" as const, mediaType: "image/jpeg", ref: "attachments/deadbeef.jpg" }],
    };
    expect(TimelineEntrySchema.parse(imageEntry)).toEqual(imageEntry);
  });

  it("accepts a legacy entry without parts (text-only rows stay valid)", () => {
    expect(TimelineEntrySchema.parse(entry).parts).toBeUndefined();
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
