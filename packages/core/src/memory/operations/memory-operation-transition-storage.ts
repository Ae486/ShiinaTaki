/**
 * INPUT:  existing operation owner transaction, confirmed identity and transition receipt tables
 * OUTPUT: admission persistence, request lookup and read-only factual terminal observation
 * POS:    core/memory/operations — storage adapter consumed by healthy W5 and separately owned emergency producers
 */
import { randomUUID } from "node:crypto";
import type { MemoryOperation, MemoryTransitionIdentity, MemoryTransitionIntent, MemoryTransitionRequest } from "@taki/shared";
import { MemoryTransitionRequestSchema } from "@taki/shared";
import { readTransitionDriverFailure } from "../../db/memory-transition-driver-failure.ts";
import { admitTransition, DEFAULT_TRANSITION_QUEUE_POLICY, readTransitionAttempt, readTransitionByRequest, readTransitionIntent } from "../../db/memory-transition-repo.ts";
import { readTransitionReceipt, readTransitionResult } from "../../db/memory-transition-evidence-repo.ts";
import { admitTransitionRecovery, findTransitionRecovery, readTransitionRecovery, readTransitionResolution } from "../../db/memory-transition-recovery-repo.ts";
import { canonicalJson } from "../legacy-migration/legacy-identities.ts";
import type { Database } from "../../db/sqlite.ts";
import type { MemoryOperationExecution, MemoryOperationSettlement } from "./memory-operation-contract.ts";
import type { TransitionEvidenceContext } from "../transitions/transition-evidence-context.ts";

export interface MemoryTransitionPlan { current: MemoryTransitionIdentity; actorId: string; queuePolicy?: MemoryTransitionIntent["queuePolicy"] }
/** Admission requires the direction-specific producer's current confirmed preview and source proof. */
export interface MemoryTransitionDriver {
  plan(request: MemoryTransitionRequest, verification?: TransitionEvidenceContext): MemoryTransitionPlan;
  execute(input: MemoryOperationExecution<MemoryTransitionRequest>): Promise<MemoryOperationSettlement | null>;
  /** Synchronous dispatch withdrawal after successful emergency admission; no network wait. */
  emergencyAdmitted?(epochId: string): void;
}

export function createTransitionOperationStorage(db: Database) {
  return {
    find: (request: MemoryTransitionRequest) => {
      const prior = readTransitionByRequest(db, request.requestId) ?? findTransitionRecovery(db, request.requestId);
      if (prior && canonicalJson(prior.request) !== canonicalJson(MemoryTransitionRequestSchema.parse(request))) throw new Error("MEMORY_TRANSITION_CONFLICT");
      return prior;
    },
    persist: (operation: MemoryOperation, plan: MemoryTransitionPlan) => {
      if (operation.producer?.kind !== "transition") throw new Error("MEMORY_TRANSITION_CONFLICT");
      const request = MemoryTransitionRequestSchema.parse(operation.request);
      if (request.recovery) return admitTransitionRecovery(db, { version: 1, operationId: operation.operationId,
        transitionId: request.recovery.transitionId, request, actorId: plan.actorId, admittedAt: operation.createdAt });
      return admitTransition(db, { current: plan.current, intent: { version: 1, transitionId: operation.producer.transitionId,
        operationId: operation.operationId, request, actorId: plan.actorId, admittedAt: operation.createdAt,
        queuePolicy: plan.queuePolicy ?? DEFAULT_TRANSITION_QUEUE_POLICY, incidentId: request.kind === "transition.emergency-local" ? randomUUID() : null } });
    },
    observe: (operation: MemoryOperation, boot = false): MemoryOperationSettlement | null => observe(db, operation, boot),
    canCancel: (operation: MemoryOperation) => {
      if (operation.producer?.kind !== "transition") return false;
      const attempt = readTransitionAttempt(db, operation.producer.transitionId);
      // Cancelling an unclaimed recovery cancels only this new operation; original fence obligations survive.
      if (readTransitionRecovery(db, operation.operationId)) return attempt?.operationId !== operation.operationId;
      return !attempt && !readTransitionReceipt(db, operation.producer.transitionId);
    },
  };
}
export type MemoryTransitionOperationStorage = ReturnType<typeof createTransitionOperationStorage>;

function observe(db: Database, operation: MemoryOperation, boot: boolean): MemoryOperationSettlement | null {
  if (operation.producer?.kind !== "transition") return null;
  const intent = readTransitionIntent(db, operation.producer.transitionId);
  const recovery = readTransitionRecovery(db, operation.operationId);
  if (!intent || (recovery ? recovery.transitionId !== intent.transitionId || recovery.request.requestId !== operation.producer.requestId
    : intent.operationId !== operation.operationId || intent.request.requestId !== operation.producer.requestId)) return null;
  const result = readTransitionResolution(db, operation.operationId)?.result ?? readTransitionDriverFailure(db, operation.operationId)
    ?? (recovery ? undefined : readTransitionResult(db, intent.transitionId));
  const receipt = readTransitionReceipt(db, intent.transitionId);
  if (result) {
    if (result.receiptId !== (receipt?.receiptId ?? null)) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    return { state: result.outcome, reason: result.outcome === "completed" ? null : result.outcome === "cancelled" ? "cancelled_before_claim"
      : result.outcome === "outcome_unknown" ? "commitment_unknown" : "producer_failed", errorCode: result.errorCode, result };
  }
  if (receipt && boot) return { state: "outcome_unknown", reason: "runtime_unavailable", errorCode: "MEMORY_TRANSITION_OUTCOME_UNKNOWN",
    result: { kind: "transition", transitionId: intent.transitionId, receiptId: receipt.receiptId, authorityCommitted: true,
      runtime: "unavailable", queue: "unsettled", outcome: "outcome_unknown", errorCode: "MEMORY_TRANSITION_OUTCOME_UNKNOWN" } };
  return null;
}
