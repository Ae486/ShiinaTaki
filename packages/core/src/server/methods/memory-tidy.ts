/**
 * INPUT:  MemoryTidyParams from a dispatched memory.tidy request + the tidy pass's runNow
 * OUTPUT: memoryTidyMethod(tidy) -> MethodDefinition (operator-only); runs the maintenance pass NOW, reports counts
 * POS:    core/server/methods — one file per WS method; agents have no WS path, so operator-only registration IS the
 *         invocation guard; counts/usage only — memory content never rides this response. NO Rust mirror
 */
import { JSONRPCErrorException } from "json-rpc-2.0";
import { JSON_RPC_ERROR_CODES, MEMORY_METHODS, MemoryTidyFailureDetailsSchema, MemoryTidyParamsSchema,
  type MemoryTidyParams, type MemoryTidyResult } from "@taki/shared";
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
      // Old clients still receive an error; newer clients can show committed work and bounded safe reasons.
      if (outcome.status === "failed" || outcome.status === "partial") {
        const issues = outcome.issues ?? [];
        const details = MemoryTidyFailureDetailsSchema.parse({
          kind: "memory-tidy", status: outcome.edits > 0 ? "partial" : "failed",
          defects: outcome.defects, edits: outcome.edits, steps: outcome.steps, usage: outcome.usage,
          reason: outcome.reason ?? "execution-failed", issues: issues.slice(0, 20),
          issueCount: outcome.issueCount ?? issues.length,
        });
        throw new JSONRPCErrorException("tidy pass failed; completed changes were retained", JSON_RPC_ERROR_CODES.INTERNAL_ERROR, details);
      }
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
