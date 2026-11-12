/**
 * INPUT:  the operator socket's JSON-RPC request function + call params from the Home operations page.
 * OUTPUT: memoryOperationMethods(request) — typed authority/activation reads, immediate replica configure and memory.operations.*
 *         wrappers, each result parsed through its @taki/shared schema; subscribe is memoized per client generation.
 * POS:    ui/lib — a sibling of ws-client-methods (kept separate so that file stays under the size baseline).
 */

import type { JSONRPCParams } from "json-rpc-2.0";
import {
  MEMORY_ACTIVATION_METHODS,
  MEMORY_AUTHORITY_METHODS,
  MEMORY_OPERATION_METHODS,
  MEMORY_REPLICA_METHODS, MemoryReplicaConfigureResultSchema,
  type MemoryReplicaScheduleConfig, type MemoryReplicaSyncStatus,
  MEMORY_TRANSITION_METHODS,
  MemoryTransitionPreviewSchema, MemoryTransitionReadSchema, MemoryTransitionOverviewSchema,
  type MemoryTransitionPreview, type MemoryTransitionRead, type MemoryTransitionOverview,
  MemoryActivationStatusSchema,
  MemoryAuthorityStatusSchema,
  MemoryOperationCancelResultSchema,
  MemoryOperationListResultSchema,
  MemoryOperationStatusResultSchema,
  MemoryOperationSubmitResultSchema,
  MemoryOperationSubscribeResultSchema,
  type MemoryActivationStatus,
  type MemoryAuthorityStatus,
  type MemoryOperation,
  type MemoryOperationListParams,
  type MemoryOperationRequest,
} from "@taki/shared";

export interface MemoryOperationMethods {
  memoryReplicaConfigure(bankId: string, config: MemoryReplicaScheduleConfig): Promise<MemoryReplicaSyncStatus>;
  memoryTransitionPreview(params: { kind: MemoryTransitionPreview["kind"]; recoveryTransitionId?: string }): Promise<MemoryTransitionPreview>;
  memoryTransitionStatus(transitionId: string): Promise<MemoryTransitionRead>;
  memoryTransitionOverview(): Promise<MemoryTransitionOverview>;
  /** Reads the composite memory-authority status (authority, runtime, setup, per-Bank replica/Pending, operations). */
  memoryAuthorityStatus(): Promise<MemoryAuthorityStatus>;
  /** Reads the Hindsight activation status (setup, Bank prerequisites, run, custody, Core-derived actions); invalidated by memory.operations.changed. */
  memoryActivationStatus(): Promise<MemoryActivationStatus>;
  /** Submits one durable operation; a busy family rejects with MEMORY_OPERATION_REFUSED + activeOperationId. */
  memoryOperationSubmit(request: MemoryOperationRequest): Promise<MemoryOperation>;
  memoryOperationStatus(operationId: string): Promise<MemoryOperation>;
  memoryOperationList(params?: Partial<MemoryOperationListParams>): Promise<MemoryOperation[]>;
  /** Cancels an admitted-only operation; a claimed/running/settled one rejects with a closed reason. */
  memoryOperationCancel(operationId: string): Promise<MemoryOperation>;
  /** Shares accepted membership per socket; failed setup can be retried by explicit caller demand. */
  subscribeMemoryOperations(): Promise<void>;
}

export function memoryOperationMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>): MemoryOperationMethods {
  let subscription: Promise<void> | null = null;
  return {
    memoryReplicaConfigure: async (bankId, config) => MemoryReplicaConfigureResultSchema.parse(await request(MEMORY_REPLICA_METHODS.configure, { bankId, config })).status,
    memoryTransitionPreview: async (params) => MemoryTransitionPreviewSchema.parse(await request(MEMORY_TRANSITION_METHODS.preview, params)),
    memoryTransitionStatus: async (transitionId) => MemoryTransitionReadSchema.parse(await request(MEMORY_TRANSITION_METHODS.status, { transitionId })),
    memoryTransitionOverview: async () => MemoryTransitionOverviewSchema.parse(await request(MEMORY_TRANSITION_METHODS.overview, {})),
    memoryAuthorityStatus: async () => MemoryAuthorityStatusSchema.parse(await request(MEMORY_AUTHORITY_METHODS.status, {})),
    memoryActivationStatus: async () => MemoryActivationStatusSchema.parse(await request(MEMORY_ACTIVATION_METHODS.status, {})),
    memoryOperationSubmit: async (submitted) =>
      MemoryOperationSubmitResultSchema.parse(await request(MEMORY_OPERATION_METHODS.submit, { request: submitted })).operation,
    memoryOperationStatus: async (operationId) =>
      MemoryOperationStatusResultSchema.parse(await request(MEMORY_OPERATION_METHODS.status, { operationId })).operation,
    memoryOperationList: async (params = {}) =>
      MemoryOperationListResultSchema.parse(await request(MEMORY_OPERATION_METHODS.list, params)).operations,
    memoryOperationCancel: async (operationId) =>
      MemoryOperationCancelResultSchema.parse(await request(MEMORY_OPERATION_METHODS.cancel, { operationId })).operation,
    subscribeMemoryOperations: () => {
      if (subscription) return subscription;
      const attempt = request<unknown>(MEMORY_OPERATION_METHODS.subscribe, {}).then((result) => {
        MemoryOperationSubscribeResultSchema.parse(result);
      }).catch((cause: unknown) => {
        // A lost/invalid acknowledgement is not accepted membership. Retry only on another demand,
        // retaining concurrent sharing and the current generation's native request deadline cleanup.
        if (subscription === attempt) subscription = null;
        throw cause;
      });
      subscription = attempt;
      return attempt;
    },
  };
}
