import { describe, expect, it } from "vitest";
import type { StepResult, ToolSet } from "ai";
import { presentationTailStop } from "./presentation-stop.ts";

// Minimal StepResult stand-ins — the predicate reads only `text` and `toolCalls[].{toolName,invalid}`.
type Call = string | { toolName: string; invalid: true };
function step(text: string, calls: Call[]): StepResult<ToolSet> {
  const toolCalls = calls.map((call) => (typeof call === "string" ? { toolName: call } : call));
  return { text, toolCalls } as unknown as StepResult<ToolSet>;
}
const invalid = (toolName: string): Call => ({ toolName, invalid: true });

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

  it("gives one correction chance: a spoken step with an invalid presentation call does not stop (D69)", () => {
    expect(presentationTailStop({ steps: [step("你好呀！", [invalid("avatar_set_expression")])] })).toBe(false);
  });

  it("stops on the second invalid presentation step of the same turn", () => {
    const steps = [step("你好呀！", [invalid("avatar_set_expression")]), step("", [invalid("avatar_set_expression")])];
    expect(presentationTailStop({ steps })).toBe(true);
  });

  it("stops after the corrected (valid) call following one invalid step", () => {
    const steps = [step("你好呀！", [invalid("avatar_set_expression")]), step("", ["avatar_set_expression"])];
    expect(presentationTailStop({ steps })).toBe(true);
  });

  it("an invalid step with no text yet still does not stop (unchanged express-first behaviour)", () => {
    expect(presentationTailStop({ steps: [step("", [invalid("avatar_play_motion")])] })).toBe(false);
  });

  it("an invalid NON-presentation call in the tail never counts (not presentation-only)", () => {
    expect(presentationTailStop({ steps: [step("你好", [invalid("avatar_set_expresion")])] })).toBe(false);
  });
});
