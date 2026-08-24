/**
 * INPUT:  Core Database and validated provider-neutral lifecycle values
 * OUTPUT: atomic Run admission, start/retry/settlement/cancel transitions, and bounded status reads
 * POS:    core/db — sole SQLite persistence boundary for the Slice 1 Run aggregate and its child records
 */
import { randomUUID } from "node:crypto";
import {
  RunSnapshotSchema,
  RunStatusResultSchema,
  type Attempt,
  type Retryability,
  type Run,
  type RunOutcome,
  type RunSnapshot,
  type RunStatusResult,
  type TriggerRequest,
} from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { digestRunValue, readAttemptRow, readReceiptRow, readRunRow } from "./run-row-mappers.ts";

type SnapshotDraft = Omit<RunSnapshot, "snapshotId" | "runId" | "capturedAt" | "manifestDigest">;

export interface RunAdmissionInput {
  runId: string;
  request: TriggerRequest;
  snapshot: SnapshotDraft;
  provider: string;
  modelId: string;
  now?: string;
}

export interface RunAdmissionResult {
  run: Run;
  attempt: Attempt;
  reused: boolean;
}

export interface RunCancelResult {
  run: Run;
  changed: boolean;
}

export interface RunRepo {
  admit(input: RunAdmissionInput): RunAdmissionResult;
  status(runId: string): RunStatusResult;
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
}

const TERMINAL = new Set<Run["state"]>([
  "completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown",
]);
const ATTEMPT_TERMINAL = new Set<Attempt["state"]>([
  "completed", "failed", "cancelled", "deadline_exceeded", "outcome_unknown",
]);

// eslint-disable-next-line max-lines-per-function
export function createRunRepo(db: Database): RunRepo {
  const now = () => new Date().toISOString();
  return {
    admit(input) {
      const requestHash = digestRunValue(input.request);
      const existing = readRunByIdempotency(db, input.request.idempotencyKey);
      if (existing) return reuseAdmission(db, existing, requestHash);
      const admittedAt = input.now ?? now();
      const snapshotId = randomUUID();
      const attemptId = randomUUID();
      const snapshotBase = { ...input.snapshot, snapshotId, runId: input.runId, capturedAt: admittedAt };
      const manifest = RunSnapshotSchema.parse({ ...snapshotBase, manifestDigest: digestRunValue(snapshotBase) });
      db.transaction(() => insertAdmission(db, { ...input, requestHash, snapshotId, attemptId, admittedAt, manifest }));
      return { run: readRunById(db, input.runId), attempt: readAttemptById(db, attemptId), reused: false };
    },
    status: (runId) => readStatus(db, runId),
    start(runId, attemptId) {
      const status = readStatus(db, runId);
      if (TERMINAL.has(status.run.state) || status.run.activeAttemptId !== attemptId) return { started: false, status };
      if (status.run.state === "cancel_requested") {
        return { started: false, status: settle(db, status, {
          runId, attemptId, outcome: "cancelled", retryability: "not_retryable", summary: "cancelled before start", at: now(),
        }) };
      }
      if (status.run.state === "running") return { started: false, status };
      if (status.run.state !== "queued") throw new Error("RUN_INVALID_TRANSITION");
      const attempt = activeAttempt(status);
      const at = now();
      db.transaction(() => {
        updateRun(db, status.run, { state: "running", operationPhase: "executing", at });
        updateAttempt(db, attempt, { state: "effect_running", at });
      });
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
      });
      return readStatus(db, runId);
    },
    settle(input) {
      const status = readStatus(db, input.runId);
      if (TERMINAL.has(status.run.state) || status.run.activeAttemptId !== input.attemptId) return status;
      return settle(db, status, { ...input, summary: boundText(input.summary, 1000),
        errorCode: boundNonEmptyText(input.errorCode, 100), at: now() });
    },
    cancel(runId, reason = "cancel requested") {
      const run = readStatus(db, runId).run;
      if (TERMINAL.has(run.state) || run.state === "cancel_requested") return { run, changed: false };
      if (!["queued", "running", "waiting", "recovering"].includes(run.state)) {
        throw new Error("RUN_INVALID_TRANSITION");
      }
      const at = now();
      const changed = db.prepare(`UPDATE runs SET state='cancel_requested',state_version=state_version+1,
        operation_phase='cancelling',cancel_requested_at=:at,cancel_reason=:reason,updated_at=:at
        WHERE run_id=:runId AND state_version=:version AND state NOT IN
         ('completed','failed','cancelled','skipped','deadline_exceeded','outcome_unknown','cancel_requested')`)
          .run({ at, reason: boundText(reason, 1000), runId, version: run.stateVersion });
      return { run: readRunById(db, runId), changed: changed.changes === 1 };
    },
  };
}

/** Keep durable diagnostic fields bounded before the transaction commits, so row parsing cannot fail after a write. */
function boundText(value: string, max: number): string;
function boundText(value: string | undefined, max: number): string | undefined;
function boundText(value: string | undefined, max: number): string | undefined {
  return value === undefined ? undefined : value.slice(0, max);
}

function boundNonEmptyText(value: string | undefined, max: number): string | undefined {
  const bounded = boundText(value, max);
  return bounded === "" ? undefined : bounded;
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
     operation_phase,created_at,updated_at)
    VALUES (:runId,:characterId,:triggerRequestId,:idempotencyKey,:requestHash,:initiator,:provenance,:taskId,
     :parentRunId,:deliveryClass,'queued',0,:snapshotId,:attemptId,:at,:deadlineAt,'admitted',:at,:at)`)
    .run({ runId: input.runId, characterId: request.characterId, triggerRequestId: request.triggerRequestId,
      idempotencyKey: request.idempotencyKey, requestHash: input.requestHash, initiator: request.initiator,
      provenance: JSON.stringify(request.provenance), taskId: request.provenance.taskId ?? null,
      parentRunId: request.provenance.parentRunId ?? null, deliveryClass: request.deliveryClass,
      snapshotId: input.snapshotId, attemptId: input.attemptId, at: input.admittedAt,
      deadlineAt: request.deadlineAt ?? null });
  db.prepare(`INSERT INTO run_attempts
    (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id,deadline_at)
    VALUES (:attemptId,:runId,1,'prepared',0,:provider,:modelId,:snapshotId,:deadlineAt)`)
    .run({ attemptId: input.attemptId, runId: input.runId, provider: input.provider,
      modelId: input.modelId, snapshotId: input.snapshotId, deadlineAt: request.deadlineAt ?? null });
}

function reuseAdmission(db: Database, row: Record<string, unknown>, requestHash: string): RunAdmissionResult {
  if (row.request_hash !== requestHash) throw new Error("RUN_IDEMPOTENCY_CONFLICT");
  const run = readRunRow(row);
  if (!run.activeAttemptId) throw new Error("RUN_ATTEMPT_MISSING");
  return { run, attempt: readAttemptById(db, run.activeAttemptId), reused: true };
}

function settle(db: Database, status: RunStatusResult, input: {
  runId: string;
  attemptId: string;
  outcome: RunOutcome;
  retryability: Retryability;
  summary?: string;
  errorCode?: string;
  at?: string;
}): RunStatusResult {
  const at = input.at ?? new Date().toISOString();
  const target = status.run.state === "cancel_requested" && input.outcome !== "outcome_unknown"
    ? "cancelled"
    : input.outcome;
  if (!legalTerminalTransition(status.run.state, target)) throw new Error("RUN_INVALID_TRANSITION");
  const attempt = activeAttempt(status);
  if (attempt.attemptId !== input.attemptId) return status;
  const attemptTarget = target === "skipped" ? "failed" : target;
  const receiptId = randomUUID();
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
    db.prepare(`INSERT INTO run_receipts
      (receipt_id,run_id,state,outcome,retryability,reason,action,attempt_count,snapshot_id,summary,created_at,updated_at)
      VALUES (:receiptId,:runId,:state,:outcome,:retryability,:reason,NULL,:attemptCount,:snapshotId,:summary,:at,:at)`)
      .run({ receiptId, runId: input.runId, state: target, outcome: target,
        retryability: input.retryability, reason: input.summary ?? null, attemptCount: status.attempts.length,
        snapshotId: status.run.snapshot.snapshotId, summary: input.summary ?? null, at });
  });
  return readStatus(db, input.runId);
}

function updateRun(db: Database, run: Run, input: {
  state: Run["state"];
  operationPhase: Run["operationPhase"];
  at: string;
}): void {
  const changed = db.prepare(`UPDATE runs SET state=:state,state_version=state_version+1,
    operation_phase=:operationPhase,started_at=CASE WHEN :state='running' AND started_at IS NULL THEN :at
    ELSE started_at END,updated_at=:at WHERE run_id=:runId AND state_version=:version`)
    .run({ ...input, runId: run.runId, version: run.stateVersion });
  if (changed.changes !== 1) throw new Error("RUN_STALE_VERSION");
}

function updateAttempt(db: Database, attempt: Attempt, input: {
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

function legalTerminalTransition(from: Run["state"], to: RunOutcome): boolean {
  if (from === "queued") return ["skipped", "cancelled", "failed", "deadline_exceeded"].includes(to);
  if (from === "cancel_requested") return to === "cancelled" || to === "outcome_unknown";
  return ["running", "waiting", "recovering"].includes(from);
}

function legalAttemptTerminal(from: Attempt["state"], to: Attempt["state"]): boolean {
  if (from === "prepared") return ["failed", "cancelled", "deadline_exceeded"].includes(to);
  return ["intent_committed", "effect_running", "settling"].includes(from)
    && ["completed", "failed", "cancelled", "deadline_exceeded", "outcome_unknown"].includes(to);
}

function activeAttempt(status: RunStatusResult): Attempt {
  const attempt = status.attempts.find((item) => item.attemptId === status.run.activeAttemptId);
  if (!attempt) throw new Error("RUN_ATTEMPT_MISSING");
  return attempt;
}

function readStatus(db: Database, runId: string): RunStatusResult {
  const run = readRunById(db, runId);
  const attempts = db.prepare(`SELECT a.*,s.manifest_digest,s.schema_version FROM run_attempts a
    JOIN run_snapshots s ON s.snapshot_id=a.snapshot_id WHERE a.run_id=:id ORDER BY a.ordinal`)
    .all({ id: runId }).map(readAttemptRow);
  const receiptRow = db.prepare(`SELECT rr.*,s.manifest_digest,s.schema_version FROM run_receipts rr
    JOIN run_snapshots s ON s.snapshot_id=rr.snapshot_id WHERE rr.run_id=:id`).get({ id: runId });
  const receipt = receiptRow ? readReceiptRow(receiptRow) : undefined;
  return RunStatusResultSchema.parse({ run, attempts, ...(receipt ? { receipt } : {}) });
}

function readRunById(db: Database, runId: string): Run {
  const row = db.prepare(`SELECT r.*,s.manifest_json FROM runs r JOIN run_snapshots s
    ON s.snapshot_id=r.snapshot_id WHERE r.run_id=:id`).get({ id: runId });
  if (!row) throw new Error("RUN_NOT_FOUND");
  return readRunRow(row);
}

function readRunByIdempotency(db: Database, key: string): Record<string, unknown> | undefined {
  return db.prepare(`SELECT r.*,s.manifest_json FROM runs r JOIN run_snapshots s
    ON s.snapshot_id=r.snapshot_id WHERE r.idempotency_key=:key`).get({ key });
}

function readAttemptById(db: Database, attemptId: string): Attempt {
  const row = db.prepare(`SELECT a.*,s.manifest_digest,s.schema_version FROM run_attempts a
    JOIN run_snapshots s ON s.snapshot_id=a.snapshot_id WHERE a.attempt_id=:id`).get({ id: attemptId });
  if (!row) throw new Error("RUN_ATTEMPT_MISSING");
  return readAttemptRow(row);
}
