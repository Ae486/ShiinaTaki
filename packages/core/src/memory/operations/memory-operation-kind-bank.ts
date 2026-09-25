/**
 * INPUT:  bank.provision requests, the Hindsight lifecycle service and the published runtime view
 * OUTPUT: the bank.provision kind handler — synchronous side-effect-free admission (Core-stamped origin, runtime without drift,
 *         verified Global row, Bank not already ready), deferred claim, phase checkpoints, settlement from the producer
 *         outcome (ready -> completed; syncing / setup failure -> failed with the closed code), pre-claim cancel, read-only
 *         boot observation from the B3 row and replica binding
 * POS:    core/memory/operations — family hindsight-lifecycle (exclusive with setup / local-onboarding / hindsight-activation)
 */
import type { MemoryBankProducerRef, MemoryBankResult, MemoryOperationProducerRef, MemoryOperationRequest } from "@taki/shared";
import { hindsightLifecycleErrorCode } from "../hindsight-lifecycle/hindsight-lifecycle-context.ts";
import type { HindsightBankFacts } from "../hindsight-lifecycle/hindsight-lifecycle-reads.ts";
import { HINDSIGHT_LIFECYCLE_FAMILY, type HindsightLifecycleService } from "../hindsight-lifecycle/hindsight-lifecycle-service.ts";
import {
  MemoryOperationRefusal, refuseWhileExclusiveFamilyBusy, type MemoryOperationContext, type MemoryOperationExecution, type MemoryOperationKindHandler,
  type MemoryOperationSettlement, type MemoryOperationsRuntime,
} from "./memory-operation-contract.ts";
import {
  claimLifecycle, lifecycleCompleted, lifecycleFailure, lifecycleRefused, lifecycleUnknown, requireLifecycle,
} from "./memory-operation-lifecycle-settlement.ts";

type ProvisionRequest = Extract<MemoryOperationRequest, { kind: "bank.provision" }>;

export const bankProvisionKind: MemoryOperationKindHandler<ProvisionRequest> = {
  family: () => HINDSIGHT_LIFECYCLE_FAMILY,
  admit: (request, ctx, admission) => {
    const lifecycle = requireLifecycle(ctx);
    refuseWhileExclusiveFamilyBusy(ctx);
    const runtime = cleanRuntime(ctx);
    const facts = admissibleFacts(lifecycle, { epochId: runtime.epochId, characterId: request.characterId });
    return { kind: "bank", origin: admission.origin, characterId: request.characterId, nativeBankId: facts.nativeBankId,
      templateRevision: facts.globalRevision, admittedEpochId: runtime.epochId, configFingerprint: runtime.configFingerprint, phase: "reserved" };
  },
  execute: async (execution) => {
    const lifecycle = requireLifecycle(execution.ctx);
    const ref = bankRef(execution.producer);
    const claimed = await claimLifecycle(execution, lifecycle);
    if (claimed === "lost") return null;
    if (claimed === "interrupted") return lifecycleFailure("HINDSIGHT_LIFECYCLE_INTERRUPTED", { producer: ref, reason: "runtime_unavailable" });
    return provision(lifecycle, execution, ref);
  },
  observeBoot: (operation, ctx) => ctx.lifecycle ? observeBoot(ctx.lifecycle, bankRef(operation.producer)) : null,
  cancel: (operation) => { if (operation.state !== "admitted") throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING"); },
};

function bankRef(producer: MemoryOperationProducerRef | null): MemoryBankProducerRef {
  if (!producer || producer.kind !== "bank") throw new Error("MEMORY_OPERATION_PRODUCER_MISMATCH");
  return producer;
}

/** A published runtime that still matches the live connection and the marker; anything else is a revalidation first. */
function cleanRuntime(ctx: MemoryOperationContext): MemoryOperationsRuntime {
  const runtime = ctx.live();
  if (!runtime) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  let clean: boolean;
  try { clean = runtime.driftReason() === "none"; }
  catch { clean = false; }
  if (!clean) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  return runtime;
}

function admissibleFacts(lifecycle: HindsightLifecycleService, input: { epochId: string; characterId: string }): HindsightBankFacts & { globalRevision: string } {
  let facts: HindsightBankFacts;
  try { facts = lifecycle.bankFacts(input); }
  catch { throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED"); }
  const { globalRevision } = facts;
  if (globalRevision === null || (facts.row?.status === "verified" && facts.bound)) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  return { ...facts, globalRevision };
}

async function provision(lifecycle: HindsightLifecycleService, execution: MemoryOperationExecution<ProvisionRequest>, ref: MemoryBankProducerRef):
Promise<MemoryOperationSettlement> {
  let latest = ref;
  const checkpoint = (phase: MemoryBankProducerRef["phase"]) => { latest = { ...latest, phase }; execution.checkpoint(latest); };
  try {
    const outcome = await lifecycle.provision(ref, checkpoint);
    if (outcome.readiness === "ready") return lifecycleCompleted(result(ref, "ready"), { ...latest, phase: "completed" });
    return lifecycleFailure(outcome.errorCode, { producer: latest, result: result(ref, "syncing") });
  } catch (error) {
    const code = hindsightLifecycleErrorCode(error);
    return lifecycleFailure(code, { producer: latest, result: lifecycleRefused(code) || code === "HINDSIGHT_LIFECYCLE_INTERRUPTED" ? null : result(ref, "failed") });
  }
}

function observeBoot(lifecycle: HindsightLifecycleService, ref: MemoryBankProducerRef): MemoryOperationSettlement {
  let facts: HindsightBankFacts;
  try { facts = lifecycle.bankFacts({ epochId: ref.admittedEpochId, characterId: ref.characterId }); }
  catch { return lifecycleUnknown(ref); }
  if (facts.row?.status === "verified" && facts.bound) return lifecycleCompleted(result(ref, "ready"), { ...ref, phase: "completed" });
  return lifecycleUnknown(ref);
}

function result(ref: MemoryBankProducerRef, readiness: MemoryBankResult["readiness"]): MemoryBankResult {
  return { kind: "bank", characterId: ref.characterId, nativeBankId: ref.nativeBankId, readiness };
}
