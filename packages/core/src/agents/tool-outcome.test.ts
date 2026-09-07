import { describe, expect, it } from "vitest";
import { classifyToolOutcome } from "./tool-outcome.ts";

describe("tool outcome before model-output conversion", () => {
  it("never settles a preliminary result", () => {
    expect(classifyToolOutcome({ type: "tool-result", output: { ok: false }, preliminary: true })).toBeUndefined();
  });

  it.each([
    [{ ok: true }, { outcome: "completed" }],
    [{ content: [{ type: "text", text: "ok" }] }, { outcome: "completed" }],
    [{ ok: false }, { outcome: "failed", errorClass: "execution", errorCode: "tool_failed" }],
    [{ isError: true, content: [] }, { outcome: "failed", errorClass: "execution", errorCode: "mcp_tool_error" }],
    [{ ok: false, state: "outcome_unknown", code: "HOST_OUTCOME_UNKNOWN" }, { outcome: "outcome_unknown" }],
    [{ ok: false, state: "cancelled", code: "CANCELLED" }, { outcome: "cancelled" }],
    [{ ok: false, code: "APPROVAL_REQUIRED" }, { outcome: "failed", errorClass: "governance" }],
    [{ ok: false, code: "MCP_STALE_GENERATION" }, { outcome: "failed", errorClass: "stale" }],
  ])("normalizes %j without retaining its content", (output, expected) => {
    const classified = classifyToolOutcome({ type: "tool-result", output });
    expect(classified).toMatchObject(expected);
    expect(classified).not.toHaveProperty("output");
  });

  it("retains validation and denial semantics without exporting exceptions", () => {
    expect(classifyToolOutcome({ type: "tool-error", invalid: true })).toMatchObject({ errorClass: "validation" });
    expect(classifyToolOutcome({ type: "tool-output-denied" })).toMatchObject({ errorClass: "governance" });
    expect(classifyToolOutcome({ type: "tool-error" })).toEqual({ outcome: "failed", errorClass: "execution", errorCode: "tool_error" });
  });

  it.each([
    "private_payload_marker",
    "approval_private_payload_marker",
    "cancelled_private_payload_marker",
    "outcome_unknown_private_payload_marker",
  ])("does not persist or interpret an unrecognized result code: %s", (code) => {
    expect(classifyToolOutcome({ type: "tool-result", output: { ok: false, code } })).toEqual({
      outcome: "failed", errorClass: "execution", errorCode: "tool_failed",
    });
  });

  it.each([
    ["MEMORY_OUTCOME_UNKNOWN", "outcome_unknown"],
    ["MEMORY_OPERATION_CANCELLED", "cancelled"],
  ])("preserves the existing canonical Memory envelope outcome for %s", (code, outcome) => {
    const output = { ok: false, error: { code, message: "private_payload_marker" } };
    const result = classifyToolOutcome({ type: "tool-result", output });
    expect(result).toMatchObject({ outcome, errorCode: code.toLowerCase() });
    expect(JSON.stringify(result)).not.toContain("private_payload_marker");
  });
});
