/**
 * INPUT: operator-only B4 cutover status/verification requests and the fenced SQLite lifecycle repository
 * OUTPUT: bounded status projections and stale-epoch-aware readiness evidence
 * POS: core/server/methods — read-only control plane; no network, filesystem, LLM, or authority mutation
 */
import {
  ErrorCodeSchema,
  HINDSIGHT_CUTOVER_METHODS,
  HindsightCutoverStatusParamsSchema,
  HindsightCutoverStatusSchema,
  HindsightCutoverVerifyParamsSchema,
  HindsightCutoverVerifyResultSchema,
  type HindsightCutoverStatus,
  type HindsightCutoverVerifyResult,
} from "@taki/shared";
import type { HindsightCutoverRunRepo } from "../../db/hindsight-cutover-run-repo.ts";
import type { Logger } from "../../logging/logger.ts";
import { appException } from "../app-error.ts";
import type { MethodRegistry } from "../method-registry.ts";

export function registerHindsightCutoverMethods(registry: MethodRegistry, deps: { repo: HindsightCutoverRunRepo; logger: Logger }): void {
  registry.register({
    method: HINDSIGHT_CUTOVER_METHODS.status,
    roles: ["operator"],
    paramsSchema: HindsightCutoverStatusParamsSchema,
    handler: (params): HindsightCutoverStatus => guarded(deps, () => HindsightCutoverStatusSchema.parse(deps.repo.status(params.runId))),
  });
  registry.register({
    method: HINDSIGHT_CUTOVER_METHODS.verify,
    roles: ["operator"],
    paramsSchema: HindsightCutoverVerifyParamsSchema,
    handler: (params): HindsightCutoverVerifyResult => guarded(deps, () => HindsightCutoverVerifyResultSchema.parse(deps.repo.verify(params))),
  });
}

function guarded<T>(deps: { logger: Logger }, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof Error && error.message === "HINDSIGHT_CUTOVER_NOT_FOUND") {
      throw appException(ErrorCodeSchema.enum.HINDSIGHT_REFUSED, "Hindsight cutover run was not found", { reason: error.message });
    }
    if (error instanceof Error && error.name === "ZodError") throw error;
    deps.logger.child({ mod: "hindsight-cutover" }).error({ err: error instanceof Error ? error.name : "unknown" }, "Hindsight cutover status failed");
    throw appException(ErrorCodeSchema.enum.INTERNAL_ERROR, "Hindsight cutover status unavailable");
  }
}
