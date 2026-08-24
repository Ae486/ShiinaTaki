/**
 * INPUT: operator run.status request
 * OUTPUT: bounded Run/Attempt/Receipt status by runId; no Timeline or live subscription side effects
 * POS:    core/server/methods — thin read-only controller over the Core Run service
 */
import { RUN_METHODS, RunStatusParamsSchema, type RunStatusParams, type RunStatusResult } from "@taki/shared";
import type { RunService } from "../../harness/run-service.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function runStatusMethod(service: Pick<RunService, "status">): MethodDefinition<RunStatusParams> {
  return { method: RUN_METHODS.status, roles: ["operator"], paramsSchema: RunStatusParamsSchema, handler: ({ runId }): RunStatusResult => service.status(runId) };
}
