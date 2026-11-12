/**
 * INPUT: selected binding owners, shared Utility/maintenance work and process shutdown callbacks
 * OUTPUT: one runtime liveness/start/retirement owner with shared repeated-stop completion
 * POS: core/memory — joins every producer before SQLite closes; selection/binding construction remains in composition
 */
import type { MemoryRuntimeScope } from "./runtime-composition.ts";
import type { createUtilitySlot } from "./utility-slot.ts";
import type { createCompactionMaintenance } from "./runtime-compaction-composition.ts";

export function createRuntimeLifetime(input: {
  scope: MemoryRuntimeScope; utility: ReturnType<typeof createUtilitySlot>;
  autoMemory: ReturnType<typeof createCompactionMaintenance>["autoMemory"];
}) {
  let stopped = false; let started = false; let completion: Promise<void> | undefined;
  const { scope } = input;
  return { alive: () => { if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED"); },
    // A boot start failure is recorded by the binding as unavailable (recover repairs it); Core keeps serving.
    start: () => { started = true; try { scope.hindsightBinding.start(); } catch { /* observable through the binding snapshot */ } },
    /** A binding published after start() (activation, recovery) starts immediately; before it, start() will. */
    startHindsight: () => { if (started) scope.hindsightBinding.start(); },
    stop: (stopTransitions: () => Promise<void>, stopConfiguration: () => Promise<void>) => {
      if (completion) return completion;
      stopped = true; scope.selected.stop();
      // Abort producers concurrently, then settle every retired/failed binding before the caller closes SQLite.
      // The transition executor still owns its in-flight target receipt lookup until stopTransitions settles.
      completion = Promise.allSettled([stopTransitions(), stopConfiguration(), input.autoMemory.stop(), input.utility.stop(),
        scope.hindsightBinding.stop(), scope.local.stop(), Promise.resolve(scope.selected.legacy?.stop?.())])
        .then((results) => { if (results.some((result) => result.status === "rejected")) throw new Error("MEMORY_SHUTDOWN_FAILED"); });
      return completion;
    } };
}
