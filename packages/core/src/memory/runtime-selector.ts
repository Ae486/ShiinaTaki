/**
 * INPUT:  open Database, legacy subsystem factory, and post-activation canonical Local factory
 * OUTPUT: startup memory runtime selection before any legacy construction occurs
 * POS:    core/memory — authority marker routing seam; canonical mode never invokes the legacy factory
 */
import type { Database } from "../db/sqlite.ts";
import type { MemoryEngine } from "./memory-engine.ts";
import type { MemorySubsystem } from "./bootstrap.ts";
import { readMemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";

export interface SelectedMemoryRuntime {
  memory: MemoryEngine;
  legacy: MemorySubsystem | null;
  readonly canonical: boolean;
  bindCanonical(epochId: string): void;
}
export function selectMemoryRuntime(input: {
  db: Database;
  createLegacy: () => MemorySubsystem;
  createCanonical: (epochId: string) => MemoryEngine;
  onCanonicalBound?: () => void;
}): SelectedMemoryRuntime {
  const selection = readMemoryAuthoritySelection(input.db);
  if (selection.mode === "hindsight") {
    throw new Error("MEMORY_INTEGRITY_ERROR: Hindsight authority runtime is not installed");
  }
  let canonical = selection.mode === "canonical-local";
  let legacy: MemorySubsystem | null = null;
  let current: MemoryEngine;
  if (canonical) {
    current = input.createCanonical(selection.epochId as string);
  } else {
    legacy = input.createLegacy();
    current = legacy.engine;
  }
  const memory = delegatingEngine(() => current);
  return {
    memory,
    get legacy() { return legacy; },
    get canonical() { return canonical; },
    bindCanonical(epochId) {
      if (canonical) return;
      current = input.createCanonical(epochId);
      canonical = true;
      legacy = null;
      input.onCanonicalBound?.();
    },
  };
}

function delegatingEngine(current: () => MemoryEngine): MemoryEngine {
  return {
    reconcile: () => current().reconcile(),
    assemble: (input) => current().assemble(input),
    createTools: (characterId, seq) => current().createTools(characterId, seq),
    createBackgroundTools: (characterId, seq) => current().createBackgroundTools(characterId, seq),
    writeEntry: (input) => current().writeEntry(input),
    retention: {
      listActive: (layer) => current().retention.listActive(layer),
      archive: (path) => current().retention.archive(path),
      hardDelete: (path) => current().retention.hardDelete(path),
    },
    tidy: {
      listActive: (characterId) => current().tidy.listActive(characterId),
      countSince: (characterId, since) => current().tidy.countSince(characterId, since),
      readBlock: (ref) => current().tidy.readBlock(ref),
      createTools: (characterId) => current().tidy.createTools(characterId),
    },
  };
}
