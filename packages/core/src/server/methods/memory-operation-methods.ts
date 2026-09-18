/**
 * INPUT:  MethodRegistry, the memory operation service, its subscription registry and a Logger
 * OUTPUT: operator-only memory.operations.submit/status/list/cancel/subscribe registrations + memory.operations.changed pushes
 * POS:    core/server/methods — thin sanitized control plane; refusals ride MEMORY_OPERATION_REFUSED with a closed reason
 */
import {
  ErrorCodeSchema, MEMORY_OPERATION_METHODS, MemoryOperationCancelParamsSchema, MemoryOperationCancelResultSchema,
  MemoryOperationListParamsSchema, MemoryOperationListResultSchema, MemoryOperationStatusParamsSchema,
  MemoryOperationStatusResultSchema, MemoryOperationSubmitParamsSchema, MemoryOperationSubmitResultSchema,
  MemoryOperationSubscribeParamsSchema, MemoryOperationSubscribeResultSchema, MemoryOperationChangedSchema,
  type MemoryOperationCancelParams, type MemoryOperationListParams, type MemoryOperationStatusParams,
  type MemoryOperationSubmitParams,
} from "@taki/shared";
import type { Logger } from "../../logging/logger.ts";
import { MemoryOperationRefusal } from "../../memory/operations/memory-operation-contract.ts";
import type { MemoryOperationService } from "../../memory/operations/memory-operation-service.ts";
import { appException } from "../app-error.ts";
import type { MemoryOperationSubscriptions } from "../memory-operation-subscriptions.ts";
import type { MethodContext, MethodRegistry } from "../method-registry.ts";

interface Deps { service: MemoryOperationService; subscriptions: MemoryOperationSubscriptions; logger: Logger }

export function registerMemoryOperationMethods(registry: MethodRegistry, deps: Deps): void {
  registry.register({
    method: MEMORY_OPERATION_METHODS.submit, roles: ["operator"], paramsSchema: MemoryOperationSubmitParamsSchema,
    handler: (params: MemoryOperationSubmitParams) => guarded(deps, () => MemoryOperationSubmitResultSchema.parse({ operation: deps.service.submit(params.request) })),
  });
  registry.register({
    method: MEMORY_OPERATION_METHODS.status, roles: ["operator"], paramsSchema: MemoryOperationStatusParamsSchema,
    handler: (params: MemoryOperationStatusParams) => guarded(deps, () => MemoryOperationStatusResultSchema.parse({ operation: deps.service.status(params.operationId) })),
  });
  registry.register({
    method: MEMORY_OPERATION_METHODS.list, roles: ["operator"], paramsSchema: MemoryOperationListParamsSchema,
    handler: (params: MemoryOperationListParams) => guarded(deps, () => MemoryOperationListResultSchema.parse({ operations: deps.service.list(params) })),
  });
  registry.register({
    method: MEMORY_OPERATION_METHODS.cancel, roles: ["operator"], paramsSchema: MemoryOperationCancelParamsSchema,
    handler: (params: MemoryOperationCancelParams) => guarded(deps, () => MemoryOperationCancelResultSchema.parse({ operation: deps.service.cancel(params.operationId) })),
  });
  registry.register({
    method: MEMORY_OPERATION_METHODS.subscribe, roles: ["operator"], paramsSchema: MemoryOperationSubscribeParamsSchema,
    handler: (_params, ctx: MethodContext) => {
      deps.subscriptions.subscribe(ctx.connection, (operation) => ctx.notify(MEMORY_OPERATION_METHODS.changed, MemoryOperationChangedSchema.parse({ operation })));
      // Connection-scoped: a replacement socket must subscribe again; no explicit unsubscribe this stage.
      ctx.onClose(() => deps.subscriptions.unsubscribe(ctx.connection));
      return MemoryOperationSubscribeResultSchema.parse({ status: "ok" });
    },
  });
}

function guarded<T>(deps: Deps, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof MemoryOperationRefusal) {
      throw appException(ErrorCodeSchema.enum.MEMORY_OPERATION_REFUSED, "memory operation request was refused", {
        reason: error.reason, ...(error.activeOperationId ? { activeOperationId: error.activeOperationId } : {}),
      });
    }
    if (error instanceof Error && error.name === "ZodError") throw error;
    deps.logger.child({ mod: "memory-operations" }).error({ err: error instanceof Error ? error.name : "unknown" }, "memory operation method failed");
    throw appException(ErrorCodeSchema.enum.INTERNAL_ERROR, "memory operation request failed");
  }
}
