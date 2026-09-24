/**
 * INPUT:  open Database and explicit Legacy, canonical Local and Hindsight subsystem factories
 * OUTPUT: marker-first runtime selection, irreversible post-commit retirement (failed rebinding included), observable
 *         unavailable Local/Hindsight boot, same-epoch recovery that never re-activates or re-promotes, and the same-epoch
 *         Hindsight replace a connection revalidation drives
 * POS:    core/memory — authority marker routing seam; canonical mode never invokes the legacy factory
 */
import type { Database } from "../db/sqlite.ts";
import type { MemoryEngine } from "./memory-engine.ts";
import type { MemorySubsystem } from "./bootstrap.ts";
import { readMemoryAuthoritySelection, type MemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";

export type BindingRecoveryOutcome = "healthy" | "published";
export interface SelectedMemoryRuntime {
  memory: MemoryEngine;
  legacy: MemorySubsystem | null;
  readonly canonical: boolean;
  bindCanonical(epochId: string): void;
  /** Same-epoch repair of an unavailable committed Local runtime; never re-activates and never revives Legacy. */
  recoverCanonical(epochId: string): BindingRecoveryOutcome;
  /** After a Hindsight COMMIT: retire Local (never restored) and construct the Hindsight runtime for the committed epoch. */
  bindHindsight(epochId: string): void;
  /** Same-epoch repair of an unavailable committed Hindsight runtime; never re-promotes and never revives Local. */
  recoverHindsight(epochId: string): BindingRecoveryOutcome;
  /** Same-epoch swap onto a runtime built from the current connection; resolves once the replaced runtime stopped. */
  replaceHindsight(epochId: string): Promise<void>;
  stop(): void;
}
export interface SelectMemoryRuntimeInput {
  db: Database;
  createLegacy: () => MemorySubsystem;
  createCanonical: (epochId: string) => MemoryEngine;
  createHindsight?: (epochId: string) => MemoryEngine;
  replaceHindsight?: (epochId: string) => { engine: MemoryEngine; retired: Promise<void> };
  onLegacyRetired?: () => void;
  onCanonicalBound?: () => void;
  /** Runs once the Hindsight marker is proven and before construction: the Local runtime is withdrawn whatever follows. */
  onLocalRetired?: () => void;
  /** Present = a committed Local or Hindsight runtime that fails to construct at boot stays observable and unavailable instead of aborting boot. */
  onBootUnavailable?: (error: unknown) => void;
  /** False when the constructed Hindsight runtime was withdrawn afterwards (failed start); recovery then constructs it again. */
  hindsightLive?: () => boolean;
}
interface SelectorState { canonical: boolean; legacy: MemorySubsystem | null; current: MemoryEngine | undefined }

export function selectMemoryRuntime(input: SelectMemoryRuntimeInput): SelectedMemoryRuntime {
  const selection = readMemoryAuthoritySelection(input.db);
  const state: SelectorState = { canonical: selection.mode !== "legacy-markdown", legacy: null, current: undefined };
  if (selection.mode === "hindsight") {
    const construct = requireHindsight(input);
    state.current = bootConstruct(input, () => construct(selection.epochId as string));
  } else if (state.canonical) {
    state.current = bootConstruct(input, () => input.createCanonical(selection.epochId as string));
  } else {
    state.legacy = input.createLegacy();
    state.current = state.legacy.engine;
  }
  const readCurrent = (): MemoryEngine => {
    if (!state.current) throw new Error("MEMORY_INTEGRITY_ERROR: selected memory runtime is unavailable");
    return state.current;
  };
  return {
    memory: delegatingEngine(readCurrent),
    get legacy() { return state.legacy; },
    get canonical() { return state.canonical; },
    stop: () => { state.current = undefined; },
    bindCanonical: (epochId) => bindCanonical(input, state, epochId),
    recoverCanonical: (epochId) => {
      if (!state.canonical) throw new Error("MEMORY_AUTHORITY_MISMATCH");
      committedEpoch(readMemoryAuthoritySelection(input.db), epochId);
      if (state.current) return "healthy";
      state.current = input.createCanonical(epochId);
      return "published";
    },
    bindHindsight: (epochId) => bindHindsight(input, state, epochId),
    recoverHindsight: (epochId) => {
      committedHindsightEpoch(readMemoryAuthoritySelection(input.db), epochId);
      if (state.current && (input.hindsightLive?.() ?? true)) return "healthy";
      state.current = requireHindsight(input)(epochId);
      return "published";
    },
    replaceHindsight: async (epochId) => {
      committedHindsightEpoch(readMemoryAuthoritySelection(input.db), epochId);
      if (!input.replaceHindsight) throw new Error("MEMORY_INTEGRITY_ERROR: Hindsight authority runtime is not installed");
      let next: { engine: MemoryEngine; retired: Promise<void> };
      try { next = input.replaceHindsight(epochId); }
      catch (error) { state.current = undefined; throw error; }
      state.current = next.engine;
      await next.retired;
    },
  };
}

function committedEpoch(committed: MemoryAuthoritySelection, epochId: string): void {
  if (committed.mode !== "canonical-local" || committed.epochId !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
}

function committedHindsightEpoch(committed: MemoryAuthoritySelection, epochId: string): void {
  if (committed.mode !== "hindsight" || committed.epochId !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
}

function requireHindsight(input: SelectMemoryRuntimeInput): (epochId: string) => MemoryEngine {
  if (!input.createHindsight) throw new Error("MEMORY_INTEGRITY_ERROR: Hindsight authority runtime is not installed");
  return input.createHindsight;
}

function bindCanonical(input: SelectMemoryRuntimeInput, state: SelectorState, epochId: string): void {
  const committed = readMemoryAuthoritySelection(input.db);
  if (committed.mode === "legacy-markdown") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const wasCanonical = state.canonical;
  // The marker is already durable. A failed constructor cannot restore the old provider or its detached writes.
  if (!wasCanonical) {
    state.canonical = true; state.legacy = null; state.current = undefined;
    input.onLegacyRetired?.();
  }
  committedEpoch(committed, epochId);
  if (wasCanonical) {
    if (!state.current) throw new Error("MEMORY_INTEGRITY_ERROR: canonical Local runtime is unavailable");
    return;
  }
  const next = input.createCanonical(epochId);
  input.onCanonicalBound?.();
  state.current = next;
}

/** Local is withdrawn only on positive Hindsight marker proof; a failed construction leaves Hindsight selected and unavailable. */
function bindHindsight(input: SelectMemoryRuntimeInput, state: SelectorState, epochId: string): void {
  committedHindsightEpoch(readMemoryAuthoritySelection(input.db), epochId);
  const construct = requireHindsight(input);
  state.canonical = true; state.legacy = null; state.current = undefined;
  input.onLocalRetired?.();
  state.current = construct(epochId);
}

function bootConstruct(input: SelectMemoryRuntimeInput, construct: () => MemoryEngine): MemoryEngine | undefined {
  try { return construct(); }
  catch (error) {
    if (!input.onBootUnavailable) throw error;
    input.onBootUnavailable(error);
    return undefined;
  }
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
      captureReview: (characterId) => current().tidy.captureReview?.(characterId) ?? current().tidy,
      listActive: (characterId) => current().tidy.listActive(characterId),
      countSince: (characterId, since) => current().tidy.countSince(characterId, since),
      readBlock: (ref) => current().tidy.readBlock(ref),
      createTools: (characterId) => current().tidy.createTools(characterId),
    },
  };
}
