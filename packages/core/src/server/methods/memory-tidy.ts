/**
 * INPUT:  MemoryTidyParams from a dispatched memory.tidy request + the tidy pass's runNow
 * OUTPUT: memoryTidyMethod(tidy) -> MethodDefinition (operator-only); runs the maintenance pass NOW, reports counts
 * POS:    core/server/methods — one file per WS method; agents have no WS path, so operator-only registration IS the
 *         invocation guard; counts/usage only — memory content never rides this response. NO Rust mirror
 */
import { MEMORY_METHODS, MemoryTidyParamsSchema, type MemoryTidyParams, type MemoryTidyResult } from "@taki/shared";
import type { TidyRunOutcome } from "../../memory/tidy-pass.ts";
import type { MethodDefinition } from "../method-registry.ts";

export interface TidyRunner {
  runNow(characterId: string): Promise<TidyRunOutcome>;
}

export function memoryTidyMethod(tidy: TidyRunner): MethodDefinition<MemoryTidyParams> {
  return {
    method: MEMORY_METHODS.tidy,
    roles: ["operator"], // store maintenance is a settings-surface concern (panel/CLI consume this later — #26)
    paramsSchema: MemoryTidyParamsSchema,
    handler: async ({ characterId }): Promise<MemoryTidyResult> => {
      const outcome = await tidy.runNow(characterId);
      // A failed pass is an ERROR to the operator (INTERNAL_ERROR via the registry), never a fake "ran".
      if (outcome.status === "failed") throw new Error("tidy pass failed; see core logs");
      return {
        status: outcome.status,
        defects: outcome.defects,
        edits: outcome.edits,
        steps: outcome.steps,
        usage: outcome.usage,
      };
    },
  };
}
