/**
 * INPUT:  bounded Run transition facts and optional trigger correlation
 * OUTPUT: canonical Run Event envelopes plus shared transition/text helpers
 * POS:    core/db — construction helper used by transactional Run and recovery writers
 */
import type { Attempt, Run, RunEvent, RunOutcome, RunStatusResult, TriggerRequest } from "@taki/shared";

export function lifecycleEvent(input: {
  runId: string;
  attemptId?: string;
  kind: RunEvent["kind"];
  occurredAt: string;
  payload: RunEvent["payload"];
  request?: TriggerRequest;
  category?: RunEvent["category"];
  source?: RunEvent["source"];
}): Omit<RunEvent, "eventId" | "seq"> {
  const { runId, attemptId, kind, occurredAt, payload, request } = input;
  return { runId, ...(attemptId ? { attemptId } : {}), schemaVersion: "run-event.v1", category: input.category ?? "lifecycle", kind, occurredAt, source: input.source ?? "core.run-repo", ...(request ? { correlation: { triggerRequestId: request.triggerRequestId, ...(request.provenance.taskId ? { taskId: request.provenance.taskId } : {}), ...(request.provenance.parentRunId ? { parentRunId: request.provenance.parentRunId } : {}) } } : {}), payload };
}

export function boundText(value: string, max: number): string;
export function boundText(value: string | undefined, max: number): string | undefined;
export function boundText(value: string | undefined, max: number): string | undefined {
  return value === undefined ? undefined : value.slice(0, max);
}

export function boundNonEmptyText(value: string | undefined, max: number): string | undefined {
  const bounded = boundText(value, max);
  return bounded === "" ? undefined : bounded;
}

export function activeAttempt(status: RunStatusResult): Attempt {
  const attempt = status.attempts.find((item) => item.attemptId === status.run.activeAttemptId);
  if (!attempt) throw new Error("RUN_ATTEMPT_MISSING");
  return attempt;
}

export function legalTerminalTransition(from: Run["state"], to: RunOutcome): boolean {
  if (from === "queued") return ["skipped", "cancelled", "failed", "deadline_exceeded"].includes(to);
  if (from === "cancel_requested") return to === "cancelled" || to === "outcome_unknown";
  return ["running", "waiting", "recovering"].includes(from);
}

export function legalAttemptTerminal(from: Attempt["state"], to: Attempt["state"]): boolean {
  if (from === "prepared") return ["failed", "cancelled", "deadline_exceeded"].includes(to);
  return ["intent_committed", "effect_running", "settling"].includes(from)
    && ["completed", "failed", "cancelled", "deadline_exceeded", "outcome_unknown"].includes(to);
}
