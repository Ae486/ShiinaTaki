/**
 * INPUT:  a Hindsight subsystem draft constructor, the authority marker reader and the composition logger
 * OUTPUT: createHindsightRuntimeBinding -> publish/replace/start/current/snapshot/stop: the ONE published truth for the Hindsight
 *         engine, scheduler, ingestion and flush after COMMIT, plus a pure snapshot for activation and authority status;
 *         hindsightRuntimeAvailability() and witnessHindsightPrimaryCommit() (marker-routed witness while unbound)
 * POS:    core/memory — draft -> install -> publish -> start; a failed draft is disposed and leaves an observable unavailable
 *         state with Hindsight still selected; never re-promotes and never restores Local
 */
import type { MemoryRuntimeUnavailableReason } from "@taki/shared";
import { createHindsightIngestionSourceRepo } from "../db/hindsight-ingestion-source-repo.ts";
import type { Database } from "../db/sqlite.ts";
import type { Logger } from "../logging/logger.ts";
import type { PrimaryConversationCommit } from "./canonical-ingestion-source.ts";
import type { createHindsightMemorySubsystem } from "./hindsight/hindsight-memory-subsystem.ts";
import { readMemoryAuthoritySelection, type MemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";

export type HindsightSubsystem = ReturnType<typeof createHindsightMemorySubsystem>;
export type HindsightBindingState =
  | { kind: "published"; epochId: string }
  | { kind: "unavailable"; epochId: string; code: string }
  | { kind: "none" };
/** Pure: reads the marker and in-memory publication state only; never probes the native side or captures a Run. */
export interface HindsightBindingSnapshot {
  selection: MemoryAuthoritySelection["mode"];
  selectedEpochId: string | null;
  binding: HindsightBindingState;
  lifetime: "running" | "stopped";
  flush: "available" | "failing";
}
export interface HindsightRuntimeAvailability { available: boolean; unavailableReason: MemoryRuntimeUnavailableReason | null }
export interface HindsightRuntimeBinding {
  /** Builds, installs and publishes one draft; on any failure disposes it, records unavailable and rethrows. */
  publish(epochId: string): HindsightSubsystem;
  /**
   * Revalidation rebind: builds the next draft while the current one stays published, swaps publication, and resolves
   * `retired` once the old subsystem stopped. With nothing published it publishes. A failed draft withdraws both.
   */
  replace(epochId: string): { subsystem: HindsightSubsystem; retired: Promise<void> };
  /** Starts the published subsystem once the composition runs; a failing start withdraws the publication as unavailable. */
  start(): void;
  current(): HindsightSubsystem | undefined;
  snapshot(): HindsightBindingSnapshot;
  /** Withdraw this epoch and settle all its owners, while permitting a fresh subsystem on a later epoch. */
  retire(): Promise<void>;
  stop(): Promise<void>;
}

const REQUIRED_MEMBERS = ["engine", "maintenance", "memoryFlush", "tidy", "writeMemory", "captureRun", "recordPrimaryCommitted",
  "state", "scheduler", "start", "stop"] as const;

export function createHindsightRuntimeBinding(input: { db: Database; construct: (epochId: string) => HindsightSubsystem; logger: Logger }): HindsightRuntimeBinding {
  let published: HindsightSubsystem | undefined;
  let state: HindsightBindingState = { kind: "none" };
  let started = false; let stopped = false;
  const dispose = retirementQueue(input.logger);
  const retireEpoch = (): Promise<void> => {
    const previous = published; published = undefined; started = false; state = { kind: "none" };
    return dispose(previous);
  };
  const fail = (epochId: string, error: unknown, draft: HindsightSubsystem | undefined): never => {
    published = undefined; started = false; state = { kind: "unavailable", epochId, code: failureCode(error) };
    dispose(draft);
    input.logger.error({ code: "MEMORY_HINDSIGHT_BINDING_UNAVAILABLE", epochId, cause: state.code }, "Hindsight runtime binding failed; runtime stays unavailable");
    throw error;
  };
  const publish = (epochId: string, previous: HindsightSubsystem | undefined): HindsightSubsystem => {
    let draft: HindsightSubsystem | undefined;
    try {
      draft = input.construct(epochId);
      install(draft);
      published = draft; state = { kind: "published", epochId }; started = false;
      return draft;
    } catch (error) {
      // The draft was built for a changed connection the old runtime already refuses; keeping it published would hide that.
      dispose(previous);
      return fail(epochId, error, draft);
    }
  };
  return {
    publish: (epochId) => {
      if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED");
      if (published) throw new Error("MEMORY_INTEGRITY_ERROR: Hindsight runtime binding is already published");
      return publish(epochId, undefined);
    },
    replace: (epochId) => {
      if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED");
      const previous = published;
      const subsystem = publish(epochId, previous);
      return { subsystem, retired: dispose(previous) };
    },
    start: () => {
      if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED");
      if (!published || started || state.kind !== "published") return;
      try { published.start(); started = true; }
      catch (error) { fail(state.epochId, error, published); }
    },
    current: () => published,
    snapshot: () => snapshotOf(input.db, { binding: state, stopped, flushing: published !== undefined && !stopped }),
    retire: retireEpoch,
    stop: async () => {
      if (stopped) return dispose(undefined);
      stopped = true;
      await retireEpoch();
    },
  };
}

/** Failed drafts and replacements remain owned even when no published subsystem can be found at shutdown. */
function retirementQueue(logger: Logger) {
  let retiring: Promise<void> = Promise.resolve();
  return (subsystem: HindsightSubsystem | undefined): Promise<void> => {
    if (!subsystem) return retiring;
    subsystem.writeFence?.retire(); subsystem.workFence?.retire();
    const completion = retire(subsystem, logger);
    retiring = Promise.all([retiring, completion]).then(() => undefined);
    return retiring;
  };
}

/** Under Legacy or Local authority the Hindsight binding is not the selected runtime; only a selected Hindsight epoch is judged. */
export function hindsightRuntimeAvailability(snapshot: HindsightBindingSnapshot): HindsightRuntimeAvailability {
  if (snapshot.selection !== "hindsight") return { available: true, unavailableReason: null };
  if (snapshot.lifetime === "stopped") return { available: false, unavailableReason: "stopped" };
  if (snapshot.binding.kind !== "published") return { available: false, unavailableReason: "not_installed" };
  if (snapshot.binding.epochId !== snapshot.selectedEpochId) return { available: false, unavailableReason: "authority_mismatch" };
  return { available: true, unavailableReason: null };
}

/**
 * A primary commit while Hindsight is committed but unbound (bind failure, boot-unavailable) is witnessed straight into the
 * Hindsight source ledger by the durable marker, so nothing is dropped between COMMIT and a later repair. Returns false when
 * the marker is not Hindsight so the caller routes to the published Local runtime instead.
 */
export function witnessHindsightPrimaryCommit(input: { db: Database; commit: PrimaryConversationCommit; logger: Logger; now?: () => string }): boolean {
  let selection: MemoryAuthoritySelection;
  try { selection = readMemoryAuthoritySelection(input.db); }
  catch { input.logger.warn({ code: "MEMORY_INGESTION_WITNESS_FAILED" }, "primary memory source witness was not committed: marker unreadable"); return true; }
  if (selection.mode !== "hindsight" || !selection.epochId) return false;
  try {
    createHindsightIngestionSourceRepo(input.db).recordPrimaryCommitted({ ...input.commit, epochId: selection.epochId, now: (input.now ?? (() => new Date().toISOString()))() });
  } catch { input.logger.warn({ code: "MEMORY_INGESTION_WITNESS_FAILED" }, "Hindsight primary source witness was not committed"); }
  return true;
}

/** The installed surface must be complete before publication; a partial draft is a fail-closed integrity error. */
function install(draft: HindsightSubsystem): void {
  for (const member of REQUIRED_MEMBERS) {
    if (draft[member] === undefined || draft[member] === null) throw new Error(`MEMORY_INTEGRITY_ERROR: Hindsight runtime draft lacks ${member}`);
  }
  if (typeof draft.memoryFlush.prepareRetirement !== "function") throw new Error("MEMORY_INTEGRITY_ERROR: Hindsight runtime draft lacks a flush port");
}

function snapshotOf(db: Database, input: { binding: HindsightBindingState; stopped: boolean; flushing: boolean }): HindsightBindingSnapshot {
  const selection = readMemoryAuthoritySelection(db);
  return { selection: selection.mode, selectedEpochId: selection.epochId, binding: input.binding,
    lifetime: input.stopped ? "stopped" : "running", flush: input.flushing ? "available" : "failing" };
}

/** The replaced subsystem is already unpublished; a failing stop is logged, never allowed to undo the swap. */
async function retire(previous: HindsightSubsystem | undefined, logger: Logger): Promise<void> {
  try { await previous?.stop(); }
  catch { logger.warn({ code: "MEMORY_SHUTDOWN_FAILED" }, "replaced Hindsight runtime did not stop cleanly"); }
}

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.match(/^[A-Z][A-Z_]+(?=:|$)/)?.[0] ?? "MEMORY_HINDSIGHT_BINDING_FAILED";
}
