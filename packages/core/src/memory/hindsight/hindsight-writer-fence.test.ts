import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createCanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import type { CapturedMemoryRun } from "../canonical-memory-run.ts";
import type { MemoryEngine } from "../memory-engine.ts";
import { fenceHindsightWriters, type HindsightWriters } from "./hindsight-writer-fence.ts";

const OPTIONS = { toolCallId: "call", messages: [], context: undefined };
const REFUSED = { ok: false, code: "MEMORY_AUTHORITY_FENCED" };

function tools(): ToolSet {
  const tool = (name: string) => ({ description: name, inputSchema: undefined, execute: vi.fn(async () => ({ ok: true, name })) });
  return { recall: tool("recall"), reflect: tool("reflect"), retain: tool("retain"), invalidate: tool("invalidate") } as unknown as ToolSet;
}

function writers() {
  const raw: HindsightWriters = {
    engine: { createTools: () => tools() } as unknown as MemoryEngine,
    maintenance: { run: vi.fn(async () => undefined) },
    memoryFlush: { prepareRetirement: vi.fn(async () => ({ status: "retired" as const })) } as unknown as HindsightWriters["memoryFlush"],
    tidy: { maybeRun: vi.fn(async () => undefined), runNow: vi.fn(async () => ({ status: "clean" })) } as unknown as HindsightWriters["tidy"],
    writeMemory: vi.fn(async () => ({ id: "m", layer: "episodic" })) as unknown as HindsightWriters["writeMemory"],
    captureRun: vi.fn(async () => ({ snapshot: {}, tools: tools() }) as unknown as CapturedMemoryRun),
  };
  const fence = createCanonicalLocalWriteFence();
  return { raw, fence, fenced: fenceHindsightWriters(raw, fence) };
}

const call = (set: ToolSet, name: string) => set[name]!.execute!({}, OPTIONS);

describe("Hindsight writer fence (backup capture §5.3)", () => {
  it("refuses every native write while quiesced, keeps reads and Run capture open, and reopens on release", async () => {
    const { raw, fence, fenced } = writers();
    await fence.quiesce({ timeoutMs: 100 });
    const engineTools = fenced.engine.createTools("taki");
    const run = await fenced.captureRun("taki");
    for (const set of [engineTools, run.tools]) {
      expect(await call(set, "recall")).toMatchObject({ ok: true });
      expect(await call(set, "reflect")).toMatchObject({ ok: true });
      expect(await call(set, "retain")).toMatchObject(REFUSED);
      expect(await call(set, "invalidate")).toMatchObject(REFUSED);
    }
    await expect(fenced.maintenance.run("taki", "primary")).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    await expect(fenced.tidy.maybeRun("taki")).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    await expect(fenced.tidy.runNow("taki")).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    await expect(fenced.writeMemory({ characterId: "taki" } as Parameters<HindsightWriters["writeMemory"]>[0])).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    expect(await fenced.memoryFlush.prepareRetirement({} as never)).toEqual({ status: "retryable_failure", code: "MEMORY_AUTHORITY_FENCED" });
    expect(raw.maintenance.run).not.toHaveBeenCalled();
    expect(raw.memoryFlush.prepareRetirement).not.toHaveBeenCalled();
    expect(raw.writeMemory).not.toHaveBeenCalled();

    fence.release();
    expect(await call(engineTools, "retain")).toMatchObject({ ok: true, name: "retain" });
    expect(await call(run.tools, "invalidate")).toMatchObject({ ok: true, name: "invalidate" });
    await fenced.maintenance.run("taki", "primary");
    expect(await fenced.memoryFlush.prepareRetirement({} as never)).toEqual({ status: "retired" });
  });

  it("waits for an admitted native write before the capture proceeds", async () => {
    const { raw, fence, fenced } = writers();
    let finish = (): void => undefined;
    vi.mocked(raw.maintenance.run).mockImplementation(() => new Promise<void>((done) => { finish = done; }));
    const running = fenced.maintenance.run("taki", "primary");
    let quiesced = false;
    const quiescing = fence.quiesce({ timeoutMs: 1_000 }).then(() => { quiesced = true; });
    await Promise.resolve();
    expect(quiesced).toBe(false);
    finish();
    await running; await quiescing;
    expect(quiesced).toBe(true);
    fence.release();
  });
});
