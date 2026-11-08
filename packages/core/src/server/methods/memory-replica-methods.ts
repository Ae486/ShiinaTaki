/**
 * INPUT:  strict complete Bank configuration, current runtime/admission context, subscriptions and logger
 * OUTPUT: operator-only memory.replica.configure with persisted status and thin configuration invalidation
 * POS:    core/server/methods — immediate control-plane adapter; observation shares memory.operations.subscribe
 */
import {
  ErrorCodeSchema, MEMORY_REPLICA_METHODS, MemoryReplicaConfigureParamsSchema, MemoryReplicaConfigureResultSchema,
  type MemoryReplicaChanged, type MemoryReplicaConfigureParams,
} from "@taki/shared";
import type { Logger } from "../../logging/logger.ts";
import { MemoryOperationRefusal, type MemoryOperationContext } from "../../memory/operations/memory-operation-contract.ts";
import { configureMemoryReplica } from "../../memory/operations/memory-replica-configuration.ts";
import { appException } from "../app-error.ts";
import type { ConnectionSubscriptions } from "../memory-operation-subscriptions.ts";
import type { MethodRegistry } from "../method-registry.ts";

export function registerMemoryReplicaMethods(registry: MethodRegistry, deps: {
  context: Pick<MemoryOperationContext, "live" | "activeInFamily">;
  subscriptions: ConnectionSubscriptions<MemoryReplicaChanged>;
  logger: Logger;
}): void {
  registry.register({
    method: MEMORY_REPLICA_METHODS.configure, roles: ["operator"], paramsSchema: MemoryReplicaConfigureParamsSchema,
    handler: (params: MemoryReplicaConfigureParams) => {
      try {
        const result = MemoryReplicaConfigureResultSchema.parse({ status: configureMemoryReplica(deps.context, params) });
        deps.subscriptions.publish({ bankId: params.bankId });
        return result;
      } catch (error) {
        if (error instanceof MemoryOperationRefusal) {
          throw appException(ErrorCodeSchema.enum.MEMORY_OPERATION_REFUSED, "memory replica configuration was refused", {
            reason: error.reason, ...(error.activeOperationId ? { activeOperationId: error.activeOperationId } : {}),
          });
        }
        deps.logger.child({ mod: "memory-replica" }).error({ err: error instanceof Error ? error.name : "unknown" }, "replica configuration failed");
        throw appException(ErrorCodeSchema.enum.INTERNAL_ERROR, "memory replica configuration failed");
      }
    },
  });
}
