/**
 * INPUT:  one MemoryEngine and the process-wide authority fence
 * OUTPUT: the same engine/tool contracts with each invocation admitted through the shared retirement fence
 * POS:    core/memory/legacy-migration — narrow runtime wrapper used before auto/tidy/retention bindings are built
 */
import type { MemoryEngine } from "../memory-engine.ts";
import type { ToolSet } from "ai";
import type { MemoryAuthorityFence } from "./memory-authority-fence.ts";

export function fenceMemoryEngine(engine: MemoryEngine, fence: MemoryAuthorityFence): MemoryEngine {
  return {
    reconcile: () => fence.admitSync(engine.reconcile),
    assemble: (input) => fence.admitSync(() => engine.assemble(input)),
    createTools: (characterId, seq) => fence.admitSync(() => fenceTools(engine.createTools(characterId, seq), fence)),
    createBackgroundTools: (characterId, seq) => fence.admitSync(() => fenceTools(engine.createBackgroundTools(characterId, seq), fence)),
    writeEntry: (input) => fence.admitSync(() => engine.writeEntry(input)),
    retention: {
      listActive: (layer) => fence.admitSync(() => engine.retention.listActive(layer)),
      archive: (path) => fence.admitSync(() => engine.retention.archive(path)),
      hardDelete: (path) => fence.admitSync(() => engine.retention.hardDelete(path)),
    },
    tidy: {
      listActive: (characterId) => fence.admitSync(() => engine.tidy.listActive(characterId)),
      countSince: (characterId, since) => fence.admitSync(() => engine.tidy.countSince(characterId, since)),
      readBlock: (ref) => fence.admitSync(() => engine.tidy.readBlock(ref)),
      createTools: (characterId) => fence.admitSync(() => fenceTools(engine.tidy.createTools(characterId), fence)),
    },
  };
}

function fenceTools(tools: ToolSet, fence: MemoryAuthorityFence): ToolSet {
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => {
    const execute = definition.execute;
    if (!execute) return [name, definition];
    return [name, { ...definition, execute: async (input: unknown, options: Parameters<typeof execute>[1]) => {
      try {
        // Tool creation can precede activation by a whole model call. Admit execution itself and await its settlement.
        return await fence.admit(async () => await execute(input, options));
      } catch (error) {
        const fenced = error instanceof Error && error.message === "MEMORY_AUTHORITY_FENCED";
        return { ok: false, code: fenced ? "MEMORY_AUTHORITY_FENCED" : "IO_ERROR",
          message: fenced ? "Legacy memory access is fenced." : "Legacy memory operation failed." };
      }
    } }];
  }));
}
