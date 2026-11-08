/**
 * INPUT:  complete per-Bank schedule edits, current runtime accessor and active transition lookup
 * OUTPUT: immediate persisted configuration through the live scheduler with replica.sync admission guards
 * POS:    core/memory/operations — configuration adapter; never starts a scheduler or submits an operation
 */
import type { MemoryReplicaConfigureParams, MemoryReplicaSyncStatus } from "@taki/shared";
import { MemoryOperationRefusal, type MemoryOperationContext } from "./memory-operation-contract.ts";

export function configureMemoryReplica(ctx: Pick<MemoryOperationContext, "live" | "activeInFamily">,
  params: MemoryReplicaConfigureParams): MemoryReplicaSyncStatus {
  const transition = ctx.activeInFamily("memory-transition");
  if (transition) throw new MemoryOperationRefusal("MEMORY_OPERATION_BUSY", transition.operationId);
  const runtime = ctx.live();
  if (!runtime || !runtime.scheduler.started()) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  let known: boolean;
  try { known = runtime.banks().some((bank) => bank.bankId === params.bankId); }
  catch { throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED"); }
  if (!known) throw new MemoryOperationRefusal("MEMORY_OPERATION_BANK_UNKNOWN");
  return runtime.scheduler.configure(params.bankId, params.config);
}
