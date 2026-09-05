import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@taki/shared";
import { toEntryInput, toModelMessage, type TurnEntryInput, type TurnMessage } from "./turn-mapping.ts";
import { toPresentedTurnEntry } from "./turn-presentation.ts";

describe("turn tool-name presentation", () => {
  it("enriches names without changing canonical content, replay bytes, outputs, or part order", () => {
    const messages: TurnMessage[] = [
      { role: "assistant", content: [
        { type: "text", text: "Checking." },
        { type: "tool-call", toolCallId: "mcp-call", toolName: "opaque_route", input: { secret: "RAW_INPUT_SENTINEL" } },
        { type: "tool-call", toolCallId: "fixed-call", toolName: "screenshot", input: {} },
      ] },
      { role: "tool", content: [
        { type: "tool-result", toolCallId: "mcp-call", toolName: "opaque_route",
          output: { type: "json", value: { displayName: "x".repeat(300), input: "business data", hash: "business hash" } } },
        { type: "tool-result", toolCallId: "fixed-call", toolName: "screenshot",
          output: { type: "execution-denied", reason: "permission denied" } },
      ] },
    ];
    const original = JSON.stringify(messages);

    for (const message of messages) {
      const canonical = toEntryInput(message)!;
      const presented = toPresentedTurnEntry(message, { opaque_route: "Source server · actual.tool" })!;
      expect(presented.content).toBe(canonical.content);
      expect(presented.parts?.map((part) => part.type)).toEqual(canonical.parts?.map((part) => part.type));
      expect(presented.parts?.filter((part) => part.type === "tool-call" || part.type === "tool-result")
        .map((part) => part.displayName)).toEqual(["Source server · actual.tool", "屏幕截图"]);
      expect(JSON.stringify(toModelMessage(entryOf(presented))))
        .toBe(JSON.stringify(toModelMessage(entryOf(canonical))));
      expect(JSON.stringify(presented)).not.toContain("RAW_INPUT_SENTINEL");
    }
    expect(JSON.stringify(messages)).toBe(original);
  });

  it("ignores provider labels and inherited name entries, including prototype getters", () => {
    const names = Object.create({}) as Record<string, string>;
    Object.setPrototypeOf(names, Object.defineProperty({}, "opaque_route", {
      get() { throw new Error("Inherited display names must not be read"); },
    }));
    for (const toolName of ["opaque_route", "constructor", "screenshot"]) {
      for (const type of ["tool-call", "tool-result"] as const) {
        const message = {
          role: type === "tool-call" ? "assistant" : "tool",
          content: [{ type, toolCallId: "call", toolName, displayName: "PROVIDER_SPOOF", input: {},
            output: { type: "text", value: "done" } }],
        } as unknown as TurnMessage;
        const part = toPresentedTurnEntry(message, names)?.parts?.[0];
        expect(part && "displayName" in part ? part.displayName : undefined)
          .toBe(toolName === "screenshot" ? "屏幕截图" : undefined);
        expect(JSON.stringify(part)).not.toContain("PROVIDER_SPOOF");
      }
    }
  });

  it("uses valid captured own names first and falls back when a captured name is invalid", () => {
    const names = Object.fromEntries([
      ["__proto__", "Own server · proto"], ["constructor", "Own server · constructor"],
      ["screenshot", ""], ["opaque_route", "x".repeat(241)],
    ]);
    const input = toPresentedTurnEntry({ role: "assistant", content: Object.keys(names).map((toolName) => ({
      type: "tool-call", toolCallId: `call-${toolName}`, toolName, input: {},
    })) }, names);
    expect(input?.parts?.map((part) => "displayName" in part ? part.displayName : undefined))
      .toEqual(["Own server · proto", "Own server · constructor", "屏幕截图", undefined]);
  });

  it("leaves empty and pure-text turns in their legacy shape", () => {
    expect(toPresentedTurnEntry({ role: "assistant", content: "" }, { unused: "Name" })).toBeNull();
    expect(toPresentedTurnEntry({ role: "assistant", content: "Hello" })).toEqual({ role: "assistant", content: "Hello" });
  });
});

function entryOf(input: TurnEntryInput): TimelineEntry {
  return { seq: 1, id: "550e8400-e29b-41d4-a716-446655440000", characterId: "taki",
    createdAt: "2026-09-06T00:00:00.000Z", ...input };
}
