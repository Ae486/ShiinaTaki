/**
 * INPUT:  hindsight producer refs, activation service errors, the promotion receipt and the pure binding availability
 * OUTPUT: producer-ref constructors (Core-minted identities), closed error classification and settlement builders for the
 *         hindsight.activate kind
 * POS:    core/memory/operations — evidence mapping only; a commit is proven by the receipt, never inferred from an exception
 */
import { randomUUID } from "node:crypto";
import type {
  MemoryHindsightActivationErrorCode, MemoryHindsightBlocking, MemoryHindsightPhase, MemoryHindsightResult, MemoryOperationProducerRef,
  MemoryOperationReason,
} from "@taki/shared";
import type { HindsightActivationIdentity } from "../hindsight-activation/hindsight-activation-chain.ts";
import type { HindsightActivationPlan } from "../hindsight-activation/hindsight-activation-reads.ts";
import type { HindsightActivationService } from "../hindsight-activation/hindsight-activation-service.ts";
import type { MemoryOperationSettlement } from "./memory-operation-contract.ts";

export type HindsightRef = Extract<MemoryOperationProducerRef, { kind: "hindsight" }>;
type BankIds = Pick<HindsightRef["banks"][number], "replicaEpochId" | "verificationId">;

export function hindsightRef(producer: MemoryOperationProducerRef | null): HindsightRef {
  if (!producer || producer.kind !== "hindsight") throw new Error("MEMORY_OPERATION_PRODUCER_MISMATCH");
  return producer;
}

/**
 * Fresh identities unless a prior attempt of the same run already minted them: resume must replay, never re-mint, per-Bank ids.
 * A Bank's verificationId is the base; the chain derives each preparation's native id from it (preparationVerificationId).
 */
export function mintRef(plan: HindsightActivationPlan & { runId: string; configFingerprint: string }, prior: HindsightRef | null): HindsightRef {
  const known = new Map<string, BankIds>(prior?.banks.map((bank) => [bank.nativeBankId, { replicaEpochId: bank.replicaEpochId, verificationId: bank.verificationId }]) ?? []);
  // A Bank without a verified B3 row has no proven native identity yet; execution reports it as blocking instead of guessing one.
  const banks = plan.banks.flatMap((bank) => bank.nativeBankId === null || !bank.verified ? [] : [{
    nativeBankId: bank.nativeBankId, scope: bank.scope, preparationId: null,
    ...(known.get(bank.nativeBankId) ?? { replicaEpochId: randomUUID(), verificationId: randomUUID() }) }]);
  return { kind: "hindsight", runId: plan.runId, hindsightEpochId: prior?.hindsightEpochId ?? randomUUID(), transactionId: prior?.transactionId ?? randomUUID(),
    configFingerprint: plan.configFingerprint, manifestId: null, banks,
    progress: { phase: "reserved", bankCount: banks.length, preparedBankCount: 0, importedBankCount: 0, verifiedBankCount: 0, carriedWitnessCount: 0 } };
}

export function withPhase(ref: HindsightRef, phase: MemoryHindsightPhase): HindsightRef {
  return { ...ref, progress: { ...ref.progress, phase } };
}

export function identityOf(ref: HindsightRef, scope: { operationId: string; predecessorEpochId: string }): HindsightActivationIdentity {
  return { operationId: scope.operationId, runId: ref.runId, predecessorEpochId: scope.predecessorEpochId, hindsightEpochId: ref.hindsightEpochId,
    transactionId: ref.transactionId, banks: ref.banks.map(({ nativeBankId, scope: bankScope, replicaEpochId, verificationId }) => ({ nativeBankId, scope: bankScope, replicaEpochId, verificationId })) };
}

export function failed(input: { code: MemoryHindsightActivationErrorCode; reason?: MemoryOperationReason; producer?: HindsightRef; result?: MemoryHindsightResult }): MemoryOperationSettlement {
  return { state: "failed", reason: input.reason ?? "producer_failed", errorCode: input.code, result: input.result ?? null,
    ...(input.producer ? { producer: input.producer } : {}) };
}

export function unknown(reason: "commitment_unknown" | "producer_incomplete", producer?: HindsightRef): MemoryOperationSettlement {
  return { state: "outcome_unknown", reason, errorCode: null, result: null, ...(producer ? { producer } : {}) };
}

export function completed(result: MemoryHindsightResult, producer: HindsightRef): MemoryOperationSettlement {
  return { state: "completed", reason: null, errorCode: null, result, producer };
}

/** Not claiming is a positive fact: the row records the interruption and the operator resumes after the next boot. */
export function interruptedBeforeClaim(ref: HindsightRef): MemoryOperationSettlement {
  return failed({ code: "HINDSIGHT_ACTIVATION_INTERRUPTED", reason: "runtime_unavailable", producer: ref });
}

/** Missing verified Bank scopes are reported as a completed, blocked activation: nothing native happened and Local is untouched. */
export function blockedSettlement(ref: HindsightRef, blocking: MemoryHindsightBlocking[]): MemoryOperationSettlement {
  return completed({ kind: "hindsight", runId: ref.runId, outcome: "prerequisite_blocked", epochId: null, runtimeAvailable: false, blocking }, ref);
}

/** A matching runtime proves installation; only the producer's completed checkpoint proves activation preparation finished. */
export function committedSettlement(service: Pick<HindsightActivationService, "runtime">, ref: HindsightRef, epochId: string): MemoryOperationSettlement {
  const runtime = service.runtime();
  if (runtime.available && ref.progress.phase !== "completed") return unknown("producer_incomplete", withPhase(ref, "binding"));
  const producer = withPhase(ref, runtime.available ? "completed" : "binding");
  const result: MemoryHindsightResult = { kind: "hindsight", runId: ref.runId, outcome: runtime.available ? "activated" : "binding_unavailable",
    epochId, runtimeAvailable: runtime.available, blocking: [] };
  if (runtime.available) return completed(result, producer);
  return failed({ code: "MEMORY_RUNTIME_UNAVAILABLE", reason: "runtime_unavailable", producer, result });
}
