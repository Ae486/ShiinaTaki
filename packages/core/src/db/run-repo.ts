/**
 * INPUT:  Core Database and validated provider-neutral lifecycle values
 * OUTPUT: atomic Run admission, start/retry/settlement/cancel transitions, and bounded status reads
 * POS:    core/db — sole SQLite persistence boundary for the Slice 1 Run aggregate and its child records
 */
import { randomUUID } from "node:crypto";
import {
  RunSnapshotSchema,
  type Attempt,
  type Retryability,
  type Run,
  type RunOutcome,
  type RunSnapshot,
  type RunStatusResult,
  type RunEventCursor,
  type QueueListParams, type QueueListResult, type RecoveryClassification,
  type TriggerRequest,
} from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { digestRunValue, readRunRow } from "./run-row-mappers.ts";
import { readAttemptById, readRunById, readRunByIdempotency, readRunSnapshot, readStatus } from "./run-readers.ts";
import { createRunEventRepo, type RunEventRepo } from "./run-event-repo.ts";
import type { RunEvent } from "@taki/shared";
import type { RunEventLiveBus } from "./run-event-live.ts";
import type { RunLinkedAdmission, RunLinkedState, RunTerminalFact } from "./run-linked-state.ts";
import { settleRun, updateAttempt } from "./run-terminal-transition.ts";
import { activeAttempt, boundNonEmptyText, boundText, lifecycleEvent } from "./run-event-factory.ts";
import { classifyRecovery, listQueue, listRecoverableRuns } from "./run-recovery-repo.ts";
import { transitionRunDelivery } from "./run-delivery-transition.ts";
import { transitionRunWork } from "./run-work-transition.ts";
import type { RunWorkHold, RunWorkTransition, RunWorkResult } from "@taki/shared";

type SnapshotDraft = Omit<RunSnapshot, "snapshotId" | "runId" | "capturedAt" | "manifestDigest">;

export interface RunAdmissionInput {
  runId: string;
  request: TriggerRequest;
  snapshot: SnapshotDraft;
  provider: string;
  modelId: string;
  now?: string;
  linked?: RunLinkedAdmission;
}

export interface RunAdmissionResult {
  run: Run;
  attempt: Attempt;
  /** Internal complete admission manifest; public Run/status responses keep their bounded snapshot reference. */
  snapshot: RunSnapshot;
  eventTail: RunEventCursor;
  reused: boolean;
}

export interface RunCancelResult {
  run: Run;
  changed: boolean;
}

export interface RunRepo {
  afterCommit(callback: () => void): void;
  onTerminalCommit(listener: (fact: RunTerminalFact) => void): () => void;
  holdWork(input: RunWorkHold): RunWorkResult;
  resumeWork(input: RunWorkTransition): RunWorkResult;
  holdDelivery(runId: string, attemptId: string, deliveryVersion: number): boolean;
  resumeDelivery(runId: string, attemptId: string, deliveryVersion: number): boolean;
  admit(input: RunAdmissionInput): RunAdmissionResult;
  status(runId: string): RunStatusResult;
  snapshot(runId: string): RunSnapshot;
  start(runId: string, attemptId: string): { started: boolean; status: RunStatusResult };
  retry(runId: string, attemptId: string, reason: string): RunStatusResult;
  settle(input: {
    runId: string;
    attemptId: string;
    outcome: RunOutcome;
    retryability: Retryability;
    summary?: string;
    errorCode?: string;
  }): RunStatusResult;
  cancel(runId: string, reason?: string): RunCancelResult;
  queue(input?: Partial<QueueListParams> & { now?: string }): QueueListResult;
  listRecoverable(limit?: number): string[];
  classifyRecovery(input: { runId: string; classification: RecoveryClassification; reason?: string; now?: string; generation?: string }): RunStatusResult;
  guardDispatch(runId: string, attemptId: string): boolean;
}

const TERMINAL = new Set<Run["state"]>([
  "completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown",
]);

// eslint-disable-next-line max-lines-per-function
export function createRunRepo(db: Database, eventRepo: RunEventRepo = createRunEventRepo(db), options?: RunEventLiveBus | { liveBus?: RunEventLiveBus; linkedState?: RunLinkedState }): RunRepo {
  const liveBus = options && "publish" in options ? options : options?.liveBus;
  const linkedState = options && "publish" in options ? undefined : options?.linkedState;
  const terminalListeners = new Set<(fact: RunTerminalFact) => void>();
  const now = () => new Date().toISOString();
  return {
    afterCommit: (callback) => db.afterCommit(callback),
    onTerminalCommit(listener) { terminalListeners.add(listener); return () => { terminalListeners.delete(listener); }; },
    holdWork: (input) => transitionRunWork({ db, events: eventRepo, live: liveBus }, input, false),
    resumeWork: (input) => transitionRunWork({ db, events: eventRepo, live: liveBus }, input, true),
    holdDelivery: (runId, attemptId, deliveryVersion) => transitionRunDelivery({ db, events: eventRepo, live: liveBus }, { runId, attemptId, deliveryVersion, resume: false }),
    resumeDelivery: (runId, attemptId, deliveryVersion) => transitionRunDelivery({ db, events: eventRepo, live: liveBus }, { runId, attemptId, deliveryVersion, resume: true }),
    admit(input) {
      const requestHash = digestRunValue(input.request);
      const existing = readRunByIdempotency(db, input.request.idempotencyKey);
      if (input.linked && !linkedState) throw new Error("RUN_LINKED_STATE_REQUIRED");
      if (existing) {
        const reused = reuseAdmission({ db, eventRepo, row: existing, requestHash });
        db.transaction(() => linkedState?.onAdmitTx({ ...reused, request: input.request, link: input.linked }));
        return reused;
      }
      const admittedAt = input.now ?? now();
      const snapshotId = randomUUID();
      const attemptId = randomUUID();
      const snapshotBase = { ...input.snapshot, snapshotId, runId: input.runId, capturedAt: admittedAt };
      const manifest = RunSnapshotSchema.parse({ ...snapshotBase, manifestDigest: digestRunValue(snapshotBase) });
      let committed: RunEvent[] = [];
      db.transaction(() => {
        insertAdmission(db, { ...input, requestHash, snapshotId, attemptId, admittedAt, manifest });
        linkedState?.onAdmitTx({ request: input.request, run: readRunById(db, input.runId), attempt: readAttemptById(db, attemptId),
          snapshot: manifest, reused: false, link: input.linked });
        committed = eventRepo.appendMany([
          lifecycleEvent({ runId: input.runId, kind: "run.admitted", occurredAt: admittedAt, payload: { kind: "run.admitted", state: "queued", initiator: input.request.initiator, deliveryClass: input.request.deliveryClass, attemptOrdinal: 1 }, request: input.request }),
          lifecycleEvent({ runId: input.runId, attemptId, kind: "attempt.prepared", occurredAt: admittedAt, payload: { kind: "attempt.prepared", state: "prepared", attemptOrdinal: 1 }, request: input.request }),
          lifecycleEvent({ runId: input.runId, attemptId, kind: "context.snapshot", category: "context", source: "core.context-observer", occurredAt: admittedAt, payload: { kind: "context.snapshot", state: "captured", sourceCategories: manifest.contextDecision.sourceCategories, accountingQuality: manifest.contextDecision.tokenAccounting === "provider_reported" ? "reported" : manifest.contextDecision.tokenAccounting === "estimated" ? "estimated" : "unknown" } }),
        ]);
      });
      db.afterCommit(() => liveBus?.publish(committed));
      return { run: readRunById(db, input.runId), attempt: readAttemptById(db, attemptId), snapshot: manifest, eventTail: eventRepo.tail(input.runId), reused: false };
    },
    status: (runId) => readStatus(db, runId),
    snapshot: (runId) => readRunSnapshot(db, runId),
    start(runId, attemptId) {
      const status = readStatus(db, runId);
      if (TERMINAL.has(status.run.state) || status.run.activeAttemptId !== attemptId) return { started: false, status };
      if (status.run.state === "cancel_requested") {
        return { started: false, status: settleRun({ db, eventRepo, liveBus, linkedState, terminalListeners }, status, {
          runId, attemptId, outcome: "cancelled", retryability: "not_retryable", summary: "cancelled before start", at: now(),
        }) };
      }
      if (status.run.deadlineAt && Date.parse(status.run.deadlineAt) <= Date.now()) {
        return { started: false, status: settleRun({ db, eventRepo, liveBus, linkedState, terminalListeners }, status, {
          runId, attemptId, outcome: "deadline_exceeded", retryability: "not_retryable", summary: "captured deadline elapsed before dispatch", errorCode: "deadline_exceeded", at: now(),
        }) };
      }
      if (status.run.budgetLimit !== undefined && status.run.budgetUsed >= status.run.budgetLimit) {
        return { started: false, status: settleRun({ db, eventRepo, liveBus, linkedState, terminalListeners }, status, {
          runId, attemptId, outcome: "failed", retryability: "not_retryable", summary: "captured budget exhausted before dispatch", errorCode: "budget_exceeded", at: now(),
        }) };
      }
      if (status.run.state === "running") return { started: false, status };
      if (status.run.state !== "queued") throw new Error("RUN_INVALID_TRANSITION");
      const attempt = activeAttempt(status);
      const at = now();
      let committed: RunEvent[] = [];
      db.transaction(() => {
        updateRun(db, status.run, { state: "running", operationPhase: "executing", at });
        updateAttempt(db, attempt, { state: "effect_running", at });
        committed = eventRepo.appendMany([
          lifecycleEvent({ runId, kind: "run.started", occurredAt: at, payload: { kind: "run.started", state: "running", operationPhase: "executing" } }),
          lifecycleEvent({ runId, attemptId, kind: "attempt.started", occurredAt: at, payload: { kind: "attempt.started", state: "effect_running", attemptOrdinal: attempt.ordinal } }),
        ]);
      });
      db.afterCommit(() => liveBus?.publish(committed));
      return { started: true, status: readStatus(db, runId) };
    },
    retry(runId, attemptId, reason) {
      const status = readStatus(db, runId);
      if (status.run.state !== "running" || status.run.activeAttemptId !== attemptId) return status;
      const attempt = activeAttempt(status);
      if (attempt.attemptId !== attemptId || attempt.state !== "effect_running") return status;
      // Shared status/Receipt contracts cap one Run at 10,000 Attempts. Refuse before the transaction so a committed
      // ordinal 10,001 cannot make every subsequent status read fail schema validation.
      if (attempt.ordinal >= 10_000) throw new Error("RUN_ATTEMPT_LIMIT_EXCEEDED");
      const at = now();
      const boundedReason = boundText(reason, 1000);
      const nextId = randomUUID();
      let committed: RunEvent[] = [];
      db.transaction(() => {
        updateAttempt(db, attempt, { state: "failed", outcome: "failed", retryability: "retryable",
          summary: boundedReason, errorCode: "context_overflow", at });
        db.prepare(`INSERT INTO run_attempts
          (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id,retry_reason,started_at,deadline_at)
          VALUES (:attemptId,:runId,:ordinal,'effect_running',0,:provider,:modelId,:snapshotId,:reason,:at,:deadlineAt)`)
          .run({ attemptId: nextId, runId, ordinal: attempt.ordinal + 1, provider: attempt.provider,
            modelId: attempt.modelId, snapshotId: status.run.snapshot.snapshotId, reason: boundedReason, at,
            deadlineAt: attempt.deadlineAt ?? null });
        const changed = db.prepare(`UPDATE runs SET active_attempt_id=:attemptId,state_version=state_version+1,
          operation_phase='executing',updated_at=:at WHERE run_id=:runId AND state='running' AND
          state_version=:version AND active_attempt_id=:oldAttemptId`)
          .run({ attemptId: nextId, at, runId, version: status.run.stateVersion, oldAttemptId: attempt.attemptId });
        if (changed.changes !== 1) throw new Error("RUN_STALE_VERSION");
        committed = eventRepo.appendMany([
          lifecycleEvent({ runId, attemptId: attempt.attemptId, kind: "attempt.settled", occurredAt: at, payload: { kind: "attempt.settled", state: "failed", outcome: "failed", attemptOrdinal: attempt.ordinal, retryability: "retryable", summary: boundedReason, errorCode: "context_overflow" } }),
          lifecycleEvent({ runId, attemptId: nextId, kind: "run.retry", category: "recovery", source: "core.run-repo", occurredAt: at, payload: { kind: "run.retry", state: "retrying", attemptOrdinal: attempt.ordinal + 1, retryOrdinal: attempt.ordinal, reasonCode: boundedReason.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 100) || "retry" } }),
          lifecycleEvent({ runId, attemptId: nextId, kind: "attempt.started", occurredAt: at, payload: { kind: "attempt.started", state: "effect_running", attemptOrdinal: attempt.ordinal + 1 } }),
        ]);
      });
      db.afterCommit(() => liveBus?.publish(committed));
      return readStatus(db, runId);
    },
    settle(input) {
      const status = readStatus(db, input.runId);
      if (TERMINAL.has(status.run.state) || status.run.activeAttemptId !== input.attemptId) return status;
      const at = now();
      const deadlineExpired = status.run.state !== "cancel_requested" && input.outcome === "completed"
        && status.run.deadlineAt !== undefined && Date.parse(status.run.deadlineAt) <= Date.parse(at);
      return settleRun({ db, eventRepo, liveBus, linkedState, terminalListeners }, status, { ...input,
        outcome: deadlineExpired ? "deadline_exceeded" : input.outcome,
        summary: boundText(deadlineExpired ? "captured deadline elapsed before settlement" : input.summary, 1000),
        errorCode: boundNonEmptyText(deadlineExpired ? "deadline_exceeded" : input.errorCode, 100), at });
    },
    cancel(runId, reason = "cancel requested") {
      const run = readStatus(db, runId).run;
      if (TERMINAL.has(run.state) || run.state === "cancel_requested") return { run, changed: false };
      if (!["queued", "running", "waiting", "recovering"].includes(run.state)) {
        throw new Error("RUN_INVALID_TRANSITION");
      }
      const at = now();
      let changed = 0; let committed: RunEvent[] = [];
      db.transaction(() => {
        const result = db.prepare(`UPDATE runs SET state='cancel_requested',state_version=state_version+1,
          operation_phase='cancelling',cancel_requested_at=:at,cancel_reason=:reason,updated_at=:at
          WHERE run_id=:runId AND state_version=:version AND state NOT IN
           ('completed','failed','cancelled','skipped','deadline_exceeded','outcome_unknown','cancel_requested')`)
            .run({ at, reason: boundText(reason, 1000), runId, version: run.stateVersion });
        changed = result.changes;
        if (changed === 1) committed = [eventRepo.append(lifecycleEvent({ runId, kind: "run.cancel_requested", occurredAt: at, payload: { kind: "run.cancel_requested", state: "cancel_requested", reason: boundText(reason, 1000) ?? "cancel requested" } }))];
      });
      db.afterCommit(() => liveBus?.publish(committed));
      return { run: readRunById(db, runId), changed: changed === 1 };
    },
    queue: (input) => listQueue(db, input),
    listRecoverable: (limit) => listRecoverableRuns(db, limit),
    classifyRecovery: (input) => classifyRecovery({ db, eventRepo, liveBus, runId: input.runId, classification: input.classification, reason: input.reason, at: input.now ?? now(), generation: input.generation ?? `classified:${input.now ?? now()}` }),
    guardDispatch(runId, attemptId) {
      const status = readStatus(db, runId);
      if (status.run.activeAttemptId !== attemptId || TERMINAL.has(status.run.state)) return false;
      if (status.run.state === "cancel_requested") {
        settleRun({ db, eventRepo, liveBus, linkedState, terminalListeners }, status, { runId, attemptId, outcome: "cancelled", retryability: "not_retryable", summary: "cancelled before effect dispatch", errorCode: "cancel_requested", at: now() });
        return false;
      }
      if (status.run.deadlineAt && Date.parse(status.run.deadlineAt) <= Date.now()) {
        settleRun({ db, eventRepo, liveBus, linkedState, terminalListeners }, status, { runId, attemptId, outcome: "deadline_exceeded", retryability: "not_retryable", summary: "captured deadline elapsed before effect dispatch", errorCode: "deadline_exceeded", at: now() });
        return false;
      }
      if (status.run.budgetLimit !== undefined && status.run.budgetUsed >= status.run.budgetLimit) {
        settleRun({ db, eventRepo, liveBus, linkedState, terminalListeners }, status, { runId, attemptId, outcome: "failed", retryability: "not_retryable", summary: "captured budget exhausted before effect dispatch", errorCode: "budget_exceeded", at: now() });
        return false;
      }
      return status.run.state === "running";
    },
  };
}

function insertAdmission(db: Database, input: RunAdmissionInput & {
  requestHash: string;
  snapshotId: string;
  attemptId: string;
  admittedAt: string;
  manifest: RunSnapshot;
}): void {
  const { request, manifest } = input;
  db.prepare(`INSERT INTO run_snapshots
    (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at)
    VALUES (:snapshotId,:runId,:schemaVersion,:manifest,:digest,:at,:at)`)
    .run({ snapshotId: input.snapshotId, runId: input.runId, schemaVersion: manifest.schemaVersion,
      manifest: JSON.stringify(manifest), digest: manifest.manifestDigest, at: input.admittedAt });
  db.prepare(`INSERT INTO runs
    (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,task_id,
     parent_run_id,delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,deadline_at,
     operation_phase,budget_limit,budget_used,created_at,updated_at)
    VALUES (:runId,:characterId,:triggerRequestId,:idempotencyKey,:requestHash,:initiator,:provenance,:taskId,
     :parentRunId,:deliveryClass,'queued',0,:snapshotId,:attemptId,:at,:deadlineAt,'admitted',:budgetLimit,0,:at,:at)`)
    .run({ runId: input.runId, characterId: request.characterId, triggerRequestId: request.triggerRequestId,
      idempotencyKey: request.idempotencyKey, requestHash: input.requestHash, initiator: request.initiator,
      provenance: JSON.stringify(request.provenance), taskId: request.provenance.taskId ?? null,
      parentRunId: request.provenance.parentRunId ?? null, deliveryClass: request.deliveryClass,
      snapshotId: input.snapshotId, attemptId: input.attemptId, at: input.admittedAt,
      deadlineAt: request.deadlineAt ?? null, budgetLimit: request.budgetHint ?? null });
  db.prepare(`INSERT INTO run_attempts
    (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id,deadline_at)
    VALUES (:attemptId,:runId,1,'prepared',0,:provider,:modelId,:snapshotId,:deadlineAt)`)
    .run({ attemptId: input.attemptId, runId: input.runId, provider: input.provider,
      modelId: input.modelId, snapshotId: input.snapshotId, deadlineAt: request.deadlineAt ?? null });
}

function reuseAdmission(input: { db: Database; eventRepo: RunEventRepo; row: Record<string, unknown>; requestHash: string }): RunAdmissionResult {
  const { db, eventRepo, row, requestHash } = input;
  if (row.request_hash !== requestHash) throw new Error("RUN_IDEMPOTENCY_CONFLICT");
  const run = readRunRow(row);
  if (!run.activeAttemptId) throw new Error("RUN_ATTEMPT_MISSING");
  const snapshot = RunSnapshotSchema.parse(JSON.parse(String(row.manifest_json)));
  return { run, attempt: readAttemptById(db, run.activeAttemptId), snapshot, eventTail: eventRepo.tail(run.runId), reused: true };
}

function updateRun(db: Database, run: Run, input: {
  state: Run["state"];
  operationPhase: Run["operationPhase"];
  at: string;
}): void {
  const changed = db.prepare(`UPDATE runs SET state=:state,state_version=state_version+1,
    operation_phase=:operationPhase,started_at=CASE WHEN :state='running' AND started_at IS NULL THEN :at
    ELSE started_at END,updated_at=:at
    WHERE run_id=:runId AND state_version=:version`)
    .run({ ...input, runId: run.runId, version: run.stateVersion });
  if (changed.changes !== 1) throw new Error("RUN_STALE_VERSION");
}
