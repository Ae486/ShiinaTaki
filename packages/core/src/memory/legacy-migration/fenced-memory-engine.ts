/**
 * INPUT:  one MemoryEngine and the process-wide authority fence
 * OUTPUT: the same engine contract with every legacy admission counted or rejected during cutover
 * POS:    core/memory/legacy-migration — narrow runtime wrapper used before auto/tidy/retention bindings are built
 */
import type { MemoryEngine } from "../memory-engine.ts";
import type { MemoryAuthorityFence } from "./memory-authority-fence.ts";

export function fenceMemoryEngine(engine: MemoryEngine, fence: MemoryAuthorityFence): MemoryEngine {
  return {
    reconcile: () => fence.admitSync(engine.reconcile),
    assemble: (input) => fence.admitSync(() => engine.assemble(input)),
    createTools: (characterId, seq) => fence.admitSync(() => engine.createTools(characterId, seq)),
    createBackgroundTools: (characterId, seq) => fence.admitSync(() => engine.createBackgroundTools(characterId, seq)),
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
      createTools: (characterId) => fence.admitSync(() => engine.tidy.createTools(characterId)),
    },
  };
}
