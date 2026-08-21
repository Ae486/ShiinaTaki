/**
 * INPUT:  MethodRegistry plus the inactive Hindsight setup service and Logger
 * OUTPUT: operator-only memory.hindsight.status/validate/setup/disable/llm-health registrations
 * POS:    core/server/methods — thin sanitized control plane; no Agent tool or Host action reaches these methods
 */
import {
  ErrorCodeSchema,
  HINDSIGHT_METHODS,
  HindsightDisableParamsSchema,
  HindsightLlmHealthParamsSchema,
  HindsightLlmHealthResultSchema,
  HindsightSetupParamsSchema,
  HindsightSetupSnapshotSchema,
  HindsightStatusParamsSchema,
  HindsightValidateParamsSchema,
  type HindsightDisableParams,
  type HindsightLlmHealthParams,
  type HindsightSetupParams,
  type HindsightValidateParams,
} from "@taki/shared";
import type { Logger } from "../../logging/logger.ts";
import { HindsightError } from "../../memory/hindsight/hindsight-errors.ts";
import type { HindsightSetupService } from "../../memory/hindsight/hindsight-setup-service.ts";
import { appException } from "../app-error.ts";
import type { MethodRegistry } from "../method-registry.ts";

export function registerHindsightSetupMethods(registry: MethodRegistry, deps: { service: HindsightSetupService; logger: Logger }): void {
  registry.register({
    method: HINDSIGHT_METHODS.status, roles: ["operator"], paramsSchema: HindsightStatusParamsSchema,
    handler: () => guarded(deps, () => HindsightSetupSnapshotSchema.parse(deps.service.status())),
  });
  registry.register({
    method: HINDSIGHT_METHODS.validate, roles: ["operator"], paramsSchema: HindsightValidateParamsSchema,
    handler: (params: HindsightValidateParams) => guarded(deps, async () => HindsightSetupSnapshotSchema.parse(await deps.service.validate(params))),
  });
  registry.register({
    method: HINDSIGHT_METHODS.setup, roles: ["operator"], paramsSchema: HindsightSetupParamsSchema,
    handler: (params: HindsightSetupParams) => guarded(deps, async () => HindsightSetupSnapshotSchema.parse(await deps.service.setup(params))),
  });
  registry.register({
    method: HINDSIGHT_METHODS.disable, roles: ["operator"], paramsSchema: HindsightDisableParamsSchema,
    handler: (params: HindsightDisableParams) => guarded(deps, () => HindsightSetupSnapshotSchema.parse(deps.service.disable(params))),
  });
  registry.register({
    method: HINDSIGHT_METHODS.llmHealth, roles: ["operator"], paramsSchema: HindsightLlmHealthParamsSchema,
    handler: (params: HindsightLlmHealthParams) => guarded(deps, async () => HindsightLlmHealthResultSchema.parse(await deps.service.llmHealth(params))),
  });
}

function guarded<T>(deps: { logger: Logger }, operation: () => T): T {
  try {
    const result = operation();
    if (result instanceof Promise) return result.catch((error: unknown) => { throw sanitized(deps, error); }) as T;
    return result;
  } catch (error) {
    throw sanitized(deps, error);
  }
}

function sanitized(deps: { logger: Logger }, error: unknown): unknown {
  if (error instanceof HindsightError) {
    return appException(ErrorCodeSchema.enum.HINDSIGHT_REFUSED, "Hindsight setup request was refused", {
      reason: error.code, retryable: error.retryable, nextAction: error.nextAction,
    });
  }
  if (error instanceof Error && error.name === "ZodError") return error;
  deps.logger.child({ mod: "hindsight-setup" }).error({ err: error instanceof Error ? error.name : "unknown" }, "Hindsight setup method failed");
  return appException(ErrorCodeSchema.enum.INTERNAL_ERROR, "Hindsight setup operation failed");
}
