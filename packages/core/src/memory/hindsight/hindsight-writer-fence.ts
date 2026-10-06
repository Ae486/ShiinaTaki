/**
 * INPUT:  the Hindsight subsystem's unfenced writer surfaces (engine tools, maintenance, flush, tidy, observed writer, Run capture)
 * OUTPUT: fenceHindsightWriters() — the same surfaces with every native write admitted through the fence; recall/reflect,
 *         Run capture and the primary witness stay open, a fenced tool returns a retryable MEMORY_AUTHORITY_FENCED result
 *         and a fenced flush the retryable outcome Compaction already understands
 * POS:    core/memory/hindsight — backup capture pause (§5.3); in-memory only, so a restart drops it with the capture
 */
import type { AutoMemoryMaintenance } from "../auto-memory.ts";
import { isCanonicalLocalFenced, type CanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import type { CapturedMemoryRun } from "../canonical-memory-run.ts";
import type { MemoryWriteOp } from "../episodic-writer.ts";
import { fenceMemoryToolWrites, type FencedToolPolicy } from "../fenced-memory-tools.ts";
import type { MemoryEngine } from "../memory-engine.ts";
import type { MemoryFlushPort } from "../memory-flush-port.ts";
import type { TidyPass } from "../tidy-pass.ts";

const POLICY: FencedToolPolicy = { open: new Set(["recall", "reflect"]), refusal: Object.freeze({ ok: false as const,
  code: "MEMORY_AUTHORITY_FENCED" as const,
  message: "Hindsight memory writes are paused while a memory backup is captured; reads still work, retry the write after it completes." }) };

export interface HindsightWriters {
  engine: MemoryEngine; maintenance: AutoMemoryMaintenance; memoryFlush: MemoryFlushPort; tidy: TidyPass;
  writeMemory: MemoryWriteOp;
  captureRun(characterId: string, signal?: AbortSignal): Promise<CapturedMemoryRun>;
}

export function fenceHindsightWriters(writers: HindsightWriters, fence: CanonicalLocalWriteFence, canQueue?: () => boolean): HindsightWriters {
  const { engine, tidy } = writers;
  const policy = { ...POLICY, canQueue };
  return {
    engine: { ...engine, createTools: (characterId, seq) => fenceMemoryToolWrites(engine.createTools(characterId, seq), fence, policy) },
    maintenance: { run: (characterId, origin) => fence.admit(() => writers.maintenance.run(characterId, origin)) },
    memoryFlush: { prepareRetirement: async (request) => {
      try { return await fence.admit(() => writers.memoryFlush.prepareRetirement(request)); }
      catch (error) {
        if (isCanonicalLocalFenced(error)) return { status: "retryable_failure", code: "MEMORY_AUTHORITY_FENCED" };
        throw error;
      }
    } },
    tidy: { maybeRun: (characterId) => fence.admit(() => tidy.maybeRun(characterId)),
      runNow: (characterId) => fence.admit(() => tidy.runNow(characterId)) },
    writeMemory: (request) => fence.admit(() => writers.writeMemory(request)),
    // Chat keeps working through a capture: the Run's reads stay open and its write tools refuse structurally.
    captureRun: async (characterId, signal) => {
      const run = await writers.captureRun(characterId, signal);
      return Object.freeze({ ...run, tools: fenceMemoryToolWrites(run.tools, fence, policy) });
    },
  };
}
