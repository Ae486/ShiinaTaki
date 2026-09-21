/**
 * INPUT:  the per-kind handler modules (setup validate/apply, replica sync, local prepare/activate)
 * OUTPUT: MEMORY_OPERATION_KINDS — the closed kind registry the service dispatches through
 * POS:    core/memory/operations — one handler module per kind; later stages add a row here, never a branch in the service
 */
import type { MemoryOperationKind, MemoryOperationRequest } from "@taki/shared";
import type { MemoryOperationKindHandler } from "./memory-operation-contract.ts";
import { localActivateKind, localPrepareKind } from "./memory-operation-kind-local.ts";
import { replicaSyncKind } from "./memory-operation-kind-replica.ts";
import { setupApplyKind, setupValidateKind } from "./memory-operation-kind-setup.ts";

export type MemoryOperationKindRegistry = {
  [K in MemoryOperationKind]: MemoryOperationKindHandler<Extract<MemoryOperationRequest, { kind: K }>>;
};

export const MEMORY_OPERATION_KINDS: MemoryOperationKindRegistry = {
  "setup.validate": setupValidateKind,
  "setup.apply": setupApplyKind,
  "replica.sync": replicaSyncKind,
  "local.onboard.prepare": localPrepareKind,
  "local.onboard.activate": localActivateKind,
};

/** Erases the per-kind request narrowing at the dispatch boundary; the service only ever passes a request of the matching kind. */
export function memoryOperationHandler(registry: MemoryOperationKindRegistry, kind: MemoryOperationKind): MemoryOperationKindHandler {
  return registry[kind] as unknown as MemoryOperationKindHandler;
}
