/**
 * INPUT:  MemoryStatusParams from a dispatched memory.status request + the window-state / summary / auto-state repos
 * OUTPUT: memoryStatusMethod(deps) -> MethodDefinition (operator-only); calibration + compaction + auto-write counters
 * POS:    core/server/methods — one file per WS method; a READ-ONLY status surface for the settings panel's operations
 *         page. COUNTS ONLY: the summary's length crosses, never its text (the repo read enforces it). NO Rust mirror
 */
import {
  MEMORY_METHODS,
  MemoryStatusParamsSchema,
  type MemoryStatusParams,
  type MemoryStatusResult,
} from "@taki/shared";
import type { MemoryAutoRepo } from "../../db/memory-auto-repo.ts";
import type { SummaryRepo } from "../../db/summary-repo.ts";
import type { WindowStateRepo } from "../../db/window-state-repo.ts";
import type { MethodDefinition } from "../method-registry.ts";

export interface MemoryStatusDeps {
  windowState: Pick<WindowStateRepo, "list">;
  summaries: Pick<SummaryRepo, "getMeta">;
  autoState: Pick<MemoryAutoRepo, "get">;
}

export function memoryStatusMethod(deps: MemoryStatusDeps): MethodDefinition<MemoryStatusParams> {
  return {
    method: MEMORY_METHODS.status,
    roles: ["operator"], // a settings-surface read; the agent has no WS path and no business auditing its own store
    paramsSchema: MemoryStatusParamsSchema,
    handler: ({ characterId }): MemoryStatusResult => ({
      windowSlots: deps.windowState.list(),
      summary: deps.summaries.getMeta(characterId),
      auto: deps.autoState.get(characterId),
    }),
  };
}
