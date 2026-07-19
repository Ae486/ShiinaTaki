import { describe, expect, it } from "vitest";
import type { StepResult, ToolSet } from "ai";
import { presentationTailStop } from "./presentation-stop.ts";

// Minimal StepResult stand-ins — the predicate reads only `text` and `toolCalls[].toolName`.
function step(text: string, toolNames: string[]): StepResult<ToolSet> {
  return { text, toolCalls: toolNames.map((toolName) => ({ toolName })) } as unknown as StepResult<ToolSet>;
}

describe("presentationTailStop", () => {
  it("stops after a spoken step whose tool tail is presentation-only", () => {
    expect(presentationTailStop({ steps: [step("你好呀！", ["avatar_set_expression"])] })).toBe(true);
  });

  it("does NOT stop a presentation-only step that has not spoken yet (express-first-then-talk guard)", () => {
    expect(presentationTailStop({ steps: [step("", ["avatar_play_motion"])] })).toBe(false);
  });

  it("does NOT stop when the tail also called a real (informational) tool", () => {
    expect(presentationTailStop({ steps: [step("你好", ["avatar_set_expression", "screenshot"])] })).toBe(false);
  });

  it("does NOT stop a text-only step with no tool calls", () => {
    expect(presentationTailStop({ steps: [step("你好", [])] })).toBe(false);
  });

  it("does NOT stop on an empty step list", () => {
    expect(presentationTailStop({ steps: [] })).toBe(false);
  });
});
