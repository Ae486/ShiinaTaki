import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@taki/shared";
import { toEntryInput, toModelMessage, toUserEntryInput } from "./turn-mapping.ts";

function entryOf(partial: Partial<TimelineEntry>): TimelineEntry {
  return {
    seq: 1,
    id: "550e8400-e29b-41d4-a716-446655440000",
    characterId: "taki",
    role: "assistant",
    content: "",
    createdAt: "2026-07-12T00:00:00.000Z",
    ...partial,
  };
}

describe("toEntryInput", () => {
  it("collapses a pure-text assistant message to a legacy-shaped row (no parts)", () => {
    expect(toEntryInput({ role: "assistant", content: "hello" })).toEqual({ role: "assistant", content: "hello" });
    expect(toEntryInput({ role: "assistant", content: [{ type: "text", text: "hello" }] })).toEqual({
      role: "assistant",
      content: "hello",
    });
  });

  it("returns null for an empty assistant message (nothing persistable)", () => {
    expect(toEntryInput({ role: "assistant", content: "" })).toBeNull();
    expect(toEntryInput({ role: "assistant", content: [] })).toBeNull();
  });

  it("persists tool calls as names-only parts and drops raw input", () => {
    const sentinel = "SENTINEL_TOOL_SECRET_7f2f";
    const input = toEntryInput({
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool-call", toolCallId: "c1", toolName: "screenshot", input: { token: sentinel } },
      ],
    });
    expect(input).toEqual({
      role: "assistant",
      content: "Let me check.\n[tool-call: screenshot]",
      parts: [
        { type: "text", text: "Let me check." },
        { type: "tool-call", toolCallId: "c1", toolName: "screenshot" },
      ],
    });
    expect(JSON.stringify(input)).not.toContain(sentinel);
  });

  it("maps a tool message to a tool row with tool-result parts (payload stays out of content)", () => {
    const input = toEntryInput({
      role: "tool",
      content: [
        { type: "tool-result", toolCallId: "c1", toolName: "screenshot", output: { type: "json", value: { ok: true } } },
      ],
    });
    expect(input).toEqual({
      role: "tool",
      content: "[tool-result: screenshot -> json]",
      parts: [
        { type: "tool-result", toolCallId: "c1", toolName: "screenshot", output: { type: "json", value: { ok: true } } },
      ],
    });
  });
});

describe("toUserEntryInput (#17, T6)", () => {
  const image = { mediaType: "image/png" as const, ref: "attachments/abc.png" };

  it("returns a legacy text-only row (no parts) when there are no images (byte-identical to today)", () => {
    expect(toUserEntryInput("hello", [])).toEqual({ role: "user", content: "hello" });
  });

  it("carries a text part + image parts, content = the caption", () => {
    expect(toUserEntryInput("look at this", [image])).toEqual({
      role: "user",
      content: "look at this",
      parts: [
        { type: "text", text: "look at this" },
        { type: "image", mediaType: "image/png", ref: "attachments/abc.png" },
      ],
    });
  });

  it("projects content to [image] and omits the text part when the caption is empty", () => {
    expect(toUserEntryInput("", [image])).toEqual({
      role: "user",
      content: "[image]",
      parts: [{ type: "image", mediaType: "image/png", ref: "attachments/abc.png" }],
    });
  });
});

describe("toModelMessage", () => {
  it("reconstructs legacy text-only rows (backward compatibility)", () => {
    expect(toModelMessage(entryOf({ role: "user", content: "hi" }))).toEqual({ role: "user", content: "hi" });
    expect(toModelMessage(entryOf({ role: "assistant", content: "hello" }))).toEqual({
      role: "assistant",
      content: "hello",
    });
  });

  it("converts the durable user shape without reading image files; native replay owns selected-ref hydration", () => {
    const replayed = toModelMessage(
      entryOf({
        role: "user",
        content: "look at this",
        parts: [
          { type: "text", text: "look at this" },
          { type: "image", mediaType: "image/png", ref: "attachments/abc.png" },
        ],
      }),
    );
    expect(replayed).toEqual({ role: "user", content: "look at this" });
    expect(JSON.stringify(replayed)).not.toContain("attachments/abc.png");
  });

  it("reconstructs a multi-part assistant message with an empty safe input placeholder", () => {
    const sentinel = "SENTINEL_LEGACY_TOOL_SECRET_91ad";
    const message = toModelMessage(
      entryOf({
        role: "assistant",
        content: "summary",
        parts: [
          { type: "text", text: "Let me check." },
          { type: "tool-call", toolCallId: "c1", toolName: "screenshot", input: { token: sentinel } },
        ],
      }),
    );
    expect(message).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool-call", toolCallId: "c1", toolName: "screenshot", input: {} },
      ],
    });
    expect(JSON.stringify(message)).not.toContain(sentinel);
  });

  it("reconstructs a tool message and returns null for an unreplayable tool row without parts", () => {
    const message = toModelMessage(
      entryOf({
        role: "tool",
        content: "[tool-result: screenshot -> json]",
        parts: [{ type: "tool-result", toolCallId: "c1", toolName: "screenshot", output: { type: "json", value: 7 } }],
      }),
    );
    expect(message).toEqual({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "c1", toolName: "screenshot", output: { type: "json", value: 7 } }],
    });
    expect(toModelMessage(entryOf({ role: "tool", content: "orphan" }))).toBeNull();
  });

  it("round-trips tool identity while replacing raw arguments with the safe empty replay placeholder", () => {
    const sentinel = "SENTINEL_EXEC_SECRET_c043";
    const original = {
      role: "assistant" as const,
      content: [{ type: "tool-call" as const, toolCallId: "c9", toolName: "exec", input: { command: sentinel } }],
    };
    const input = toEntryInput(original);
    expect(input).not.toBeNull();
    const replayed = toModelMessage(entryOf({ role: input!.role, content: input!.content, parts: input!.parts }));
    expect(replayed).toEqual({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "c9", toolName: "exec", input: {} }],
    });
    expect(JSON.stringify(input)).not.toContain(sentinel);
    expect(JSON.stringify(replayed)).not.toContain(sentinel);
  });

  it("round-trips a content-type tool output (value = text/file parts array), not just json/text", () => {
    const original = {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: "c2",
          toolName: "read_file",
          output: {
            type: "content" as const,
            value: [
              { type: "text" as const, text: "line 1" },
              { type: "file" as const, data: "aGk=", mediaType: "image/png" },
            ],
          },
        },
      ],
    };
    // The SDK types file `data` narrowly; the store only needs a faithful DB round-trip, so map through the
    // TurnMessage boundary with the same cast turn-mapping itself uses on the SDK's tagged output.
    const input = toEntryInput(original as unknown as Parameters<typeof toEntryInput>[0]);
    expect(input).not.toBeNull();
    const replayed = toModelMessage(entryOf({ role: input!.role, content: input!.content, parts: input!.parts }));
    expect(replayed).toEqual(original);
  });
});
