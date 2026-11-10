/**
 * INPUT:  sealed operation requests plus the live producers (B3 setup service, B5 scheduler, Hindsight runtime accessor)
 * OUTPUT: the handler contract every operation kind implements, the settlement/observation shapes and the closed refusal error
 * POS:    core/memory/operations — internal contract shared by the kind handlers and the service; no persistence here
 */
import type {
  MemoryOperation, MemoryOperationProducerRef, MemoryOperationReason, MemoryOperationRefusalReason,
  MemoryOperationRequest, MemoryOperationResult, MemoryReplicaBank, MemoryReplicaErrorCode, PendingMemorySummary,
  MemoryTidyOutcome, MemoryTidyProgress,
} from "@taki/shared";
import type { HindsightReplicaScheduler } from "../hindsight/hindsight-replica-scheduler.ts";
import type { HindsightSetupService } from "../hindsight/hindsight-setup-service.ts";

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
  tidy?: () => MemoryTidyRuntime | null;
  searchIndex?: () => MemorySearchIndexRuntime | null;
  setup: HindsightSetupService;
  now(): string;
}

export interface MemorySearchIndexRuntime {
  authorityEpochId: string | null;
  desiredStoplist(): boolean;
  rebuild(stoplist: boolean): Promise<{ indexed: number }>;
}

/** Selected producer only; the operation owner never executes the model or selects candidates itself. */
export interface MemoryTidyRuntime {
  authorityEpochId: string | null;
  runNow(characterId: string, options?: { onProgress?: (progress: MemoryTidyProgress) => void }): Promise<MemoryTidyOutcome>;
}

export interface MemoryOperationSettlement {
  state: "completed" | "failed";
  reason: MemoryOperationReason | null;
  errorCode: MemoryReplicaErrorCode | null;
  result: MemoryOperationResult | null;
  producer?: MemoryOperationProducerRef;
}
/** What a producer re-read says about a non-terminal row: it became claimed, it settled, or nothing changed. */
export type MemoryOperationObservation = { kind: "running" } | { kind: "settled"; settlement: MemoryOperationSettlement } | null;

export interface MemoryOperationExecution<R extends MemoryOperationRequest> {
  request: R;
  producer: MemoryOperationProducerRef;
  ctx: MemoryOperationContext;
  /** Marks the row running; a kind calls it once its producer has actually started work on its behalf. */
  running(): void;
  /** Required progress persistence; a refused update must abort the producer's surrounding mutation transaction. */
  updateProducer?(producer: MemoryOperationProducerRef): void;
}

export interface MemoryOperationKindHandler<R extends MemoryOperationRequest = MemoryOperationRequest> {
  family(request: R): string;
  /** Synchronous refusal point; throws MemoryOperationRefusal before any row exists. */
  admit(request: R, ctx: MemoryOperationContext): MemoryOperationProducerRef;
  /** Resolves null when the producer has not settled yet; observe() then classifies later reads. */
  execute(input: MemoryOperationExecution<R>): Promise<MemoryOperationSettlement | null>;
  observe?(operation: MemoryOperation, ctx: MemoryOperationContext): MemoryOperationObservation;
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
