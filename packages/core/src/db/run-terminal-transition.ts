/**
 * INPUT: canonical Run settlement and exact active Attempt inside the existing repository
 * OUTPUT: atomic terminal Run/Receipt/events plus required linked data and committed notifications
 * POS: core/db — terminal transition shared by start, dispatch refusal, public settle and recovery
 */
import { randomUUID } from "node:crypto";
import type { Attempt, RunOutcome, RunStatusResult, Retryability, RunEvent } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import type { RunEventRepo } from "./run-event-repo.ts";
import type { RunEventLiveBus } from "./run-event-live.ts";
import type { RunLinkedState, RunTerminalFact } from "./run-linked-state.ts";
import { activeAttempt, legalAttemptTerminal, legalTerminalTransition, lifecycleEvent } from "./run-event-factory.ts";
import { readAttemptById, readRunById, readStatus } from "./run-readers.ts";

const ATTEMPT_TERMINAL = new Set<Attempt["state"]>(["completed", "failed", "cancelled", "deadline_exceeded", "outcome_unknown"]);

export function settleRun(deps: { db: Database; eventRepo: RunEventRepo; liveBus?: RunEventLiveBus; linkedState?: RunLinkedState; terminalListeners: Set<(fact: RunTerminalFact) => void> }, status: RunStatusResult, input: {
  runId: string;
  attemptId: string;
  outcome: RunOutcome;
  retryability: Retryability;
  summary?: string;
  errorCode?: string;
  at?: string;
}): RunStatusResult {
  const at = input.at ?? new Date().toISOString();
  const { db, eventRepo, liveBus } = deps;
  const target = status.run.state === "cancel_requested" && input.outcome !== "outcome_unknown"
    ? "cancelled"
    : input.outcome;
  if (!legalTerminalTransition(status.run.state, target)) throw new Error("RUN_INVALID_TRANSITION");
  const attempt = activeAttempt(status);
  if (attempt.attemptId !== input.attemptId) return status;
  const attemptTarget = target === "skipped" ? "failed" : target;
  const receiptId = randomUUID();
  let committed: RunEvent[] = [];
  db.transaction(() => {
    if (!ATTEMPT_TERMINAL.has(attempt.state)) {
      if (!legalAttemptTerminal(attempt.state, attemptTarget)) throw new Error("ATTEMPT_INVALID_TRANSITION");
      updateAttempt(db, attempt, { state: attemptTarget, outcome: target, retryability: input.retryability,
        summary: input.summary, errorCode: input.errorCode, at });
    }
    const changed = db.prepare(`UPDATE runs SET state=:state,state_version=state_version+1,
      operation_phase='terminal',outcome=:outcome,retryability=:retryability,terminal_at=:at,
      receipt_id=:receiptId,updated_at=:at WHERE run_id=:runId AND state_version=:version AND state NOT IN
      ('completed','failed','cancelled','skipped','deadline_exceeded','outcome_unknown')`)
      .run({ state: target, outcome: target, retryability: input.retryability, at, receiptId,
        runId: input.runId, version: status.run.stateVersion });
    if (changed.changes !== 1) throw new Error("RUN_STALE_VERSION");
    insertReceipt(db, { ...input, receiptId, outcome: target, at }, status);
    const fact: RunTerminalFact = { run: readRunById(db, input.runId), attempt: readAttemptById(db, attempt.attemptId),
      finalOutcome: target, receiptId, at };
    deps.linkedState?.onTerminalTx(fact);
    const boundaryEvent = lifecycleBoundaryEvent(input, status, at);
    committed = eventRepo.appendMany([
      lifecycleEvent({ runId: input.runId, attemptId: attempt.attemptId, kind: "attempt.settled", occurredAt: at, payload: { kind: "attempt.settled", state: attemptTarget, outcome: target, attemptOrdinal: attempt.ordinal, retryability: input.retryability, summary: input.summary, errorCode: input.errorCode } }),
      ...(boundaryEvent ? [boundaryEvent] : []),
      lifecycleEvent({ runId: input.runId, kind: "run.settled", occurredAt: at, payload: { kind: "run.settled", state: target, outcome: target, retryability: input.retryability, summary: input.summary, errorCode: input.errorCode } }),
    ]);
    db.afterCommit(() => liveBus?.publish(committed));
    for (const listener of deps.terminalListeners) db.afterCommit(() => listener(fact));
    db.afterCommit(() => deps.linkedState?.afterTerminalCommit?.(fact));
  });
  return readStatus(db, input.runId);
}

function insertReceipt(db: Database, input: { runId: string; receiptId: string; outcome: RunOutcome;
  retryability: Retryability; summary?: string; at: string }, status: RunStatusResult): void {
  db.prepare(`INSERT INTO run_receipts
    (receipt_id,run_id,state,outcome,retryability,reason,action,attempt_count,snapshot_id,summary,created_at,updated_at)
    VALUES (:receiptId,:runId,:state,:outcome,:retryability,:reason,NULL,:attemptCount,:snapshotId,:summary,:at,:at)`)
    .run({ receiptId: input.receiptId, runId: input.runId, state: input.outcome, outcome: input.outcome,
      retryability: input.retryability, reason: input.summary ?? null, attemptCount: status.attempts.length,
      snapshotId: status.run.snapshot.snapshotId, summary: input.summary ?? null, at: input.at });
}

function lifecycleBoundaryEvent(input: { runId: string; errorCode?: string; summary?: string }, status: RunStatusResult, at: string): Omit<RunEvent, "eventId" | "seq"> | undefined {
  if (input.errorCode === "deadline_exceeded") return lifecycleEvent({ runId: input.runId, kind: "run.deadline_exceeded", occurredAt: at, payload: { kind: "run.deadline_exceeded", state: "deadline_exceeded", reason: input.summary ?? "captured deadline elapsed" } });
  if (input.errorCode === "budget_exceeded") return lifecycleEvent({ runId: input.runId, kind: "run.budget_exceeded", occurredAt: at, payload: { kind: "run.budget_exceeded", state: "failed", reason: input.summary ?? "captured budget exhausted", used: status.run.budgetUsed, ...(status.run.budgetLimit === undefined ? {} : { limit: status.run.budgetLimit }) } });
  return undefined;
}

export function updateAttempt(db: Database, attempt: Attempt, input: {
  state: Attempt["state"];
  outcome?: RunOutcome;
  retryability?: Retryability;
  summary?: string;
  errorCode?: string;
  at: string;
}): void {
  const changed = db.prepare(`UPDATE run_attempts SET state=:state,state_version=state_version+1,
    outcome=:outcome,retryability=:retryability,result_summary=:summary,error_code=:errorCode,
    started_at=CASE WHEN :state='effect_running' AND started_at IS NULL THEN :at ELSE started_at END,
    settled_at=CASE WHEN :terminal=1 THEN :at ELSE settled_at END
    WHERE attempt_id=:attemptId AND run_id=:runId AND state_version=:version`)
    .run({ state: input.state, outcome: input.outcome ?? null, retryability: input.retryability ?? null,
      summary: input.summary ?? null, errorCode: input.errorCode ?? null, at: input.at,
      terminal: ATTEMPT_TERMINAL.has(input.state) ? 1 : 0, attemptId: attempt.attemptId,
      runId: attempt.runId, version: attempt.stateVersion });
  if (changed.changes !== 1) throw new Error("ATTEMPT_STALE_VERSION");
}
