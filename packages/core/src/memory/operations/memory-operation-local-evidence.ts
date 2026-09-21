/**
 * INPUT:  local producer refs, B2 runner errors, run status and the pure Local binding snapshot
 * OUTPUT: producer-ref constructors, closed error classification and settlement builders shared by the two local kinds
 * POS:    core/memory/operations — evidence mapping only; never casts a migration error into a replica code
 */
import {
  MemoryLocalErrorCodeSchema, type MemoryLocalErrorCode, type MemoryLocalProgress, type MemoryLocalResult, type MemoryMigrationStatus,
  type MemoryOperationProducerRef, type MemoryOperationReason,
} from "@taki/shared";
import type { LocalOnboardingService } from "../local-onboarding/local-onboarding-service.ts";
import { localRuntimeAvailability } from "../local-onboarding/local-onboarding-reads.ts";
import type { MemoryOperationSettlement } from "./memory-operation-contract.ts";

export type LocalRef = Extract<MemoryOperationProducerRef, { kind: "local" }>;

export const RESERVED_PROGRESS: MemoryLocalProgress = { phase: "reserved", sourceCount: null, resolvedCount: null, blockingCount: null };

export function localRef(producer: MemoryOperationProducerRef | null): LocalRef {
  if (!producer || producer.kind !== "local") throw new Error("MEMORY_OPERATION_PRODUCER_MISMATCH");
  return producer;
}

export function reserveRef(input: { runId: string; previewId: string | null; snapshotId: string | null; activationTransactionId: string | null }): LocalRef {
  return { kind: "local", ...input, progress: RESERVED_PROGRESS };
}

export function withPhase(ref: LocalRef, phase: MemoryLocalProgress["phase"], status?: MemoryMigrationStatus): LocalRef {
  const counts = status
    ? { sourceCount: status.sourceCount, resolvedCount: status.resolvedCount, blockingCount: status.blockingCount }
    : { sourceCount: ref.progress.sourceCount, resolvedCount: ref.progress.resolvedCount, blockingCount: ref.progress.blockingCount };
  return { ...ref, progress: { phase, ...counts } };
}

/** Runner errors outside the Local wire union become MIGRATION_INTERNAL_ERROR; fence and lease codes keep their closest meaning. */
export function localErrorCode(error: unknown): MemoryLocalErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (message === "MEMORY_OPERATION_CANCELLED") return "MIGRATION_INTERRUPTED";
  if (message === "MEMORY_QUIESCENCE_TIMEOUT") return "MIGRATION_PRODUCER_RUNNING";
  if (message === "LEASE_LOST") return "MIGRATION_BUSY";
  if (message.startsWith("MEMORY_INTEGRITY_ERROR")) return "INTEGRITY_MISMATCH";
  const parsed = MemoryLocalErrorCodeSchema.safeParse(message);
  return parsed.success ? parsed.data : "MIGRATION_INTERNAL_ERROR";
}

export function failed(input: { code: MemoryLocalErrorCode; reason?: MemoryOperationReason; producer?: LocalRef; result?: MemoryLocalResult }): MemoryOperationSettlement {
  return { state: "failed", reason: input.reason ?? "producer_failed", errorCode: input.code, result: input.result ?? null,
    ...(input.producer ? { producer: input.producer } : {}) };
}

export function unknown(reason: "commitment_unknown" | "producer_incomplete", producer?: LocalRef): MemoryOperationSettlement {
  return { state: "outcome_unknown", reason, errorCode: null, result: null, ...(producer ? { producer } : {}) };
}

export function completed(result: MemoryLocalResult, producer: LocalRef): MemoryOperationSettlement {
  return { state: "completed", reason: null, errorCode: null, result, producer };
}

/** Not claiming is a positive fact: the row records the interruption and the operator retries after the next boot. */
export function interruptedBeforeClaim(ref: LocalRef): MemoryOperationSettlement {
  return failed({ code: "MIGRATION_INTERRUPTED", reason: "runtime_unavailable", producer: ref });
}

/** Preparation outcome from the run the producer left behind; readiness is the runner's verified proof, nothing inferred. */
export function preparedSettlement(local: LocalOnboardingService, ref: LocalRef, status: MemoryMigrationStatus): MemoryOperationSettlement {
  const run = local.run(ref.runId);
  if (!run) return unknown("producer_incomplete", ref);
  const ready = status.status === "ready";
  const producer = withPhase({ ...ref, snapshotId: run.snapshotId }, ready ? "ready" : "blocked", status);
  return completed({ kind: "local", runId: ref.runId, outcome: ready ? "ready" : "source_blocked", epochId: run.epochId, runtimeAvailable: false }, producer);
}

/** After a proven commit the only remaining question is the binding: published and matching, or unavailable. */
export function committedSettlement(local: LocalOnboardingService, ref: LocalRef, epochId: string): MemoryOperationSettlement {
  const runtime = localRuntimeAvailability(local.binding());
  const producer = withPhase({ ...ref, activationTransactionId: ref.activationTransactionId }, runtime.available ? "completed" : "binding");
  const result: MemoryLocalResult = { kind: "local", runId: ref.runId, outcome: runtime.available ? "activated" : "binding_unavailable", epochId, runtimeAvailable: runtime.available };
  if (runtime.available) return completed(result, producer);
  return failed({ code: "MEMORY_RUNTIME_UNAVAILABLE", reason: "runtime_unavailable", producer, result });
}
