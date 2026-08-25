/**
 * INPUT:  validated Trigger Requests, provider-neutral snapshot capture, and lifecycle callbacks
 * OUTPUT: the single Core-owned admission/transition/status service plus captured process-local Run context
 * POS:    core/harness — lifecycle owner above SQLite repositories and below every trigger/chat adapter
 */
import { randomUUID } from "node:crypto";
import type { ToolSet } from "ai";
import {
  TriggerRequestSchema,
  type RunOutcome,
  type RunSnapshot,
  type RunStatusResult,
  type TriggerRequest,
  type QueueListParams, type QueueListResult,
} from "@taki/shared";
import type { RunAdmissionInput, RunAdmissionResult, RunRepo } from "../db/run-repo.ts";

type SnapshotDraft = Omit<RunSnapshot, "snapshotId" | "runId" | "capturedAt" | "manifestDigest">;

export interface CapturedRunSnapshot {
  snapshot: SnapshotDraft;
  context?: RunExecutionContext;
}

export interface RunExecutionContext {
  readonly tools?: ToolSet;
  readonly memoryTools?: ToolSet;
  readonly instructions?: string;
  dispose?(): void;
}

export interface RunSnapshotCapture<TAdmission = unknown> {
  capture(request: TriggerRequest, runId: string, admission?: TAdmission): Promise<CapturedRunSnapshot>;
}

export interface RunService<TAdmission = unknown> {
  admit(request: TriggerRequest, admission?: TAdmission): Promise<RunAdmissionResult>;
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
  let accepting = true;
  return {
    async admit(candidate, interactive) {
      if (!accepting) throw new Error("RUN_ADMISSION_CLOSED");
      const request = TriggerRequestSchema.parse(candidate);
      if (request.deadlineAt && Date.parse(request.deadlineAt) <= Date.now()) throw new Error("RUN_DEADLINE_EXCEEDED");
      if (request.budgetHint === 0) throw new Error("RUN_BUDGET_EXHAUSTED");
      const proposedRunId = randomUUID();
      const captured = await deps.snapshot.capture(request, proposedRunId, interactive);
      let result: RunAdmissionResult;
      try {
        result = deps.repo.admit({ runId: proposedRunId, request, snapshot: captured.snapshot,
          provider: deps.provider, modelId: deps.modelId } satisfies RunAdmissionInput);
      } catch (error) {
        captured.context?.dispose?.();
        throw error;
      }
      // A duplicate admission must not replace the process-local context of an already admitted Run. A scheduler
      // retry may arrive after the original context was released, in which case the new capture becomes authoritative.
      const terminal = ["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"].includes(result.run.state);
      if (result.reused && (terminal || contexts.has(result.run.runId))) captured.context?.dispose?.();
      else if (captured.context) contexts.set(result.run.runId, captured.context);
      return result;
    },
    start(runId, attemptId) {
      const result = deps.repo.start(runId, attemptId);
      if (!result.started && ["cancelled", "completed", "failed", "skipped", "deadline_exceeded", "outcome_unknown"].includes(result.status.run.state)) {
        release(contexts, runId);
      }
      return result.started;
    },
    retry: (runId, attemptId, reason) => deps.repo.retry(runId, attemptId, reason),
    // eslint-disable-next-line max-params
    settle(runId, attemptId, outcome, details = {}) {
      const retryability = details.retryable === true
        ? "retryable"
        : details.retryable === false ? "not_retryable" : "unknown";
      const result = deps.repo.settle({ runId, attemptId, outcome, retryability,
        summary: details.summary, errorCode: details.errorCode });
      if (["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"].includes(result.run.state)) {
        release(contexts, runId);
      }
      return result;
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
  contexts.get(runId)?.dispose?.();
  contexts.delete(runId);
}
