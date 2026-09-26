/**
 * INPUT:  the Local engine, ingestion, tidy pass and the subsystem's write fence
 * OUTPUT: fenceCanonicalLocalWriters() — engine, maintenance, flush, tidy, writeMemory and captureRun surfaces whose Local
 *         writes are admitted through the fence; foreground assemble/recall/report reads stay open, background (tidy/flush)
 *         tools are write surfaces and fenced whole
 * POS:    core/memory — installed by the Local subsystem draft; a fenced tool write returns a structured MEMORY_AUTHORITY_FENCED
 *         to the model and a fenced flush returns the retryable outcome Compaction already understands
 */
import type { AutoMemoryMaintenance } from "./auto-memory.ts";
import type { CanonicalLocalIngestion } from "./canonical-local-ingestion.ts";
import type { CanonicalLocalRuntime } from "./canonical-local-runtime.ts";
import { isCanonicalLocalFenced, type CanonicalLocalWriteFence } from "./canonical-local-write-fence.ts";
import type { CapturedMemoryRun } from "./canonical-memory-run.ts";
import { fenceMemoryToolWrites, type FencedToolPolicy } from "./fenced-memory-tools.ts";
import type { MemoryEngine } from "./memory-engine.ts";
import type { MemoryFlushPort } from "./memory-flush-port.ts";
import type { TidyPass } from "./tidy-pass.ts";

const REFUSAL = Object.freeze({ ok: false as const, code: "MEMORY_AUTHORITY_FENCED" as const,
  message: "Canonical Local memory writes are paused while Hindsight activation runs; reads still work, retry the write after it completes." });
const FOREGROUND: FencedToolPolicy = { open: new Set(["recall", "reflect"]), refusal: REFUSAL };
const BACKGROUND: FencedToolPolicy = { open: new Set(), refusal: REFUSAL };

export interface FencedCanonicalLocalWriters {
  engine: MemoryEngine; maintenance: AutoMemoryMaintenance; memoryFlush: MemoryFlushPort; tidy: TidyPass;
  captureRun(characterId: string): Promise<CapturedMemoryRun>;
}

export function fenceCanonicalLocalWriters(input: {
  engine: CanonicalLocalRuntime; ingestion: CanonicalLocalIngestion; tidy: TidyPass; fence: CanonicalLocalWriteFence;
  onIngestionFailed(characterId: string): void;
}): FencedCanonicalLocalWriters {
  const { engine, ingestion, tidy, fence } = input;
  return {
    engine: {
      reconcile: engine.reconcile, assemble: engine.assemble, tidy: engine.tidy,
      createTools: (characterId, seq) => fenceMemoryToolWrites(engine.createTools(characterId, seq), fence, FOREGROUND),
      createBackgroundTools: (characterId, seq) => fenceMemoryToolWrites(engine.createBackgroundTools(characterId, seq), fence, BACKGROUND),
      writeEntry: (request) => fence.admitSync(() => engine.writeEntry(request)),
      retention: { listActive: engine.retention.listActive,
        archive: (path) => fence.admitSync(() => engine.retention.archive(path)),
        hardDelete: (path) => fence.admitSync(() => engine.retention.hardDelete(path)) },
    },
    maintenance: { run: (characterId, origin) => fence.admit(async () => {
      if (origin === "primary") {
        try { await ingestion.maybeRun({ characterId }); }
        catch { input.onIngestionFailed(characterId); }
      }
      await tidy.maybeRun(characterId);
    }) },
    memoryFlush: { prepareRetirement: async (request) => {
      try { return await fence.admit(() => ingestion.flushPort.prepareRetirement(request)); }
      catch (error) {
        if (isCanonicalLocalFenced(error)) return { status: "retryable_failure", code: "MEMORY_AUTHORITY_FENCED" };
        throw error;
      }
    } },
    tidy: { maybeRun: (characterId) => fence.admit(() => tidy.maybeRun(characterId)),
      runNow: (characterId) => fence.admit(() => tidy.runNow(characterId)) },
    captureRun: async (characterId) => {
      // A fenced interval keeps chat usable: the Run's tools refuse writes structurally, and the custody group Chat
      // opens initializes eligibility itself, so the baseline write is skipped here rather than refused.
      if (fence.writable()) fence.admitSync(() => { engine.banks(characterId); ingestion.initializeBaseline(characterId); });
      const run = await engine.captureRun(characterId);
      return Object.freeze({ ...run, tools: fenceMemoryToolWrites(run.tools, fence, FOREGROUND) });
    },
  };
}
