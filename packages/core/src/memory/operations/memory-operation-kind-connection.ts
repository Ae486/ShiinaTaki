/**
 * INPUT:  connection.revalidate requests, the Hindsight lifecycle service (marker, live connection, runtime view, evidence)
 * OUTPUT: the connection.revalidate kind handler — synchronous side-effect-free admission on the exact selected epoch with
 *         the before/after fingerprints and the Core-stamped origin, deferred claim, phase checkpoints, settlement from the
 *         producer outcome (unchanged / rebound -> completed; binding_unavailable -> failed runtime_unavailable), pre-claim
 *         cancel, read-only boot observation from the reviewed fingerprint, admission evidence and published runtime
 * POS:    core/memory/operations — family hindsight-lifecycle (exclusive with setup / local-onboarding / hindsight-activation)
 */
import type { MemoryConnectionProducerRef, MemoryConnectionResult, MemoryOperationProducerRef, MemoryOperationRequest } from "@taki/shared";
import { hindsightLifecycleErrorCode } from "../hindsight-lifecycle/hindsight-lifecycle-context.ts";
import { HINDSIGHT_LIFECYCLE_FAMILY, type HindsightLifecycleService } from "../hindsight-lifecycle/hindsight-lifecycle-service.ts";
import type { MemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import {
  MemoryOperationRefusal, refuseWhileExclusiveFamilyBusy, type MemoryOperationExecution, type MemoryOperationKindHandler, type MemoryOperationSettlement,
} from "./memory-operation-contract.ts";
import { claimLifecycle, lifecycleCompleted, lifecycleFailure, lifecycleUnknown, requireLifecycle } from "./memory-operation-lifecycle-settlement.ts";

type RevalidateRequest = Extract<MemoryOperationRequest, { kind: "connection.revalidate" }>;

export const connectionRevalidateKind: MemoryOperationKindHandler<RevalidateRequest> = {
  family: () => HINDSIGHT_LIFECYCLE_FAMILY,
  admit: (request, ctx, admission) => {
    const lifecycle = requireLifecycle(ctx);
    refuseWhileExclusiveFamilyBusy(ctx);
    let selection: MemoryAuthoritySelection;
    try { selection = lifecycle.authority(); }
    catch { throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED"); }
    if (selection.mode !== "hindsight" || selection.epochId !== request.expectedEpochId) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    const runtime = lifecycle.runtime();
    // A disabled connection is admitted and refused by the producer, so the row names HINDSIGHT_CONNECTION_DISABLED.
    return { kind: "connection", origin: admission.origin, epochId: request.expectedEpochId,
      fingerprintBefore: runtime?.epochId === request.expectedEpochId ? runtime.configFingerprint : null,
      fingerprintAfter: lifecycle.live().fingerprint, phase: "reserved" };
  },
  execute: async (execution) => {
    const lifecycle = requireLifecycle(execution.ctx);
    const ref = connectionRef(execution.producer);
    const claimed = await claimLifecycle(execution, lifecycle);
    if (claimed === "lost") return null;
    if (claimed === "interrupted") return lifecycleFailure("HINDSIGHT_LIFECYCLE_INTERRUPTED", { producer: ref, reason: "runtime_unavailable" });
    return revalidate(lifecycle, execution, ref);
  },
  observeBoot: (operation, ctx) => ctx.lifecycle ? observeBoot(ctx.lifecycle, connectionRef(operation.producer)) : null,
  cancel: (operation) => { if (operation.state !== "admitted") throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING"); },
};

function connectionRef(producer: MemoryOperationProducerRef | null): MemoryConnectionProducerRef {
  if (!producer || producer.kind !== "connection") throw new Error("MEMORY_OPERATION_PRODUCER_MISMATCH");
  return producer;
}

async function revalidate(lifecycle: HindsightLifecycleService, execution: MemoryOperationExecution<RevalidateRequest>, ref: MemoryConnectionProducerRef):
Promise<MemoryOperationSettlement> {
  let latest = ref;
  const checkpoint = (phase: MemoryConnectionProducerRef["phase"]) => { latest = { ...latest, phase }; execution.checkpoint(latest); };
  try {
    const outcome = await lifecycle.revalidate(ref, checkpoint);
    const result: MemoryConnectionResult = { kind: "connection", outcome: outcome.outcome, fingerprint: outcome.fingerprint };
    if (outcome.outcome !== "binding_unavailable") return lifecycleCompleted(result, { ...latest, phase: "completed" });
    return lifecycleFailure(outcome.errorCode, { producer: latest, result, reason: "runtime_unavailable" });
  } catch (error) {
    return lifecycleFailure(hindsightLifecycleErrorCode(error), { producer: latest });
  }
}

/** Only the recorded fingerprint, its admission evidence and a runtime published on it prove the revalidation finished. */
function observeBoot(lifecycle: HindsightLifecycleService, ref: MemoryConnectionProducerRef): MemoryOperationSettlement {
  const after = ref.fingerprintAfter;
  if (after === null || !lifecycle.revalidated({ epochId: ref.epochId, fingerprint: after })) return lifecycleUnknown(ref);
  const runtime = lifecycle.runtime();
  if (runtime?.epochId !== ref.epochId || runtime.configFingerprint !== after) return lifecycleUnknown(ref);
  const result: MemoryConnectionResult = { kind: "connection", outcome: ref.fingerprintBefore === after ? "unchanged" : "rebound", fingerprint: after };
  return lifecycleCompleted(result, { ...ref, phase: "completed" });
}
