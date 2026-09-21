/**
 * INPUT:  a Local subsystem draft constructor, the authority marker reader and the composition logger
 * OUTPUT: createLocalRuntimeBinding -> publish/current/snapshot/stop: the ONE published truth for the Local engine,
 *         captureRun, maintenance, writeMemory and flush, plus a pure snapshot for onboarding and authority status
 * POS:    core/memory — draft -> install -> publish -> start; a failed draft is disposed and leaves an observable
 *         unavailable state, never a half-published engine; no side channel exposes a draft
 */
import type { Database } from "../db/sqlite.ts";
import type { Logger } from "../logging/logger.ts";
import type { createCanonicalLocalSubsystem } from "./canonical-local-subsystem.ts";
import { readMemoryAuthoritySelection, type MemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";

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
  snapshot(): LocalBindingSnapshot;
  stop(): void;
}

const REQUIRED_MEMBERS = ["engine", "maintenance", "memoryFlush", "tidy", "writeMemory", "captureRun", "recordPrimaryCommitted", "start", "stop"] as const;

export function createLocalRuntimeBinding(input: { db: Database; construct: (epochId: string) => LocalSubsystem; logger: Logger }): LocalRuntimeBinding {
  let published: LocalSubsystem | undefined;
  let state: LocalBindingState = { kind: "none" };
  let stopped = false;
  return {
    publish: (epochId) => {
      if (published) throw new Error("MEMORY_INTEGRITY_ERROR: Local runtime binding is already published");
      let draft: LocalSubsystem | undefined;
      try {
        draft = input.construct(epochId);
        install(draft);
        published = draft; state = { kind: "published", epochId };
        draft.start();
        return draft;
      } catch (error) {
        published = undefined; state = { kind: "unavailable", epochId, code: failureCode(error) };
        dispose(draft);
        input.logger.error({ code: "MEMORY_LOCAL_BINDING_UNAVAILABLE", epochId, cause: state.code }, "canonical Local runtime binding failed; runtime stays unavailable");
        throw error;
      }
    },
    current: () => published,
    snapshot: () => {
      const selection = readMemoryAuthoritySelection(input.db);
      return { selection: selection.mode, selectedEpochId: selection.epochId, binding: state,
        lifetime: stopped ? "stopped" : "running", flush: published && !stopped ? "available" : "failing" };
    },
    stop: () => { stopped = true; dispose(published); },
  };
}

/** The installed surface must be complete before publication; a partial draft is a fail-closed integrity error. */
function install(draft: LocalSubsystem): void {
  for (const member of REQUIRED_MEMBERS) {
    if (draft[member] === undefined || draft[member] === null) throw new Error(`MEMORY_INTEGRITY_ERROR: Local runtime draft lacks ${member}`);
  }
  if (typeof draft.memoryFlush.prepareRetirement !== "function") throw new Error("MEMORY_INTEGRITY_ERROR: Local runtime draft lacks a flush port");
}

function dispose(subsystem: LocalSubsystem | undefined): void {
  // Disposal is best effort: the unavailable state is the durable fact, and a failing stop must not mask the cause.
  try { subsystem?.stop(); } catch { /* recorded through the binding state */ }
}

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.match(/^[A-Z][A-Z_]+(?=:|$)/)?.[0] ?? "MEMORY_LOCAL_BINDING_FAILED";
}
