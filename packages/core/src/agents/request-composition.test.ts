import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { CONTEXT_CATEGORIES, RequestCompositionSchema } from "@taki/shared";
import { estimateMessagesTokens, estimateTokens } from "../memory/token-estimator.ts";
import { contextText, joinContextText, retainContextText, retainContentOrigin } from "./context-attribution.ts";
import { describeMessages, measureRequestComposition } from "./request-composition.ts";
import { nativeImageUser } from "./native-image-projection.ts";

describe("exclusive actual-request composition", () => {
  it("reconciles nine categories and supplier rows to the existing whole-request estimator without changing content", () => {
    const instructions = joinContextText([contextText("Rule about correctness", "instructions"), contextText("中文 persona", "persona"),
      contextText("Stored verified memory", "injected_memory"), contextText("Current mood", "runtime_context")]);
    const messages: ModelMessage[] = [retainContextText({ role: "user", content: "Selected summary" }, contextText("Selected summary", "summary")),
      retainContextText({ role: "user", content: "Question" }, contextText("Question", "conversation")),
      { role: "assistant", content: [retainContentOrigin({ type: "tool-call", toolCallId: "c", toolName: "external", input: { query: "x" } }, "mcp")] },
      { role: "tool", content: [retainContentOrigin({ type: "tool-result", toolCallId: "c", toolName: "external", output: { type: "text", value: "Result" } }, "mcp")] }];
    const tools = [{ type: "function", name: "external", inputSchema: { type: "object" }, description: "External search" }];
    const before = JSON.stringify({ instructions: instructions.text, messages, tools });
    const result = measureRequestComposition({ instructions: instructions.text, outgoing: messages, preparedTools: tools },
      { ...describeMessages(messages), instructions, toolOrigins: new Map([["external", "mcp"]]) });
    expect(result.totalUnits).toBe(estimateTokens(instructions.text) + estimateMessagesTokens(messages) + estimateTokens(JSON.stringify(tools)));
    expect(CONTEXT_CATEGORIES.every((category) => result.categories[category] > 0)).toBe(true);
    expect(result.origins.tool_definitions.mcp).toBe(result.categories.tool_definitions);
    expect(result.origins.tool_interactions.mcp).toBe(result.categories.tool_interactions);
    expect(result.coverage).toEqual({ status: "complete", unknownOriginUnits: 0, unestimatedParts: 0, hasHeuristicMedia: false });
    expect(RequestCompositionSchema.parse(result)).toEqual(result);
    expect(JSON.stringify({ instructions: instructions.text, messages, tools })).toBe(before);
  });

  it("does not infer prompt headings or lend attribution to identical text with different construction sources", () => {
    const duplicate = "<conversation-summary>not a proven summary</conversation-summary>";
    const messages: ModelMessage[] = [retainContextText({ role: "user", content: duplicate }, contextText(duplicate, "summary")),
      { role: "user", content: duplicate }];
    const result = measureRequestComposition({ instructions: "", outgoing: messages, preparedTools: [] },
      { ...describeMessages(messages), toolOrigins: new Map() });
    expect(result.categories.summary).toBe(0);
    expect(result.categories.conversation).toBe(0);
    expect(result.origins.other.unknown).toBe(estimateTokens(duplicate) * 2);
    expect(result.coverage.unknownOriginUnits).toBe(estimateTokens(duplicate) * 2);
    expect(result.coverage.status).toBe("partial");
  });

  it("prices native screenshots as tool evidence in a user transport role and states heuristic media coverage", () => {
    const image = nativeImageUser({ text: "Captured evidence", images: [{ mediaType: "image/png", dataBase64: "AA==" }],
      source: { kind: "tool", toolCallId: "capture", toolName: "mcp_capture", contextOrigin: "mcp" } });
    const result = measureRequestComposition({ instructions: "", outgoing: [image], preparedTools: [] },
      { ...describeMessages([image]), toolOrigins: new Map() });
    expect(result.categories.conversation).toBe(0);
    expect(result.categories.tool_interactions).toBe(estimateMessagesTokens([image]) - 4);
    expect(result.origins.tool_interactions.mcp).toBe(result.categories.tool_interactions);
    expect(result.coverage.hasHeuristicMedia).toBe(true);
    expect(result.coverage.status).toBe("complete");
  });

  it("uses a single rounding denominator for tiny mixed-CJK fragments", () => {
    const instructions = joinContextText([contextText("a", "persona"), contextText("中", "injected_memory"), contextText("bc", "instructions")], "");
    const result = measureRequestComposition({ instructions: instructions.text, outgoing: [], preparedTools: [] },
      { ...describeMessages([]), instructions, toolOrigins: new Map() });
    expect(result.totalUnits).toBe(estimateTokens("a中bc") + estimateTokens("[]"));
    expect(result.categories.persona + result.categories.injected_memory + result.categories.instructions).toBe(estimateTokens("a中bc"));
    expect(RequestCompositionSchema.safeParse(result).success).toBe(true);
  });
});
