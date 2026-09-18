import { tool, type Tool, type ToolSet, type ToolExecutionOptions } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { MemoryEngine } from "../memory-engine.ts";
import { fenceMemoryEngine } from "./fenced-memory-engine.ts";
import { createMemoryAuthorityFence } from "./memory-authority-fence.ts";

function rawEngine(tools: ToolSet): MemoryEngine {
  return {
    reconcile: () => ({ upserted: 0, deleted: 0, total: 0, invalid: [] }), assemble: () => "legacy",
    createTools: () => tools, createBackgroundTools: () => tools, writeEntry: () => ({ id: "legacy", layer: "profile" }),
    retention: { listActive: () => [], archive: () => undefined, hardDelete: () => undefined },
    tidy: { listActive: () => [], countSince: () => 0, readBlock: () => undefined, createTools: () => tools },
  };
}

const options: ToolExecutionOptions<unknown> = { toolCallId: "held-tool", messages: [], context: undefined };
function invoke(definition: Tool, input: unknown) {
  if (!definition.execute) throw new Error("Expected executable test tool");
  return definition.execute(input, options);
}

describe("legacy engine tool invocation fence", () => {
  it("preserves definitions while fencing all three previously captured tool suites", async () => {
    const execute = vi.fn(() => ({ ok: true }));
    const schema = z.object({ content: z.string() });
    const definition = tool({ description: "original legacy description", inputSchema: schema,
      needsApproval: true, execute });
    const fence = createMemoryAuthorityFence();
    const engine = fenceMemoryEngine(rawEngine({ write: definition }), fence);
    const held = [engine.createTools("taki"), engine.createBackgroundTools("taki"), engine.tidy.createTools("taki")];
    await expect(invoke(held[0]!.write!, { content: "before" })).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledOnce();
    fence.retire();

    for (const tools of held) {
      const captured = tools.write!;
      expect(captured.inputSchema).toBe(schema);
      expect(captured.description).toBe(definition.description);
      expect(captured.needsApproval).toBe(true);
      await expect(invoke(captured, { content: "after" })).resolves.toEqual({ ok: false,
        code: "MEMORY_AUTHORITY_FENCED", message: "Legacy memory access is fenced." });
    }
    expect(execute).toHaveBeenCalledOnce();
  });

  it("drains an admitted async tool before commit and denies a second held invocation while draining", async () => {
    let release: (value: { ok: true }) => void = () => undefined;
    const pending = new Promise<{ ok: true }>((resolve) => { release = resolve; });
    const execute = vi.fn(() => pending);
    const definition = tool({ inputSchema: z.object({}), execute });
    const fence = createMemoryAuthorityFence();
    const engine = fenceMemoryEngine(rawEngine({ write: definition }), fence);
    const held = engine.createTools("taki").write!;
    const first = invoke(held, {});
    const commit = vi.fn(async () => "committed");
    const activation = fence.quiesce({ timeoutMs: 1_000, retireOnSuccess: true }, commit);

    await Promise.resolve();
    expect(commit).not.toHaveBeenCalled();
    await expect(invoke(held, {})).resolves.toMatchObject({ ok: false, code: "MEMORY_AUTHORITY_FENCED" });
    expect(execute).toHaveBeenCalledOnce();
    release({ ok: true });
    await expect(first).resolves.toEqual({ ok: true });
    await expect(activation).resolves.toBe("committed");
    expect(commit).toHaveBeenCalledOnce();
    await expect(invoke(held, {})).resolves.toMatchObject({ ok: false, code: "MEMORY_AUTHORITY_FENCED" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("releases failed async admissions and returns a bounded error without private exception text", async () => {
    const fence = createMemoryAuthorityFence();
    const execute = vi.fn(async (): Promise<{ ok: true }> => { throw new Error("private source and filesystem detail"); });
    const engine = fenceMemoryEngine(rawEngine({ write: tool({ inputSchema: z.object({}), execute }) }), fence);
    await expect(invoke(engine.createTools("taki").write!, {})).resolves.toEqual({ ok: false,
      code: "IO_ERROR", message: "Legacy memory operation failed." });
    await expect(fence.quiesce({ timeoutMs: 1_000 }, async () => "drained")).resolves.toBe("drained");
    expect(fence.admitSync(() => "still legacy")).toBe("still legacy");
  });
});
