/**
 * INPUT:  a Local subsystem draft constructor, the authority marker reader and the composition logger
 * OUTPUT: createLocalRuntimeBinding -> publish/current/snapshot/retire/stop: the ONE published truth for the Local engine,
 *         captureRun, maintenance, writeMemory and flush, plus a pure snapshot for onboarding and authority status
 * POS:    core/memory — draft -> install -> publish -> start; a failed draft is disposed and leaves an observable
 *         unavailable state, never a half-published engine; no side channel exposes a draft
 */
import type { Database } from "../db/sqlite.ts";
import type { Logger } from "../logging/logger.ts";
import type { createCanonicalLocalSubsystem } from "./canonical-local-subsystem.ts";
import { readCurrentMemoryAuthorityIdentity, type MemoryAuthorityIdentity, type MemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";

export type LocalSubsystem = ReturnType<typeof createCanonicalLocalSubsystem>;
export type LocalBindingState =
  | { kind: "published"; epochId: string }
  | { kind: "unavailable"; epochId: string; code: string }
  | { kind: "none" };
/** Pure: reads the marker and in-memory publication state only; never calls captureRun or creates Banks as a probe. */
export interface LocalBindingSnapshot {
  selection: MemoryAuthoritySelection["mode"];
  selectedEpochId: string | null;
  binding: LocalBindingState;
  lifetime: "running" | "stopped";
  flush: "available" | "failing";
}
export interface LocalRuntimeBinding {
  /** Builds, installs, publishes and starts one draft; on any failure disposes it, records unavailable and rethrows. */
  publish(epochId: string): LocalSubsystem;
  current(): LocalSubsystem | undefined;
  boundIdentity(): MemoryAuthorityIdentity | undefined;
  unavailable(epochId: string, code: string): void;
  /** Detached in-memory state only; revision changes on any publication attempt, withdrawal or stop. */
  publicationState(): Pick<LocalBindingSnapshot, "binding" | "lifetime"> & { revision: number };
  snapshot(): LocalBindingSnapshot;
  /** Irreversible: after a Hindsight COMMIT the publication is withdrawn so no caller can route to the retired Local runtime. */
  retire(): void;
  /** Waits for unpublished and failed drafts as well as the last published subsystem. */
  settle(): Promise<void>;
  stop(): Promise<void>;
}

const REQUIRED_MEMBERS = ["engine", "maintenance", "memoryFlush", "tidy", "writeMemory", "captureRun", "recordPrimaryCommitted", "start", "stop"] as const;

export function createLocalRuntimeBinding(input: { db: Database; construct: (epochId: string) => LocalSubsystem; logger: Logger }): LocalRuntimeBinding {
  let published: LocalSubsystem | undefined;
  let state: LocalBindingState & { identity?: MemoryAuthorityIdentity } = { kind: "none" };
  let stopped = false;
  const retiring = new Set<Promise<void>>();
  const dispose = (subsystem: LocalSubsystem | undefined): void => {
    if (!subsystem) return;
    subsystem.fence?.retire();
    let stopping: Promise<void>;
    try { stopping = Promise.resolve(subsystem.stop()); } catch { stopping = Promise.reject(new Error("MEMORY_SHUTDOWN_FAILED")); }
    const task = stopping.catch(() => {
      input.logger.warn({ code: "MEMORY_SHUTDOWN_FAILED" }, "retired Local runtime did not stop cleanly");
    });
    retiring.add(task); void task.finally(() => retiring.delete(task));
  };
  const settle = async () => { while (retiring.size) await Promise.all([...retiring]); };
  return {
    publish: (epochId) => {
      if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED");
      if (published) throw new Error("MEMORY_INTEGRITY_ERROR: Local runtime binding is already published");
      let draft: LocalSubsystem | undefined;
      try {
        draft = input.construct(epochId);
        install(draft);
        published = draft; state = { kind: "published", epochId, identity: readCurrentMemoryAuthorityIdentity(input.db) };
        draft.start();
        return draft;
      } catch (error) {
        published = undefined; state = { kind: "unavailable", epochId, code: failureCode(error) };
        dispose(draft);
        input.logger.error({ code: "MEMORY_LOCAL_BINDING_UNAVAILABLE", epochId, cause: state.code }, "canonical Local runtime binding failed; runtime stays unavailable");
        throw error;
      }
    },
    ...bindingQueries(input.db, () => ({ published, state, stopped })),
    boundIdentity: () => published && state.kind === "published" ? state.identity : undefined,
    unavailable: (epochId, code) => { dispose(published); published = undefined; state = { kind: "unavailable", epochId, code }; },
    retire: () => { published?.fence?.retire(); dispose(published); published = undefined; state = { kind: "none" }; },
    settle,
    stop: async () => { stopped = true; dispose(published); published = undefined; await settle(); },
  };
}

/** Query revision tracks the existing state object's identity; it is not a second binding or authority owner. */
function bindingQueries(db: Database, read: () => { published: LocalSubsystem | undefined; state: LocalBindingState & { identity?: MemoryAuthorityIdentity }; stopped: boolean }) {
  let previous: LocalBindingState | undefined; let wasStopped = false; let revision = 0;
  return {
    current: () => read().published,
    publicationState: (): ReturnType<LocalRuntimeBinding["publicationState"]> => {
      const { state, stopped } = read();
      if (state !== previous || stopped !== wasStopped) { revision++; previous = state; wasStopped = stopped; }
      const binding = state.kind === "published" ? { kind: state.kind, epochId: state.epochId } : { ...state };
      return { binding, lifetime: stopped ? "stopped" : "running", revision };
    },
    snapshot: (): LocalBindingSnapshot => {
      const { state, stopped, published } = read(); const selection = readCurrentMemoryAuthorityIdentity(db);
      const binding = state.kind === "published" ? { kind: state.kind, epochId: state.epochId } : { ...state };
      return { selection: selection.mode, selectedEpochId: selection.epochId, binding,
        lifetime: stopped ? "stopped" : "running", flush: published && !stopped ? "available" : "failing" };
    },
  };
}

/** The installed surface must be complete before publication; a partial draft is a fail-closed integrity error. */
function install(draft: LocalSubsystem): void {
  for (const member of REQUIRED_MEMBERS) {
    if (draft[member] === undefined || draft[member] === null) throw new Error(`MEMORY_INTEGRITY_ERROR: Local runtime draft lacks ${member}`);
  }
  if (typeof draft.memoryFlush.prepareRetirement !== "function") throw new Error("MEMORY_INTEGRITY_ERROR: Local runtime draft lacks a flush port");
}

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.match(/^[A-Z][A-Z_]+(?=:|$)/)?.[0] ?? "MEMORY_LOCAL_BINDING_FAILED";
}
