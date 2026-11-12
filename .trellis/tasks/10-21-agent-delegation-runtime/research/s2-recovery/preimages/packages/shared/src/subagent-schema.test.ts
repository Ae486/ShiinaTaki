import { describe, expect, it } from "vitest";
import { SubagentInputRequestSchema, SubagentToolSelectionSchema, SubagentWorkScopeSchema } from "./subagent-schema.ts";
import { SourceContextSchema, ContextMaterialSchema, MaterialRefSchema } from "./context-source-schema.ts";
import { TimelinePartSchema } from "./timeline-schema.ts";
import { ParentContinuationProposalSchema } from "./subagent-result-schema.ts";

describe("private work and source contracts", () => {
  it("preserves explicit empty executable selections and disallows invented work scopes", () => {
    expect(SubagentToolSelectionSchema.parse({ mode: "allow", names: [] })).toEqual({ mode: "allow", names: [] });
    expect(SubagentToolSelectionSchema.parse({ mode: "inherit", excludeNames: ["write"] })).toEqual({ mode: "inherit", excludeNames: ["write"] });
    expect(SubagentWorkScopeSchema.safeParse({ kind: "subagent", completionId: "parent" }).success).toBe(false);
  });

  it("keeps unknown source absent and known metadata lossless without fabricating mappings", () => {
    expect(ContextMaterialSchema.parse({ key: "unknown", text: "I lost my job", source: {} }).source).toBeUndefined();
    expect(SourceContextSchema.parse({ materials: [{}, {}] })).toEqual({});
    const source = { label: "Interview", reference: "doc:17", speaker: "Narrator", time: "00:21" };
    expect(SourceContextSchema.parse({ materials: [source] })).toEqual({ materials: [source] });
    const part = { type: "tool-result", toolCallId: "read-1", toolName: "read", output: { type: "json", value: { ok: true, items: [] } },
      sourceMaterials: [{ key: "document", source }] };
    expect(TimelinePartSchema.parse(JSON.parse(JSON.stringify(part)))).toEqual(part);
    expect(MaterialRefSchema.safeParse({ kind: "tool_result", runId: "r", attemptId: "a", toolCallId: "read-1", key: "document" }).success).toBe(false);
  });

  it("requires exact work for messages and rejects private authority fields on result collectors", () => {
    expect(SubagentInputRequestSchema.safeParse({ subagentId: "11111111-1111-4111-8111-111111111111", operationKey: "send",
      sender: { kind: "user" }, direction: "correct A", materials: [], input: { kind: "message" } }).success).toBe(false);
    expect(ParentContinuationProposalSchema.safeParse({ decision: "reply", text: "Done", deliveryClass: "class_a" }).success).toBe(false);
    expect(ParentContinuationProposalSchema.parse({ decision: "no_action", reason: "Already answered" })).toEqual({ decision: "no_action", reason: "Already answered" });
  });
});
