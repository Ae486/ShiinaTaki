/**
 * INPUT:  open Database and explicit Legacy, canonical Local and Hindsight subsystem factories
 * OUTPUT: marker-first runtime selection and irreversible post-commit retirement, including failed rebinding
 * POS:    core/memory — authority marker routing seam; canonical mode never invokes the legacy factory
 */
import type { Database } from "../db/sqlite.ts";
import type { MemoryEngine } from "./memory-engine.ts";
import type { MemorySubsystem } from "./bootstrap.ts";
import { readMemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";
import { forwardRenderedContextText } from "../agents/context-attribution.ts";

export interface SelectedMemoryRuntime {
  memory: MemoryEngine;
  legacy: MemorySubsystem | null;
  readonly canonical: boolean;
  bindCanonical(epochId: string): void;
  stop(): void;
}
export function selectMemoryRuntime(input: {
  db: Database;
  createLegacy: () => MemorySubsystem;
  createCanonical: (epochId: string) => MemoryEngine;
  createHindsight?: (epochId: string) => MemoryEngine;
  onLegacyRetired?: () => void;
  onCanonicalBound?: () => void;
}): SelectedMemoryRuntime {
  const selection = readMemoryAuthoritySelection(input.db);
  if (selection.mode === "hindsight" && !input.createHindsight) {
    throw new Error("MEMORY_INTEGRITY_ERROR: Hindsight authority runtime is not installed");
  }
  let canonical = selection.mode !== "legacy-markdown";
  let legacy: MemorySubsystem | null = null;
  let current: MemoryEngine | undefined;
  if (selection.mode === "hindsight") {
    current = input.createHindsight!(selection.epochId as string);
  } else if (canonical) {
    current = input.createCanonical(selection.epochId as string);
  } else {
    legacy = input.createLegacy();
    current = legacy.engine;
  }
  const readCurrent = (): MemoryEngine => {
    if (!current) throw new Error("MEMORY_INTEGRITY_ERROR: canonical Local runtime is unavailable");
    return current;
  };
  const memory = delegatingEngine(readCurrent);
  return {
    memory,
    get legacy() { return legacy; },
    get canonical() { return canonical; },
    stop: () => { current = undefined; },
    bindCanonical(epochId) {
      const committed = readMemoryAuthoritySelection(input.db);
      if (committed.mode === "legacy-markdown") throw new Error("MEMORY_AUTHORITY_MISMATCH");
      const wasCanonical = canonical;
      // The marker is already durable. A failed constructor cannot restore the old provider or its detached writes.
      if (!wasCanonical) {
        canonical = true; legacy = null; current = undefined;
        input.onLegacyRetired?.();
      }
      if (committed.mode !== "canonical-local" || committed.epochId !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
      if (wasCanonical) { readCurrent(); return; }
      const next = input.createCanonical(epochId);
      input.onCanonicalBound?.();
      current = next;
    },
  };
}

function delegatingEngine(current: () => MemoryEngine): MemoryEngine {
  const assemble: MemoryEngine["assemble"] = (input) => {
    const engine = current();
    return forwardRenderedContextText(assemble, engine.assemble, engine.assemble(input));
  };
  return {
    reconcile: () => current().reconcile(),
    assemble,
    createTools: (characterId, seq) => current().createTools(characterId, seq),
    createBackgroundTools: (characterId, seq) => current().createBackgroundTools(characterId, seq),
    writeEntry: (input) => current().writeEntry(input),
    retention: {
      listActive: (layer) => current().retention.listActive(layer),
      archive: (path) => current().retention.archive(path),
      hardDelete: (path) => current().retention.hardDelete(path),
    },
    tidy: {
      captureReview: (characterId) => current().tidy.captureReview?.(characterId) ?? current().tidy,
      listActive: (characterId) => current().tidy.listActive(characterId),
      countSince: (characterId, since) => current().tidy.countSince(characterId, since),
      readBlock: (ref) => current().tidy.readBlock(ref),
      createTools: (characterId) => current().tidy.createTools(characterId),
    },
  };
}
