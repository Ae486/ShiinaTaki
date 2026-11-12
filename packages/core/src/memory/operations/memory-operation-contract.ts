/**
 * INPUT:  sealed operation requests plus the live producers (B3 setup service, B5 scheduler, Hindsight runtime accessor,
 *         Local onboarding service, Hindsight activation service, Hindsight lifecycle service, Hindsight backup service) and the
 *         owner's own row lookups
 * OUTPUT: the handler contract every operation kind implements (admission carries the Core-stamped origin), the
 *         settlement/observation shapes, the closed refusal error and the mutual single-flight guard for the setup /
 *         local-onboarding / hindsight-activation / hindsight-lifecycle / hindsight-backup / memory-transition families
 * POS:    core/memory/operations — internal contract shared by the kind handlers and the service; no persistence here
 */
import type {
  HindsightConnectionProjection, MemoryHindsightLifecycleOrigin, MemoryOperation, MemoryOperationErrorCode, MemoryOperationProducerRef,
  MemoryOperationReason, MemoryOperationRefusalReason, MemoryOperationRequest, MemoryOperationResult, MemoryReplicaBank, PendingMemorySummary,
  MemoryTidyOutcome, MemoryTidyProgress,
} from "@taki/shared";
import type { CanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import type { MemoryReplicaRequest } from "@taki/shared";
import type { HindsightActivationService } from "../hindsight-activation/hindsight-activation-service.ts";
import type { HindsightBackupService } from "../hindsight-backup/hindsight-backup-service.ts";
import type { HindsightCandidateService } from "../hindsight-candidates/hindsight-candidate-service.ts";
import type { HindsightLifecycleService } from "../hindsight-lifecycle/hindsight-lifecycle-service.ts";
import type { HindsightReplicaScheduler } from "../hindsight/hindsight-replica-scheduler.ts";
import type { HindsightConnectionDrift } from "../hindsight/hindsight-runtime-connection.ts";
import type { HindsightSetupService } from "../hindsight/hindsight-setup-service.ts";
import type { HindsightTemplateLifecycleService } from "../hindsight/template-lifecycle/template-lifecycle-service.ts";
import type { LocalOnboardingService } from "../local-onboarding/local-onboarding-service.ts";
import type { MemoryTransitionDriver, MemoryTransitionOperationStorage } from "./memory-operation-transition-storage.ts";
import type { TransitionEvidenceContext } from "../transitions/transition-evidence-context.ts";
import type { MemoryAuthorityVerification } from "../runtime-authority-verification.ts";

/** The narrow live view of the selected Hindsight subsystem; null when the authority runtime is not Hindsight. */
export interface MemoryOperationsRuntime {
  epochId: string;
  /** The fingerprint and deployment mode the published runtime was constructed with (drift is measured against them). */
  configFingerprint: string;
  deploymentMode: HindsightConnectionProjection["deploymentMode"];
  scheduler: Pick<HindsightReplicaScheduler, "started" | "start" | "stop" | "requestManual" | "cancelManual" | "tick" | "status" | "lastError"
    | "verifiedReconnect" | "request" | "configure">;
  /** The subsystem's native-writer fence; only backup capture quiesces it, and always releases it. */
  writeFence: Pick<CanonicalLocalWriteFence, "quiesce" | "release">;
  banks(): MemoryReplicaBank[];
  assertConnection(): void;
  verifySelectedAuthority?: MemoryAuthorityVerification["verifySelectedAuthority"];
  /** Throws on a stopped runtime or an epoch/lineage mismatch; otherwise names a changed or disabled connection. */
  driftReason(): HindsightConnectionDrift;
  pendingSummary(bankId: string): PendingMemorySummary;
}

export interface MemoryOperationContext {
  live(): MemoryOperationsRuntime | null;
  tidy?: () => MemoryTidyRuntime | null;
  searchIndex?: () => MemorySearchIndexRuntime | null;
  setup: HindsightSetupService;
  /** Absent when Core composes without a Local onboarding producer; the local kinds then refuse at admission. */
  local?: LocalOnboardingService;
  /** Absent when Core composes without a Hindsight activation producer; the activation kind then refuses at admission. */
  hindsight?: HindsightActivationService;
  /** Absent when Core composes without a Hindsight lifecycle producer; the lifecycle kinds then refuse at admission. */
  lifecycle?: HindsightLifecycleService;
  /** Absent when Core composes without a Hindsight backup producer; the backup kinds then refuse at admission. */
  backup?: HindsightBackupService;
  templates?: HindsightTemplateLifecycleService;
  /** Absent until trusted archive admission and a candidate Host driver are composed. */
  candidates?: HindsightCandidateService;
  /** Local committed receipt classification remains available without a fresh candidate driver. */
  candidateOutcome?: HindsightCandidateService["observeBoot"];
  transition?: MemoryTransitionDriver;
  transitionStorage?: MemoryTransitionOperationStorage;
  /** Fresh independent scope for one synchronous admission transaction; absent from execution and observation. */
  admissionVerification?: TransitionEvidenceContext;
  replicaRequest?(requestId: string): MemoryReplicaRequest | undefined;
  /** The owner's own durable rows, so a kind can resolve a prior command (retry) without trusting the client. */
  lookup(operationId: string): MemoryOperation | undefined;
  activeInFamily(family: string): MemoryOperation | undefined;
  latestInFamily(family: string): MemoryOperation | undefined;
  now(): string;
}

/** Setup, Local onboarding, Hindsight activation, lifecycle and backup are mutually single-flight (grill G6); the open row wins and is named. */
export const EXCLUSIVE_MEMORY_FAMILIES = ["setup", "local-onboarding", "hindsight-activation", "hindsight-lifecycle", "hindsight-backup", "memory-transition", "hindsight-template", "hindsight-candidate"] as const;
export function refuseWhileExclusiveFamilyBusy(ctx: Pick<MemoryOperationContext, "activeInFamily">): void {
  for (const family of EXCLUSIVE_MEMORY_FAMILIES) {
    const active = ctx.activeInFamily(family);
    if (active) throw new MemoryOperationRefusal("MEMORY_OPERATION_BUSY", active.operationId);
  }
}

export interface MemoryOperationSettlement {
  state: "waiting" | "completed" | "failed" | "cancelled" | "outcome_unknown";
  reason: MemoryOperationReason | null;
  errorCode: MemoryOperationErrorCode | null;
  result: MemoryOperationResult | null;
  producer?: MemoryOperationProducerRef;
}

export interface MemorySearchIndexRuntime {
  authorityEpochId: string | null;
  desiredStoplist(): boolean;
  rebuild(stoplist: boolean): Promise<{ indexed: number }>;
}

/** The selected runtime owns candidate/model work; the operation owner persists only its actual progress/outcome. */
export interface MemoryTidyRuntime {
  authorityEpochId: string | null;
  runNow(characterId: string, options?: { onProgress?: (progress: MemoryTidyProgress) => void }): Promise<MemoryTidyOutcome>;
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
  /** Tidy/index producers publish updated checkpoints through the same durable row CAS. */
  updateProducer(producer: MemoryOperationProducerRef): void;
}

/** Who asked: WS submissions are always the operator; only Core's automatic lifecycle triggers pass "automatic". */
export interface MemoryOperationAdmission { origin: MemoryHindsightLifecycleOrigin }

export interface MemoryOperationKindHandler<R extends MemoryOperationRequest = MemoryOperationRequest> {
  family(request: R): string;
  /** Stable request replay returns its original row and never dispatches a second effect. */
  existing?(request: R, ctx: MemoryOperationContext): MemoryOperation | undefined;
  /** Runs inside the same transaction as insertAdmitted, before any acknowledgement or dispatch. */
  persistAdmission?(operation: MemoryOperation, ctx: MemoryOperationContext): void;
  /** Synchronous refusal point; throws MemoryOperationRefusal before any row exists. */
  admit(request: R, ctx: MemoryOperationContext, admission: MemoryOperationAdmission): MemoryOperationProducerRef;
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
