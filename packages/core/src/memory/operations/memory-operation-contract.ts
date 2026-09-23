/**
 * INPUT:  sealed operation requests plus the live producers (B3 setup service, B5 scheduler, Hindsight runtime accessor,
 *         Local onboarding service, Hindsight activation service) and the owner's own row lookups
 * OUTPUT: the handler contract every operation kind implements, the settlement/observation shapes, the closed refusal error
 *         and the mutual single-flight guard for the setup / local-onboarding / hindsight-activation families
 * POS:    core/memory/operations — internal contract shared by the kind handlers and the service; no persistence here
 */
import type {
  MemoryOperation, MemoryOperationErrorCode, MemoryOperationProducerRef, MemoryOperationReason, MemoryOperationRefusalReason,
  MemoryOperationRequest, MemoryOperationResult, MemoryReplicaBank, PendingMemorySummary,
} from "@taki/shared";
import type { HindsightActivationService } from "../hindsight-activation/hindsight-activation-service.ts";
import type { HindsightReplicaScheduler } from "../hindsight/hindsight-replica-scheduler.ts";
import type { HindsightSetupService } from "../hindsight/hindsight-setup-service.ts";
import type { LocalOnboardingService } from "../local-onboarding/local-onboarding-service.ts";

/** The narrow live view of the selected Hindsight subsystem; null when the authority runtime is not Hindsight. */
export interface MemoryOperationsRuntime {
  epochId: string;
  scheduler: Pick<HindsightReplicaScheduler, "started" | "requestManual" | "cancelManual" | "tick" | "status" | "lastError">;
  banks(): MemoryReplicaBank[];
  assertConnection(): void;
  pendingSummary(bankId: string): PendingMemorySummary;
}

export interface MemoryOperationContext {
  live(): MemoryOperationsRuntime | null;
  setup: HindsightSetupService;
  /** Absent when Core composes without a Local onboarding producer; the local kinds then refuse at admission. */
  local?: LocalOnboardingService;
  /** Absent when Core composes without a Hindsight activation producer; the activation kind then refuses at admission. */
  hindsight?: HindsightActivationService;
  /** The owner's own durable rows, so a kind can resolve a prior command (retry) without trusting the client. */
  lookup(operationId: string): MemoryOperation | undefined;
  activeInFamily(family: string): MemoryOperation | undefined;
  latestInFamily(family: string): MemoryOperation | undefined;
  now(): string;
}

/** Setup, Local onboarding and Hindsight activation are mutually single-flight (grill G6); the open row wins and is named. */
export const EXCLUSIVE_MEMORY_FAMILIES = ["setup", "local-onboarding", "hindsight-activation"] as const;
export function refuseWhileExclusiveFamilyBusy(ctx: Pick<MemoryOperationContext, "activeInFamily">): void {
  for (const family of EXCLUSIVE_MEMORY_FAMILIES) {
    const active = ctx.activeInFamily(family);
    if (active) throw new MemoryOperationRefusal("MEMORY_OPERATION_BUSY", active.operationId);
  }
}

export interface MemoryOperationSettlement {
  state: "completed" | "failed" | "outcome_unknown";
  reason: MemoryOperationReason | null;
  errorCode: MemoryOperationErrorCode | null;
  result: MemoryOperationResult | null;
  producer?: MemoryOperationProducerRef;
}
/** What a producer re-read says about a non-terminal row: it became claimed, it settled, or nothing changed. */
export type MemoryOperationObservation = { kind: "running" } | { kind: "settled"; settlement: MemoryOperationSettlement } | null;

export interface MemoryOperationExecution<R extends MemoryOperationRequest> {
  operationId: string;
  request: R;
  producer: MemoryOperationProducerRef;
  ctx: MemoryOperationContext;
  /** Marks the row running; a kind calls it once its producer has actually started work on its behalf. */
  running(): void;
  /** CAS admitted -> running; false means the row was cancelled (or otherwise left admitted) and no producer work may start. */
  tryClaim(): boolean;
  /** Persists a producer checkpoint on the running row and publishes it; a lost race is not an error. */
  checkpoint(producer: MemoryOperationProducerRef): void;
}

export interface MemoryOperationKindHandler<R extends MemoryOperationRequest = MemoryOperationRequest> {
  family(request: R): string;
  /** Synchronous refusal point; throws MemoryOperationRefusal before any row exists. */
  admit(request: R, ctx: MemoryOperationContext): MemoryOperationProducerRef;
  /** Resolves null when the producer has not settled yet; observe() then classifies later reads. */
  execute(input: MemoryOperationExecution<R>): Promise<MemoryOperationSettlement | null>;
  observe?(operation: MemoryOperation, ctx: MemoryOperationContext): MemoryOperationObservation;
  /** Read-only restart classification of a row another boot left open; null defers to the generic core_restart fallback. */
  observeBoot?(operation: MemoryOperation, ctx: MemoryOperationContext): MemoryOperationSettlement | null;
  /** Throws MemoryOperationRefusal(MEMORY_OPERATION_RUNNING) once the producer has claimed the work. */
  cancel?(operation: MemoryOperation, ctx: MemoryOperationContext): void;
}

export class MemoryOperationRefusal extends Error {
  readonly reason: MemoryOperationRefusalReason;
  readonly activeOperationId: string | null;
  constructor(reason: MemoryOperationRefusalReason, activeOperationId: string | null = null) {
    super(reason);
    this.name = "MemoryOperationRefusal";
    this.reason = reason;
    this.activeOperationId = activeOperationId;
  }
}
