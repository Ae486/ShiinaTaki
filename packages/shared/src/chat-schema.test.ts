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
  ImageAttachmentSchema,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "./chat-schema.ts";

const IMAGE = { mediaType: "image/png" as const, dataBase64: "aGk=" };

describe("CHAT_METHODS", () => {
  it("exposes legacy chat and read-only live activity method names", () => {
    expect(CHAT_METHODS).toEqual({
      send: "chat.send",
      cancel: "chat.cancel",
      delta: "chat.delta",
      complete: "chat.complete",
      error: "chat.error",
      activity: "chat.activity",
      activityRead: "chat.activity.read",
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

describe("ChatSendParamsSchema attachments (T1)", () => {
  it("accepts a send carrying image attachments", () => {
    const parsed = ChatSendParamsSchema.safeParse({ characterId: "taki", message: "look", attachments: [IMAGE] });
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty caption when an attachment is present (empty text + image is valid)", () => {
    expect(ChatSendParamsSchema.safeParse({ characterId: "taki", message: "", attachments: [IMAGE] }).success).toBe(true);
  });

  it("rejects a wholly empty send (empty message AND no attachments)", () => {
    expect(ChatSendParamsSchema.safeParse({ characterId: "taki", message: "" }).success).toBe(false);
    expect(ChatSendParamsSchema.safeParse({ characterId: "taki", message: "", attachments: [] }).success).toBe(false);
  });

  it("rejects more than MAX_ATTACHMENTS_PER_MESSAGE attachments", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, () => IMAGE);
    expect(ChatSendParamsSchema.safeParse({ characterId: "taki", message: "x", attachments: many }).success).toBe(false);
  });

  it("rejects an unsupported media type", () => {
    const bad = { mediaType: "image/svg+xml", dataBase64: "aGk=" };
    expect(ChatSendParamsSchema.safeParse({ characterId: "taki", message: "x", attachments: [bad] }).success).toBe(false);
    expect(ImageAttachmentSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an attachment with empty base64", () => {
    expect(ImageAttachmentSchema.safeParse({ mediaType: "image/jpeg", dataBase64: "" }).success).toBe(false);
  });

  it("keeps text-only sends byte-identical (no attachments field present)", () => {
    expect(ChatSendParamsSchema.parse({ characterId: "taki", message: "hi" })).toEqual({ characterId: "taki", message: "hi" });
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

  it("carries the optional retracted flag (cancel-before-reply) and stays absent otherwise", () => {
    const retracted = { messageId: "m1", characterId: "taki", code: "PROVIDER_ERROR", message: "retracted", retracted: true };
    expect(ChatErrorSchema.parse(retracted)).toEqual(retracted);
    expect(ChatErrorSchema.parse({ messageId: "m1", characterId: "taki", code: "PROVIDER_ERROR", message: "boom" }).retracted).toBeUndefined();
  });

  it("rejects an unknown error code", () => {
    expect(
      ChatErrorSchema.safeParse({ messageId: "m1", characterId: "taki", code: "NOPE", message: "x" }).success,
    ).toBe(false);
  });

  it("accepts a send result", () => {
    expect(ChatSendResultSchema.safeParse({ messageId: "m1", runId: "r1" }).success).toBe(true);
    expect(ChatSendResultSchema.safeParse({ messageId: "m1" }).success).toBe(false);
  });

  it("keeps chat.cancel backward compatible while allowing an exact Run target", () => {
    expect(ChatCancelParamsSchema.parse({ characterId: "taki" })).toEqual({ characterId: "taki" });
    expect(ChatCancelParamsSchema.parse({ characterId: "taki", runId: "run-1" })).toEqual({ characterId: "taki", runId: "run-1" });
  });
});
