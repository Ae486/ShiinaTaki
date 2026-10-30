/**
 * INPUT:  validated Trigger Requests, provider-neutral snapshot capture, and lifecycle callbacks
 * OUTPUT: Core-owned admission/transition/status plus process-local Run execution and presentation context
 * POS:    core/harness — lifecycle owner above SQLite repositories and below every trigger/chat adapter
 */
import { randomUUID } from "node:crypto";
import type { ToolSet } from "ai";
import {
  TriggerRequestSchema,
  MemoryErrorEnvelopeSchema,
  type RunOutcome,
  type RunSnapshot,
  type RunMemoryReference,
  type RunStatusResult,
  type TriggerRequest,
  type QueueListParams, type QueueListResult,
  type InitiativeSelectedContext,
  type PreparedPublicationRunInput,
  type SubagentWorkScope,
  SubagentWorkTokenSchema,
} from "@taki/shared";
import type { RunAdmissionInput, RunAdmissionResult, RunRepo } from "../db/run-repo.ts";
import type { AutomaticMemoryRecall } from "../memory/automatic-memory-recall.ts";
import { sameMemoryCapabilities } from "../memory/memory-capability-snapshot.ts";
import { ACCEPTED_WORK_PROVIDER, RunWorkHoldSchema, RunWorkTransitionSchema,
  type RunWorkHold, type RunWorkTransition, type RunWorkResult } from "@taki/shared";
import { validateWorkAdmission, workBindingRefusal, type AcceptedWorkBinding } from "./run-work-binding.ts";
import { admitPreparedPublication, type PreparedPublicationAdmission } from "./run-prepared-publication.ts";
import type { ToolDisclosureSnapshot } from "../extensions/tool-disclosure-snapshot.ts";
import type { RunLinkedAdmission } from "../db/run-linked-state.ts";

type SnapshotDraft = Omit<RunSnapshot, "snapshotId" | "runId" | "capturedAt" | "manifestDigest">;

export interface CapturedRunSnapshot {
  snapshot: SnapshotDraft;
  context?: RunExecutionContext;
}

export interface RunExecutionContext {
  /** Trusted linked identity; both roles use initiator=subagent but have different Memory authority. */
  readonly workScope?: SubagentWorkScope;
  readonly toolDisclosure?: ToolDisclosureSnapshot;
  /** Trusted adapter binding, never reconstructed from a model-provided provenance string. */
  readonly acceptedWork?: AcceptedWorkBinding;
  readonly authorityCurrent?: () => boolean;
  readonly selectedContext?: InitiativeSelectedContext;
  readonly tools?: ToolSet;
  readonly toolDisplayNames?: Readonly<Record<string, string>>;
  readonly memoryTools?: ToolSet;
  readonly memorySnapshot?: RunMemoryReference;
  readonly automaticMemoryRecall?: AutomaticMemoryRecall;
  readonly memoryPrompt?: string;
  readonly assembleMemory?: (currentMessage: string) => string;
  readonly instructions?: string;
  dispose?(): void;
}

export interface RunSnapshotCapture<TAdmission = unknown> {
  capture(request: TriggerRequest, runId: string, options?: {
    admission?: TAdmission; selectedContext?: InitiativeSelectedContext; workScope?: SubagentWorkScope; signal?: AbortSignal;
  }): Promise<CapturedRunSnapshot>;
}

export interface RunService<TAdmission = unknown> {
  admitLinked(request: TriggerRequest, options: { linked: RunLinkedAdmission; admission?: TAdmission; signal?: AbortSignal }): Promise<RunAdmissionResult>;
  /** Trusted Core registration only; a request/provenance marker cannot construct its own source binding. */
  admitAcceptedWork(request: TriggerRequest, binding: AcceptedWorkBinding, admission?: TAdmission): Promise<RunAdmissionResult>;
  /** Derives text-only child admission from the original retained root; never recaptures model/Host authority. */
  admitPreparedPublication(input: PreparedPublicationRunInput): PreparedPublicationAdmission;
  /** Caller releases its Character lane only after a successful hold. */
  holdWork(input: RunWorkHold): RunWorkResult;
  /** Caller must first acquire the existing Character lane; this method grants no lease. */
  resumeWork(input: RunWorkTransition): RunWorkResult;
  holdDelivery(runId: string, attemptId: string, deliveryVersion: number): boolean;
  resumeDelivery(runId: string, attemptId: string, deliveryVersion: number): boolean;
  admit(request: TriggerRequest, admission?: TAdmission, selectedContext?: InitiativeSelectedContext): Promise<RunAdmissionResult>;
  start(runId: string, attemptId: string): boolean;
  retry(runId: string, attemptId: string, reason: string): RunStatusResult;
  settle(runId: string, attemptId: string, outcome: RunOutcome, details?: {
    retryable?: boolean;
    summary?: string;
    errorCode?: string;
  }): RunStatusResult;
  requestCancel(runId: string, reason?: string): boolean;
  context(runId: string): RunExecutionContext | undefined;
  status(runId: string): RunStatusResult;
  queue(input?: Partial<QueueListParams> & { now?: string }): QueueListResult;
  seal(): void;
}

// eslint-disable-next-line max-lines-per-function
export function createRunService<TAdmission = unknown>(deps: {
  repo: RunRepo;
  snapshot: RunSnapshotCapture<TAdmission>;
  provider: string;
  modelId: string;
}): RunService<TAdmission> {
  const contexts = new Map<string, RunExecutionContext>();
  deps.repo.onTerminalCommit((fact) => release(contexts, fact.run.runId));
  let accepting = true;
  const admit = async (candidate: TriggerRequest, options: {
    admission?: TAdmission; selectedContext?: InitiativeSelectedContext; acceptedWork?: AcceptedWorkBinding;
    linked?: RunLinkedAdmission; workScope?: SubagentWorkScope; signal?: AbortSignal;
  }): Promise<RunAdmissionResult> => {
    if (!accepting) throw new Error("RUN_ADMISSION_CLOSED");
    const request = TriggerRequestSchema.parse(candidate);
    if (request.deadlineAt && Date.parse(request.deadlineAt) <= Date.now()) throw new Error("RUN_DEADLINE_EXCEEDED");
    if (request.budgetHint === 0) throw new Error("RUN_BUDGET_EXHAUSTED");
    const proposedRunId = randomUUID();
    const captured = await deps.snapshot.capture(request, proposedRunId, options);
    if (options.acceptedWork) captured.context = Object.freeze({ ...captured.context, acceptedWork: options.acceptedWork });
    if (options.workScope) captured.context = Object.freeze({ ...captured.context, workScope: options.workScope });
    if (!accepting) { captured.context?.dispose?.(); throw new Error("RUN_ADMISSION_CLOSED"); }
    let result: RunAdmissionResult;
    try {
      validateWorkAdmission(request, captured.context);
      result = deps.repo.admit({ runId: proposedRunId, request, snapshot: captured.snapshot,
        provider: deps.provider, modelId: deps.modelId, linked: options.linked } satisfies RunAdmissionInput);
    } catch (error) {
      captured.context?.dispose?.(); throw error;
    }
    // An admission observer can synchronously terminalize before this capture is bound.
    result = { ...result, run: deps.repo.status(result.run.runId).run };
    bindCapturedContext(contexts, result, { captured, disposeUnused: () => deps.repo.afterCommit(() => captured.context?.dispose?.()) });
    return result;
  };
  return {
    admitLinked(request, options) {
      const link = options.linked.kind === "subagent"
        ? { ...options.linked, token: SubagentWorkTokenSchema.parse(options.linked.token) } : { ...options.linked };
      if (link.kind === "subagent") { Object.freeze(link.token.source); Object.freeze(link.token); }
      Object.freeze(link);
      const workScope: SubagentWorkScope = link.kind === "subagent"
        ? { kind: "subagent", subagentId: link.token.subagentId, workInputId: link.token.workInputId }
        : { kind: "parent-continuation", completionId: link.completionId };
      return admit(request, { ...options, linked: link, workScope: Object.freeze(workScope) });
    },
    admitAcceptedWork(request, binding, admission) {
      if (request.provenance.provider !== ACCEPTED_WORK_PROVIDER) throw new Error("RUN_WORK_BINDING_REQUIRED");
      return admit(request, { admission, acceptedWork: binding });
    },
    admitPreparedPublication: (input) => admitPreparedPublication({ repo: deps.repo,
      context: (runId) => contexts.get(runId), isOpen: () => accepting }, input),
    holdWork(input) {
      if (!accepting) return { changed: false, reason: "closed" };
      const parsed = RunWorkHoldSchema.safeParse(input);
      if (!parsed.success) return { changed: false, reason: "invalid_input" };
      const refusal = workBindingRefusal(contexts.get(parsed.data.runId), parsed.data.reasonRef);
      return refusal ? { changed: false, reason: refusal } : deps.repo.holdWork(parsed.data);
    },
    resumeWork(input) {
      if (!accepting) return { changed: false, reason: "closed" };
      const parsed = RunWorkTransitionSchema.safeParse(input);
      if (!parsed.success) return { changed: false, reason: "invalid_input" };
      const context = contexts.get(parsed.data.runId);
      if (!context) return { changed: false, reason: "binding_lost" };
      const sourceRef = deps.repo.status(parsed.data.runId).run.provenance.sourceRef;
      const refusal = workBindingRefusal(context, sourceRef);
      return refusal ? { changed: false, reason: refusal } : deps.repo.resumeWork(parsed.data);
    },
    holdDelivery: (runId, attemptId, version) => deps.repo.holdDelivery(runId, attemptId, version),
    resumeDelivery: (runId, attemptId, version) => accepting && contexts.has(runId) && deps.repo.resumeDelivery(runId, attemptId, version),
    admit: (request, admission, selectedContext) => admit(request, { admission, selectedContext }),
    start(runId, attemptId) {
      return deps.repo.start(runId, attemptId).started;
    },
    retry: (runId, attemptId, reason) => deps.repo.retry(runId, attemptId, reason),
    // eslint-disable-next-line max-params
    settle(runId, attemptId, outcome, details = {}) {
      const retryability = details.retryable === true
        ? "retryable"
        : details.retryable === false ? "not_retryable" : "unknown";
      return deps.repo.settle({ runId, attemptId, outcome, retryability,
        summary: details.summary, errorCode: details.errorCode });
    },
    requestCancel(runId, reason) {
      return deps.repo.cancel(runId, reason).changed;
    },
    context: (runId) => contexts.get(runId),
    status: (runId) => deps.repo.status(runId),
    queue: (input) => deps.repo.queue(input),
    seal: () => { accepting = false; },
  };
}

function release(contexts: Map<string, RunExecutionContext>, runId: string): void {
  const context = contexts.get(runId);
  contexts.delete(runId);
  context?.dispose?.();
}

function bindCapturedContext(contexts: Map<string, RunExecutionContext>, result: RunAdmissionResult,
  input: { captured: CapturedRunSnapshot; disposeUnused: () => void }): void {
  const { captured, disposeUnused } = input;
  const terminal = ["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"].includes(result.run.state);
  // An in-process duplicate keeps its original executable closures. After process-local context loss, persisted
  // admission evidence is still authoritative: rebuilding a context may not silently select a different memory.
  if (terminal || (result.reused && contexts.has(result.run.runId))) { disposeUnused(); return; }
  if (result.reused && captured.context?.workScope) {
    disposeUnused();
    throw new Error("SUBAGENT_CONTINUE_REQUIRED");
  }
  if (result.reused && result.run.provenance.provider === ACCEPTED_WORK_PROVIDER) {
    disposeUnused();
    throw new Error("RUN_WORK_CONTINUE_REQUIRED");
  }
  if (result.reused && !sameMemoryReference(result.snapshot.memory, captured.snapshot.memory)) {
    disposeUnused();
    const memory = result.snapshot.memory;
    const refusal = MemoryErrorEnvelopeSchema.parse({ ok: false, requestId: result.run.runId,
      providerId: memory.providerId, authorityEpochId: memory.authorityEpochId ?? null, capabilities: memory.capabilities,
      error: { code: "MEMORY_AUTHORITY_MISMATCH", category: "authority", message: "memory differs from the admitted Run",
        retryable: false, nextAction: "check-provider" } });
    // Keep the ordinary Error boundary and the existing Shared structured memory disposition together.
    throw Object.assign(new Error(refusal.error.code), refusal);
  }
  if (captured.context) contexts.set(result.run.runId, captured.context);
}

function sameMemoryReference(left: RunMemoryReference, right: RunMemoryReference): boolean {
  return left.providerId === right.providerId && left.providerLineageId === right.providerLineageId
    && left.authorityEpochId === right.authorityEpochId && left.contractVersion === right.contractVersion
    && left.capabilityDigest === right.capabilityDigest && sameMemoryCapabilities(left.capabilities, right.capabilities);
}
