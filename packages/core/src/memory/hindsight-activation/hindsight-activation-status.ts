/**
 * INPUT:  the Hindsight activation service reads (plan, run, runtime availability) and the operation owner's newest
 *         hindsight-activation row
 * OUTPUT: readHindsightActivationStatus() — one strict MemoryActivationStatus with server-derived available actions
 * POS:    core/memory/hindsight-activation — read-only projection; missing/unknown state is explicit and no action is inferred from hope
 */
import { MemoryActivationStatusSchema, type MemoryActivationActions, type MemoryActivationRun, type MemoryActivationStatus, type MemoryOperation } from "@taki/shared";
import type { MemoryOperationService } from "../operations/memory-operation-service.ts";
import type { HindsightActivationPlan } from "./hindsight-activation-reads.ts";
import type { HindsightActivationService } from "./hindsight-activation-service.ts";

export const HINDSIGHT_ACTIVATION_FAMILY = "hindsight-activation";

export interface HindsightActivationStatusInput {
  service: Pick<HindsightActivationService, "plan" | "status" | "runtime">;
  operations: Pick<MemoryOperationService, "latest">;
  now?: () => string;
}

export function readHindsightActivationStatus(input: HindsightActivationStatusInput): MemoryActivationStatus {
  const plan = input.service.plan();
  const read = input.service.status({ runId: plan.runId, predecessorEpochId: plan.predecessorEpochId,
    hindsightEpochId: plan.authority.mode === "hindsight" ? plan.authority.epochId : null });
  const runtime = input.service.runtime();
  const operation = input.operations.latest(HINDSIGHT_ACTIVATION_FAMILY) ?? null;
  return MemoryActivationStatusSchema.parse({
    authority: { mode: plan.authority.mode, epochId: plan.authority.epochId },
    runtime,
    setup: { phase: plan.setupPhase, revision: plan.setupRevision, configured: plan.setupPhase === "configured" },
    prerequisites: { banks: plan.banks.map(({ scope, characterId, sourceBankId, nativeBankId, verified }) => ({ scope, characterId, localBankId: sourceBankId, nativeBankId, verified })),
      blocking: plan.blocking },
    run: read.run, custody: read.custody, operation,
    actions: deriveActions({ plan, run: read.run, operation, available: runtime.available }),
    observedAt: (input.now ?? (() => new Date().toISOString()))(),
  });
}

/** Actions follow the admission rules of the activation kind; a live family operation disables every command until it settles. */
function deriveActions(view: { plan: HindsightActivationPlan; run: MemoryActivationRun | null; operation: MemoryOperation | null; available: boolean }): MemoryActivationActions {
  const { plan, run, operation } = view;
  const idle = operation === null || operation.terminalAt !== null;
  const local = plan.authority.mode === "canonical-local" && plan.runId !== null;
  const ready = plan.configured && !plan.drifted && plan.blocking.length === 0;
  const receipt = run?.receipt;
  const committed = plan.authority.mode === "hindsight" && receipt != null
    && receipt.epochId === plan.authority.epochId && receipt.transactionId === plan.authority.transactionId;
  const producer = operation?.producer;
  const preparationIncomplete = committed && operation?.kind === "hindsight.activate" && producer?.kind === "hindsight"
    && producer.runId === run?.runId
    && producer.hindsightEpochId === receipt?.epochId && producer.transactionId === receipt.transactionId
    && producer.progress.phase !== "completed";
  return {
    activate: idle && local && ready && run === null,
    resume: idle && local && ready && run !== null && run.receipt === null,
    recoverBinding: idle && committed && (!view.available || preparationIncomplete),
    cancelOperationId: operation?.state === "admitted" ? operation.operationId : null,
  };
}
