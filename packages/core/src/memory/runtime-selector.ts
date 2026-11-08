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
import { readCurrentMemoryAuthorityIdentity, readMemoryAuthoritySelection, type MemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";
import type { MemoryAuthorityVerification } from "./runtime-authority-verification.ts";
import { activeTemplateHold } from "./hindsight/template-lifecycle/template-execution-reads.ts";

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
  verifySelectedAuthority?: MemoryAuthorityVerification["verifySelectedAuthority"];
  createLegacy: () => MemorySubsystem;
  createCanonical: (epochId: string) => MemoryEngine;
  createHindsight?: (epochId: string) => MemoryEngine;
  replaceHindsight?: (epochId: string) => { engine: MemoryEngine; retired: Promise<void> };
  onLegacyRetired?: () => void;
  onCanonicalBound?: () => void;
  /** Runs once the Hindsight marker is proven and before construction: the Local runtime is withdrawn whatever follows. */
  onLocalRetired?: () => void;
  /** Present = a committed Local or Hindsight runtime that fails to construct at boot stays observable and unavailable instead of aborting boot. */
  onBootUnavailable?: (error: unknown, selection: MemoryAuthoritySelection, invalidAuthority: boolean) => void;
  /** False when the constructed Hindsight runtime was withdrawn afterwards (failed start); recovery then constructs it again. */
  hindsightLive?: () => boolean;
  localLive?: () => boolean;
  /** Publication presence only; data operations retain their own current guards. */
  bindingLive?: () => boolean;
  onHindsightRetired?: () => void;
}
interface SelectorState { canonical: boolean; legacy: MemorySubsystem | null; current: MemoryEngine | undefined;
  provider: MemoryAuthoritySelection["mode"]; epochId: string | null; stopped: boolean }

export function selectMemoryRuntime(input: SelectMemoryRuntimeInput): SelectedMemoryRuntime {
  const selection = readCurrentMemoryAuthorityIdentity(input.db);
  const state: SelectorState = { canonical: selection.mode !== "legacy-markdown", legacy: null, current: undefined,
    provider: selection.mode, epochId: selection.epochId, stopped: false };
  if (selection.mode === "hindsight") {
    state.current = bootConstruct(input, selection, () => requireHindsight(input)(selection.epochId as string));
  } else if (state.canonical) {
    state.current = bootConstruct(input, selection, () => input.createCanonical(selection.epochId as string));
  } else {
    state.legacy = input.createLegacy();
    state.current = state.legacy.engine;
  }
  const readCurrent = (): MemoryEngine => {
    const live = state.canonical ? input.bindingLive?.() : true;
    if (!state.current || live === false) throw new Error("MEMORY_INTEGRITY_ERROR: selected memory runtime is unavailable");
    return state.current;
  };
  return {
    memory: delegatingEngine(readCurrent),
    get legacy() { return state.legacy; },
    get canonical() { return state.canonical; },
    stop: () => { state.stopped = true; state.current = undefined; },
    bindCanonical: (epochId) => bindCanonical(input, state, epochId),
    recoverCanonical: (epochId) => {
      alive(state);
      if (!state.canonical) throw new Error("MEMORY_AUTHORITY_MISMATCH");
      committedEpoch(verifySelected(input), epochId);
      if (state.current && state.provider === "canonical-local" && state.epochId === epochId && (input.localLive?.() ?? true)) return "healthy";
      state.current = undefined; state.provider = "canonical-local"; state.epochId = epochId;
      input.onHindsightRetired?.();
      state.current = input.createCanonical(epochId);
      return "published";
    },
    bindHindsight: (epochId) => bindHindsight(input, state, epochId),
    recoverHindsight: (epochId) => {
      alive(state);
      committedHindsightEpoch(verifySelected(input), epochId);
      if (activeTemplateHold(input.db, epochId)) throw new Error("MEMORY_TEMPLATE_HOLD");
      if (state.current && state.provider === "hindsight" && state.epochId === epochId && (input.hindsightLive?.() ?? true)) return "healthy";
      state.current = undefined; state.provider = "hindsight"; state.epochId = epochId;
      input.onLocalRetired?.();
      input.onHindsightRetired?.();
      state.current = requireHindsight(input)(epochId);
      return "published";
    },
    replaceHindsight: async (epochId) => {
      alive(state);
      committedHindsightEpoch(verifySelected(input), epochId);
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
  alive(state);
  const committed = verifySelected(input);
  if (committed.mode === "legacy-markdown") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const wasCanonical = state.canonical;
  // The marker is already durable. A failed constructor cannot restore the old provider or its detached writes.
  if (!wasCanonical) {
    state.canonical = true; state.legacy = null; state.current = undefined;
    input.onLegacyRetired?.();
  }
  committedEpoch(committed, epochId);
  if (wasCanonical && state.provider === "canonical-local" && state.epochId === epochId) {
    if (!state.current || !(input.localLive?.() ?? true)) throw new Error("MEMORY_INTEGRITY_ERROR: canonical Local runtime is unavailable");
    return;
  }
  state.current = undefined; state.provider = "canonical-local"; state.epochId = epochId;
  input.onHindsightRetired?.();
  const next = input.createCanonical(epochId);
  input.onCanonicalBound?.();
  state.current = next;
}

/** Local is withdrawn only on positive Hindsight marker proof; a failed construction leaves Hindsight selected and unavailable. */
function bindHindsight(input: SelectMemoryRuntimeInput, state: SelectorState, epochId: string): void {
  alive(state);
  committedHindsightEpoch(verifySelected(input), epochId);
  const construct = requireHindsight(input);
  state.canonical = true; state.legacy = null; state.current = undefined;
  state.provider = "hindsight"; state.epochId = epochId;
  input.onLocalRetired?.();
  state.current = construct(epochId);
}
function alive(state: SelectorState): void { if (state.stopped) throw new Error("MEMORY_OPERATION_CANCELLED"); }

function verifySelected(input: SelectMemoryRuntimeInput): MemoryAuthoritySelection {
  return input.verifySelectedAuthority ? input.verifySelectedAuthority() : readMemoryAuthoritySelection(input.db);
}

function bootConstruct(input: SelectMemoryRuntimeInput, selection: MemoryAuthoritySelection, construct: () => MemoryEngine): MemoryEngine | undefined {
  let verifying = true;
  try { verifySelected(input); verifying = false; return construct(); }
  catch (error) {
    if (!input.onBootUnavailable) throw error;
    input.onBootUnavailable(error, selection, verifying);
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
