/**
 * INPUT:  the Local engine, ingestion, tidy pass and the subsystem's write fence
 * OUTPUT: fenceCanonicalLocalWriters() — engine, maintenance, flush, tidy, writeMemory and captureRun surfaces whose Local
 *         writes are admitted through the fence; foreground assemble/recall/report reads stay open, background (tidy/flush)
 *         tools are write surfaces and fenced whole
 * POS:    core/memory — installed by the Local subsystem draft; a fenced tool write returns a structured MEMORY_AUTHORITY_FENCED
 *         to the model and a fenced flush returns the retryable outcome Compaction already understands
 */
import type { Tool, ToolSet } from "ai";
import type { AutoMemoryMaintenance } from "./auto-memory.ts";
import type { CanonicalLocalIngestion } from "./canonical-local-ingestion.ts";
import type { CanonicalLocalRuntime } from "./canonical-local-runtime.ts";
import { isCanonicalLocalFenced, type CanonicalLocalWriteFence } from "./canonical-local-write-fence.ts";
import { attachMemoryEffectMetadata, memoryEffectMetadata } from "./canonical-tools/memory-effect-tool.ts";
import type { CapturedMemoryRun } from "./canonical-memory-run.ts";
import type { MemoryEngine } from "./memory-engine.ts";
import type { MemoryFlushPort } from "./memory-flush-port.ts";
import type { TidyPass } from "./tidy-pass.ts";

const READ_TOOLS: ReadonlySet<string> = new Set(["recall", "reflect"]);
const FENCED_TOOL_RESULT = Object.freeze({ ok: false as const, code: "MEMORY_AUTHORITY_FENCED" as const,
  message: "Canonical Local memory writes are paused while Hindsight activation runs; reads still work, retry the write after it completes." });

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
      createTools: (characterId, seq) => fenceToolWrites(engine.createTools(characterId, seq), fence, READ_TOOLS),
      createBackgroundTools: (characterId, seq) => fenceToolWrites(engine.createBackgroundTools(characterId, seq), fence, new Set()),
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
      return Object.freeze({ ...run, tools: fenceToolWrites(run.tools, fence, READ_TOOLS) });
    },
  };
}

/** Write tools admit their execution through the fence; a refusal is a bounded structured result, never a thrown error. */
function fenceToolWrites(tools: ToolSet, fence: CanonicalLocalWriteFence, open: ReadonlySet<string>): ToolSet {
  return Object.freeze(Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const execute = definition.execute;
    if (!execute || open.has(name)) return [name, definition];
    const fenced: Tool = { ...definition, execute: async (toolInput: unknown, options: Parameters<typeof execute>[1]) => {
      try { return await fence.admit(async () => await execute(toolInput, options)); }
      catch (error) { if (isCanonicalLocalFenced(error)) return FENCED_TOOL_RESULT; throw error; }
    } };
    // The spread drops the non-enumerable Effect metadata governance keys on; reattach the same frozen identity.
    const metadata = memoryEffectMetadata(definition);
    return [name, Object.freeze(metadata ? attachMemoryEffectMetadata(fenced, metadata) : fenced)];
  })));
}
