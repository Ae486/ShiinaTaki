/**
 * INPUT:  MethodRegistry, the composite Hindsight activation status read and a Logger
 * OUTPUT: the operator-only memory.activation.status registration; invalidation rides the existing memory.operations.changed push
 * POS:    core/server/methods — thin sanitized read plane; no second subscription and no command surface (commands go through memory.operations.submit)
 */
import { ErrorCodeSchema, MEMORY_ACTIVATION_METHODS, MemoryActivationStatusParamsSchema, MemoryActivationStatusSchema, type MemoryActivationStatus } from "@taki/shared";
import type { Logger } from "../../logging/logger.ts";
import { appException } from "../app-error.ts";
import type { MethodRegistry } from "../method-registry.ts";

export function registerMemoryActivationMethods(registry: MethodRegistry, deps: { status(): MemoryActivationStatus; logger: Logger }): void {
  registry.register({
    method: MEMORY_ACTIVATION_METHODS.status, roles: ["operator"], paramsSchema: MemoryActivationStatusParamsSchema,
    handler: () => {
      try {
        return MemoryActivationStatusSchema.parse(deps.status());
      } catch (error) {
        deps.logger.child({ mod: "memory-activation" }).error({ err: error instanceof Error ? error.name : "unknown" }, "memory activation status read failed");
        throw appException(ErrorCodeSchema.enum.INTERNAL_ERROR, "memory activation status is unavailable");
      }
    },
  });
}
