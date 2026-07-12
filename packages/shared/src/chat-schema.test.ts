import { describe, expect, it } from "vitest";
import {
  CHAT_METHODS,
  ChatCancelParamsSchema,
  ChatCancelResultSchema,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  ChatSendParamsSchema,
  ChatSendResultSchema,
} from "./chat-schema.ts";

describe("CHAT_METHODS", () => {
  it("exposes the five chat method names", () => {
    expect(CHAT_METHODS).toEqual({
      send: "chat.send",
      cancel: "chat.cancel",
      delta: "chat.delta",
      complete: "chat.complete",
      error: "chat.error",
    });
  });
});

describe("ChatCancelParamsSchema", () => {
  it("accepts a valid cancel and rejects an empty characterId", () => {
    expect(ChatCancelParamsSchema.safeParse({ characterId: "taki" }).success).toBe(true);
    expect(ChatCancelParamsSchema.safeParse({ characterId: "" }).success).toBe(false);
  });

  it("round-trips a cancel result", () => {
    expect(ChatCancelResultSchema.parse({ cancelled: true })).toEqual({ cancelled: true });
    expect(ChatCancelResultSchema.safeParse({}).success).toBe(false);
  });
});

describe("ChatSendParamsSchema", () => {
  it("accepts a valid send", () => {
    expect(ChatSendParamsSchema.safeParse({ characterId: "taki", message: "hi" }).success).toBe(true);
  });

  it("rejects an empty characterId", () => {
    expect(ChatSendParamsSchema.safeParse({ characterId: "", message: "hi" }).success).toBe(false);
  });

  it("rejects an empty message", () => {
    expect(ChatSendParamsSchema.safeParse({ characterId: "taki", message: "" }).success).toBe(false);
  });

  it("rejects a missing characterId", () => {
    expect(ChatSendParamsSchema.safeParse({ message: "hi" }).success).toBe(false);
  });
});

describe("chat event round-trips", () => {
  it("parses a delta carrying characterId", () => {
    const delta = { messageId: "m1", characterId: "taki", delta: "Hel" };
    expect(ChatDeltaSchema.parse(delta)).toEqual(delta);
  });

  it("parses a complete", () => {
    const complete = { messageId: "m1", characterId: "taki" };
    expect(ChatCompleteSchema.parse(complete)).toEqual(complete);
  });

  it("parses a structured error with a known code", () => {
    const err = { messageId: "m1", characterId: "taki", code: "PROVIDER_ERROR", message: "boom" };
    expect(ChatErrorSchema.parse(err)).toEqual(err);
  });

  it("rejects an unknown error code", () => {
    expect(
      ChatErrorSchema.safeParse({ messageId: "m1", characterId: "taki", code: "NOPE", message: "x" }).success,
    ).toBe(false);
  });

  it("accepts a send result", () => {
    expect(ChatSendResultSchema.safeParse({ messageId: "m1" }).success).toBe(true);
  });
});
