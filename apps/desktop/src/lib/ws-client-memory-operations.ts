/**
 * INPUT:  the operator socket's JSON-RPC request function + call params from the Home operations page.
 * OUTPUT: memoryOperationMethods(request) — typed memory.authority.status / memory.operations.* wrappers, each result
 *         parsed through its @taki/shared schema; subscribe is memoized per client generation (like config.subscribe).
 * POS:    ui/lib — a sibling of ws-client-methods (kept separate so that file stays under the size baseline).
 */

import type { JSONRPCParams } from "json-rpc-2.0";
import {
  MEMORY_AUTHORITY_METHODS,
  MEMORY_OPERATION_METHODS,
  MemoryAuthorityStatusSchema,
  MemoryOperationCancelResultSchema,
  MemoryOperationListResultSchema,
  MemoryOperationStatusResultSchema,
  MemoryOperationSubmitResultSchema,
  MemoryOperationSubscribeResultSchema,
  type MemoryAuthorityStatus,
  type MemoryOperation,
  type MemoryOperationListParams,
  type MemoryOperationRequest,
} from "@taki/shared";

export interface MemoryOperationMethods {
  /** Reads the composite memory-authority status (authority, runtime, setup, per-Bank replica/Pending, operations). */
  memoryAuthorityStatus(): Promise<MemoryAuthorityStatus>;
  /** Submits one durable operation; a busy family rejects with MEMORY_OPERATION_REFUSED + activeOperationId. */
  memoryOperationSubmit(request: MemoryOperationRequest): Promise<MemoryOperation>;
  memoryOperationStatus(operationId: string): Promise<MemoryOperation>;
  memoryOperationList(params?: Partial<MemoryOperationListParams>): Promise<MemoryOperation[]>;
  /** Cancels an admitted-only operation; a claimed/running/settled one rejects with a closed reason. */
  memoryOperationCancel(operationId: string): Promise<MemoryOperation>;
  /** Subscribes this socket to memory.operations.changed pushes (exact-once per client generation). */
  subscribeMemoryOperations(): Promise<void>;
}

export function memoryOperationMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>): MemoryOperationMethods {
  let subscription: Promise<void> | null = null;
  return {
    memoryAuthorityStatus: async () => MemoryAuthorityStatusSchema.parse(await request(MEMORY_AUTHORITY_METHODS.status, {})),
    memoryOperationSubmit: async (submitted) =>
      MemoryOperationSubmitResultSchema.parse(await request(MEMORY_OPERATION_METHODS.submit, { request: submitted })).operation,
    memoryOperationStatus: async (operationId) =>
      MemoryOperationStatusResultSchema.parse(await request(MEMORY_OPERATION_METHODS.status, { operationId })).operation,
    memoryOperationList: async (params = {}) =>
      MemoryOperationListResultSchema.parse(await request(MEMORY_OPERATION_METHODS.list, params)).operations,
    memoryOperationCancel: async (operationId) =>
      MemoryOperationCancelResultSchema.parse(await request(MEMORY_OPERATION_METHODS.cancel, { operationId })).operation,
    subscribeMemoryOperations: () => {
      subscription ??= request<unknown>(MEMORY_OPERATION_METHODS.subscribe, {}).then((result) => {
        MemoryOperationSubscribeResultSchema.parse(result);
      });
      return subscription;
    },
  };
}
