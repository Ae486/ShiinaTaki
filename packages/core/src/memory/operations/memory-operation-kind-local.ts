/**
 * INPUT:  local.onboard.prepare / local.onboard.activate requests, the Local onboarding service and the owner's row lookup
 * OUTPUT: the two local kind handlers — cheap synchronous admission, deferred claim, producer checkpoints, evidence-based
 *         settlement, pre-claim cancel and read-only boot observation
 * POS:    core/memory/operations — one family (local-onboarding); activation on a committed run repairs the binding only
 */
import { randomUUID } from "node:crypto";
import type { MemoryMigrationStatus, MemoryOperation, MemoryOperationRequest } from "@taki/shared";
import type { MigrationReceipt } from "../legacy-migration/legacy-migration-reads.ts";
import type { LocalOnboardingService } from "../local-onboarding/local-onboarding-service.ts";
import { LOCAL_ONBOARDING_FAMILY } from "../local-onboarding/local-onboarding-status.ts";
import {
  MemoryOperationRefusal, type MemoryOperationContext, type MemoryOperationExecution, type MemoryOperationKindHandler,
  type MemoryOperationSettlement,
} from "./memory-operation-contract.ts";
import {
  committedSettlement, completed, failed, interruptedBeforeClaim, localErrorCode, localRef, preparedSettlement, reserveRef, unknown, withPhase,
  type LocalRef,
} from "./memory-operation-local-evidence.ts";

type PrepareRequest = Extract<MemoryOperationRequest, { kind: "local.onboard.prepare" }>;
type ActivateRequest = Extract<MemoryOperationRequest, { kind: "local.onboard.activate" }>;
type Claim = "claimed" | "lost" | "interrupted";

export const localPrepareKind: MemoryOperationKindHandler<PrepareRequest> = {
  family: () => LOCAL_ONBOARDING_FAMILY,
  admit: (request, ctx) => {
    const local = requireLocal(ctx);
    if (local.authority().mode !== "legacy-markdown") throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
    return admitPrepare(request, ctx, local);
  },
  execute: async (execution) => {
    const local = requireLocal(execution.ctx);
    const ref = localRef(execution.producer);
    const claimed = await claim(execution, local);
    if (claimed !== "claimed") return claimed === "lost" ? null : interruptedBeforeClaim(ref);
    execution.checkpoint(withPhase(ref, "snapshot"));
    try {
      const status = await runPreparation(local, execution, ref);
      return preparedSettlement(local, ref, status);
    } catch (error) {
      return prepareFailure(local, ref, error);
    }
  },
  observeBoot: (operation, ctx) => ctx.local ? observePrepare(ctx.local, localRef(operation.producer)) : null,
  cancel: refuseAfterClaim,
};

export const localActivateKind: MemoryOperationKindHandler<ActivateRequest> = {
  family: () => LOCAL_ONBOARDING_FAMILY,
  admit: (request, ctx) => admitActivate(request, requireLocal(ctx)),
  execute: async (execution) => {
    const local = requireLocal(execution.ctx);
    const ref = localRef(execution.producer);
    const claimed = await claim(execution, local);
    if (claimed !== "claimed") return claimed === "lost" ? null : interruptedBeforeClaim(ref);
    const receipt = local.receipt(ref.runId);
    if (receipt) return repairBinding(local, ref, { receipt, checkpoint: execution.checkpoint });
    execution.checkpoint(withPhase(ref, "activating"));
    try {
      const activation = await local.activate({ runId: ref.runId, transactionId: ref.activationTransactionId ?? "" });
      return committedSettlement(local, ref, activation.epochId ?? "");
    } catch (error) {
      return activateFailure(local, ref, error);
    }
  },
  observeBoot: (operation, ctx) => ctx.local ? observeActivate(ctx.local, localRef(operation.producer)) : null,
  cancel: refuseAfterClaim,
};

function requireLocal(ctx: MemoryOperationContext): LocalOnboardingService {
  if (!ctx.local) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  return ctx.local;
}

function refuseAfterClaim(operation: MemoryOperation): void {
  if (operation.state !== "admitted") throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING");
}

/** One macrotask lets the admitted row be read or cancelled first; a stopping service never claims, and a lost CAS never works. */
async function claim(execution: Pick<MemoryOperationExecution<MemoryOperationRequest>, "tryClaim">, local: LocalOnboardingService): Promise<Claim> {
  await new Promise<void>((done) => setImmediate(done));
  if (local.stopRequested()) return "interrupted";
  return execution.tryClaim() ? "claimed" : "lost";
}

function admitPrepare(request: PrepareRequest, ctx: MemoryOperationContext, local: LocalOnboardingService): LocalRef {
  const { source } = request;
  if (source.mode === "new") {
    if (source.replaceRunId !== undefined && local.run(source.replaceRunId) === null) throw new MemoryOperationRefusal("MEMORY_OPERATION_NOT_FOUND");
    return reserveRef({ runId: randomUUID(), previewId: source.previewId, snapshotId: null, activationTransactionId: null });
  }
  if (source.mode === "resume") {
    const run = local.run(source.runId);
    if (!run || run.supersededByRunId !== null) throw new MemoryOperationRefusal("MEMORY_OPERATION_NOT_FOUND");
    return reserveRef({ runId: run.runId, previewId: null, snapshotId: run.snapshotId, activationTransactionId: null });
  }
  // Retry resolves the reserved run and accepted preview from the prior command row, never from the client.
  const prior = ctx.lookup(source.operationId);
  if (!prior || prior.kind !== "local.onboard.prepare" || prior.producer?.kind !== "local" || prior.producer.previewId === null) {
    throw new MemoryOperationRefusal("MEMORY_OPERATION_NOT_FOUND");
  }
  if (prior.terminalAt === null) throw new MemoryOperationRefusal("MEMORY_OPERATION_BUSY", prior.operationId);
  return reserveRef({ runId: prior.producer.runId, previewId: prior.producer.previewId, snapshotId: prior.producer.snapshotId, activationTransactionId: null });
}

function runPreparation(local: LocalOnboardingService, execution: MemoryOperationExecution<PrepareRequest>, ref: LocalRef): Promise<MemoryMigrationStatus> {
  const { source } = execution.request;
  const onProgress = (status: MemoryMigrationStatus) => execution.checkpoint(withPhase(ref, "converting", status));
  // A retry whose reserved run was already published finishes that same run; only an unpublished reservation materializes it.
  if (source.mode === "resume" || ref.previewId === null || local.run(ref.runId) !== null) return local.resumePreparation({ runId: ref.runId, onProgress });
  return local.prepare({ runId: ref.runId, previewId: ref.previewId, ...(source.mode === "new" && source.replaceRunId ? { replaceRunId: source.replaceRunId } : {}), onProgress });
}

function prepareFailure(local: LocalOnboardingService, ref: LocalRef, error: unknown): MemoryOperationSettlement {
  const code = localErrorCode(error);
  let producer = ref;
  try {
    const run = local.run(ref.runId);
    if (run) producer = { ...ref, snapshotId: run.snapshotId, progress: run.progress };
  } catch {
    return unknown("producer_incomplete", ref);
  }
  if (code === "MIGRATION_INTERNAL_ERROR") return unknown("producer_incomplete", producer);
  return failed({ code, reason: code === "MIGRATION_INTERRUPTED" ? "producer_incomplete" : "producer_failed", producer });
}

function observePrepare(local: LocalOnboardingService, ref: LocalRef): MemoryOperationSettlement {
  const run = local.run(ref.runId);
  if (!run) return unknown("producer_incomplete", ref);
  const producer: LocalRef = { ...ref, snapshotId: run.snapshotId, progress: run.progress };
  if (run.status !== "ready" && run.status !== "completed") return unknown("producer_incomplete", producer);
  return completed({ kind: "local", runId: ref.runId, outcome: "ready", epochId: run.epochId, runtimeAvailable: false }, producer);
}

function admitActivate(request: ActivateRequest, local: LocalOnboardingService): LocalRef {
  const run = local.run(request.runId);
  if (!run || run.supersededByRunId !== null) throw new MemoryOperationRefusal("MEMORY_OPERATION_NOT_FOUND");
  const authority = local.authority();
  const reserve = (activationTransactionId: string) => reserveRef({ runId: run.runId, previewId: null, snapshotId: run.snapshotId, activationTransactionId });
  if (authority.mode === "legacy-markdown") return reserve(randomUUID());
  // Under a committed Local authority only the exact committed run may be re-submitted, and only to repair its binding.
  if (authority.mode !== "canonical-local" || !run.receipt || run.receipt.epochId !== authority.epochId) throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED");
  return reserve(run.receipt.transactionId);
}

function repairBinding(local: LocalOnboardingService, ref: LocalRef, input: { receipt: MigrationReceipt; checkpoint: (producer: LocalRef) => void }): MemoryOperationSettlement {
  const { receipt } = input;
  if (receipt.transactionId !== ref.activationTransactionId) return unknown("commitment_unknown", ref);
  input.checkpoint(withPhase(ref, "binding"));
  try { local.repairBinding(receipt.epochId); }
  catch (error) { return repairFailure(local, ref, { epochId: receipt.epochId, error }); }
  return committedSettlement(local, ref, receipt.epochId);
}

/** The commit is proven; a thrown repair (custody refusal, failed construction) is this command's own failure, never a completion. */
function repairFailure(local: LocalOnboardingService, ref: LocalRef, input: { epochId: string; error: unknown }): MemoryOperationSettlement {
  const settlement = committedSettlement(local, ref, input.epochId);
  return { ...settlement, state: "failed", reason: settlement.reason ?? "producer_failed", errorCode: localErrorCode(input.error) };
}

/** Classification after a thrown activation: the receipt, not the exception, decides whether the authority switched. */
function activateFailure(local: LocalOnboardingService, ref: LocalRef, error: unknown): MemoryOperationSettlement {
  let receipt: MigrationReceipt | null;
  let legacy: boolean;
  try {
    receipt = local.receipt(ref.runId);
    legacy = local.authority().mode === "legacy-markdown";
  } catch {
    return unknown("commitment_unknown", ref);
  }
  if (receipt) return receipt.transactionId === ref.activationTransactionId ? committedSettlement(local, ref, receipt.epochId) : unknown("commitment_unknown", ref);
  if (!legacy) return unknown("commitment_unknown", ref);
  const code = localErrorCode(error);
  return failed({ code, reason: code === "MIGRATION_INTERRUPTED" ? "producer_incomplete" : "producer_failed", producer: ref });
}

function observeActivate(local: LocalOnboardingService, ref: LocalRef): MemoryOperationSettlement {
  const receipt = local.receipt(ref.runId);
  if (receipt) return receipt.transactionId === ref.activationTransactionId ? committedSettlement(local, ref, receipt.epochId) : unknown("commitment_unknown", ref);
  if (local.authority().mode === "legacy-markdown") return failed({ code: "MIGRATION_INTERRUPTED", reason: "producer_incomplete", producer: ref });
  return unknown("commitment_unknown", ref);
}
