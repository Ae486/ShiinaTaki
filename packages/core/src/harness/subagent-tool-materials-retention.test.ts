import { describe, expect, it, vi } from "vitest";
import { createToolMaterialSink } from "./subagent-tool-materials.ts";
import { withToolSourceMaterials } from "../agents/tool-source-materials.ts";

describe("completed private material release", () => {
  it("releases empty-source producer entries after durability, retaining an exact unknown-source result reference", () => {
    const persist = vi.fn();
    const sink = createToolMaterialSink({ persist, read: () => undefined });
    const invocation = { attemptId: "attempt", stepNumber: 0, toolCallId: "call", toolName: "read" };
    sink.capture({ runId: "run", attemptId: "attempt", stepNumber: 0,
      results: [{ toolCallId: "call", toolName: "read", output: withToolSourceMaterials({ exact: "retained" }, []) }] });
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ text: '{"exact":"retained"}', materials: [{ key: "result", source: undefined }] }));
    expect(() => sink.register(invocation, [{ key: "new", source: undefined }])).toThrow("SUBAGENT_MATERIAL_CONFLICT");
    sink.release!({ attemptId: "attempt", throughStep: 0 });
    expect(() => sink.register(invocation, [{ key: "new", source: undefined }])).not.toThrow();
  });

  it("retains unsaved exact material when no durable repository is available", () => {
    const sink = createToolMaterialSink();
    sink.capture({ runId: "run", attemptId: "attempt", stepNumber: 0,
      results: [{ toolCallId: "call", toolName: "read", output: { exact: "unsaved" } }] });
    sink.release!({ attemptId: "attempt", throughStep: 0 });
    expect(sink.select({ kind: "tool_result", runId: "run", attemptId: "attempt", stepNumber: 0, toolCallId: "call", key: "result" }))
      .toEqual({ key: "result", text: '{"exact":"unsaved"}', source: undefined });
  });
});
