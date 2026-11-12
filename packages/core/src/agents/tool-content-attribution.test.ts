import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { contextText, retainContentOrigin } from "./context-attribution.ts";
import { createToolContentAttribution } from "./tool-content-attribution.ts";
import { describeMessages, measureRequestComposition } from "./request-composition.ts";
import { estimateTokens } from "../memory/token-estimator.ts";

describe("tool supplier occurrence fidelity", () => {
  it("preserves different known origins when historical Turns reuse the same pair", () => {
    const messages: ModelMessage[] = ["mcp", "skill"].map((origin) => ({ role: "tool", content: [retainContentOrigin({
      type: "tool-result", toolCallId: "reused", toolName: "extension_call", output: { type: "text", value: "same output" },
    }, origin === "mcp" ? "mcp" : "skill")] }));
    const result = measureRequestComposition({ instructions: "", outgoing: messages, preparedTools: [] },
      { ...describeMessages(messages), instructions: contextText("", "instructions"), toolOrigins: new Map() });
    const units = estimateTokens(JSON.stringify({ type: "text", value: "same output" }));
    expect(result.origins.tool_interactions.mcp).toBe(units);
    expect(result.origins.tool_interactions.skill).toBe(units);
  });

  it("does not recover a new supplier behind a conflicting historical pair or keep prior segment mappings", () => {
    const part = { toolCallId: "reused", toolName: "extension_call" };
    const captured = createToolContentAttribution();
    captured.prime([{ role: "tool", content: [retainContentOrigin({ type: "tool-result", ...part,
      output: { type: "text", value: "retained" } }, "mcp")] }]);
    captured.capture([{ ...part, output: retainContentOrigin({}, "skill") }], new Map());
    expect(captured.origin(part)).toBe("unknown");
    captured.prime([]);
    expect(captured.origin(part)).toBeUndefined();
    captured.capture([{ ...part, output: retainContentOrigin({}, "skill") }], new Map());
    expect(captured.origin(part)).toBe("skill");
  });
});
