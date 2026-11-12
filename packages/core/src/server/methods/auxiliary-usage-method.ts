/**
 * INPUT: authenticated operator queries, auxiliary usage repository, and live monitor mode
 * OUTPUT: bounded observed auxiliary model-call counters independent of Run accounting
 * POS: core/server/methods — read-only optional monitor endpoint
 */
import { AuxiliaryUsageQuerySchema, OBSERVABILITY_METHODS, type MonitorMode } from "@taki/shared";
import type { AuxiliaryUsageRepo } from "../../db/auxiliary-usage-repo.ts";
import type { MethodRegistry } from "../method-registry.ts";

export function registerAuxiliaryUsageMethod(registry: MethodRegistry, input: {
  repo: AuxiliaryUsageRepo; mode: () => MonitorMode;
}): void {
  registry.register({ method: OBSERVABILITY_METHODS.auxiliaryUsage, roles: ["operator"],
    paramsSchema: AuxiliaryUsageQuerySchema,
    handler: (params) => {
      if (input.mode() === "DISABLED") throw new Error("OBSERVABILITY_DISABLED");
      return input.repo.query(params);
    },
  });
}
