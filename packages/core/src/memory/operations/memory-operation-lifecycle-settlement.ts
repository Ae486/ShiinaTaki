/**
 * INPUT:  the operation context, a lifecycle execution and closed lifecycle error codes
 * OUTPUT: requireLifecycle(), claimLifecycle() (macrotask-deferred tryClaim that never claims on a stopping service) and
 *         lifecycleFailure() (code -> reason: refusals producer_refused, interruption producer_incomplete, an unavailable
 *         runtime runtime_unavailable, the rest producer_failed) shared by bank.provision and connection.revalidate
 * POS:    core/memory/operations — evidence mapping only for the hindsight-lifecycle family; no producer work here
 */
import type { MemoryHindsightLifecycleErrorCode, MemoryOperationProducerRef, MemoryOperationReason, MemoryOperationResult } from "@taki/shared";
import type { HindsightLifecycleService } from "../hindsight-lifecycle/hindsight-lifecycle-service.ts";
import { MemoryOperationRefusal, type MemoryOperationContext, type MemoryOperationExecution, type MemoryOperationSettlement } from "./memory-operation-contract.ts";

const REFUSED: readonly MemoryHindsightLifecycleErrorCode[] = ["HINDSIGHT_TEMPLATE_CONFLICT", "HINDSIGHT_BANK_OCCUPIED",
  "HINDSIGHT_CONNECTION_DISABLED", "HINDSIGHT_STATE_CONFLICT", "HINDSIGHT_REPLICA_LINEAGE_MISMATCH", "MEMORY_AUTHORITY_MISMATCH"];

export function requireLifecycle(ctx: MemoryOperationContext): HindsightLifecycleService {
  if (!ctx.lifecycle) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  return ctx.lifecycle;
}

/** One macrotask lets the admitted row be read or cancelled first; a stopping service never claims, and a lost CAS never works. */
export async function claimLifecycle(execution: Pick<MemoryOperationExecution<never>, "tryClaim">, lifecycle: HindsightLifecycleService):
Promise<"claimed" | "lost" | "interrupted"> {
  await new Promise<void>((done) => setImmediate(done));
  if (lifecycle.stopRequested()) return "interrupted";
  return execution.tryClaim() ? "claimed" : "lost";
}

export function lifecycleFailure(code: MemoryHindsightLifecycleErrorCode, input: {
  producer: MemoryOperationProducerRef; result?: MemoryOperationResult | null; reason?: MemoryOperationReason;
}): MemoryOperationSettlement {
  return { state: "failed", reason: input.reason ?? lifecycleReason(code), errorCode: code, result: input.result ?? null, producer: input.producer };
}

export function lifecycleCompleted(result: MemoryOperationResult, producer: MemoryOperationProducerRef): MemoryOperationSettlement {
  return { state: "completed", reason: null, errorCode: null, result, producer };
}

export function lifecycleUnknown(producer: MemoryOperationProducerRef): MemoryOperationSettlement {
  return { state: "outcome_unknown", reason: "producer_incomplete", errorCode: null, result: null, producer };
}

export function lifecycleRefused(code: MemoryHindsightLifecycleErrorCode): boolean { return REFUSED.includes(code); }

function lifecycleReason(code: MemoryHindsightLifecycleErrorCode): MemoryOperationReason {
  if (REFUSED.includes(code)) return "producer_refused";
  if (code === "HINDSIGHT_LIFECYCLE_INTERRUPTED") return "producer_incomplete";
  return code === "MEMORY_RUNTIME_UNAVAILABLE" ? "runtime_unavailable" : "producer_failed";
}
