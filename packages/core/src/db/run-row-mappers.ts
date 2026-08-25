/**
 * INPUT:  SQLite rows produced by the Run aggregate repositories
 * OUTPUT: strict Shared Run, Attempt, and Receipt values plus deterministic redaction-safe digests
 * POS:    core/db — row-validation helpers; no lifecycle decisions or database writes
 */
import { createHash } from "node:crypto";
import {
  AttemptSchema,
  RunReceiptSchema,
  RunSchema,
  RunSnapshotSchema,
  type Attempt,
  type Run,
  type RunReceipt,
} from "@taki/shared";

export function digestRunValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function readRunRow(row: Record<string, unknown>): Run {
  const snapshot = RunSnapshotSchema.parse(JSON.parse(String(row.manifest_json)));
  return RunSchema.parse({ runId: row.run_id, characterId: row.character_id,
    triggerRequestId: row.trigger_request_id, idempotencyKey: row.idempotency_key, initiator: row.initiator,
    provenance: JSON.parse(String(row.provenance_json)), taskId: row.task_id ?? undefined,
    parentRunId: row.parent_run_id ?? undefined, deliveryClass: row.delivery_class, state: row.state,
    stateVersion: row.state_version, operationPhase: row.operation_phase,
    snapshot: { snapshotId: row.snapshot_id, manifestDigest: snapshot.manifestDigest,
      schemaVersion: snapshot.schemaVersion }, activeAttemptId: row.active_attempt_id ?? undefined,
    queuedAt: row.queued_at, budgetLimit: row.budget_limit == null ? undefined : Number(row.budget_limit),
    budgetUsed: row.budget_used == null ? 0 : Number(row.budget_used), startedAt: row.started_at ?? undefined, deadlineAt: row.deadline_at ?? undefined,
    terminalAt: row.terminal_at ?? undefined, outcome: row.outcome ?? undefined,
    retryability: row.retryability ?? undefined, receiptId: row.receipt_id ?? undefined });
}

export function readAttemptRow(row: Record<string, unknown>): Attempt {
  return AttemptSchema.parse({ attemptId: row.attempt_id, runId: row.run_id, ordinal: row.ordinal,
    state: row.state, stateVersion: row.state_version, provider: row.provider, modelId: row.model_id,
    snapshot: { snapshotId: row.snapshot_id, manifestDigest: row.manifest_digest,
      schemaVersion: row.schema_version }, retryReason: row.retry_reason ?? undefined,
    startedAt: row.started_at ?? undefined, deadlineAt: row.deadline_at ?? undefined,
    settledAt: row.settled_at ?? undefined, outcome: row.outcome ?? undefined,
    retryability: row.retryability ?? undefined, resultSummary: row.result_summary ?? undefined,
    errorCode: row.error_code ?? undefined });
}

export function readReceiptRow(row: Record<string, unknown>): RunReceipt {
  return RunReceiptSchema.parse({ receiptId: row.receipt_id, runId: row.run_id, state: row.state,
    outcome: row.outcome ?? undefined, retryability: row.retryability ?? undefined,
    reason: row.reason ?? undefined, action: row.action ?? undefined, attemptCount: row.attempt_count,
    snapshot: { snapshotId: row.snapshot_id, manifestDigest: row.manifest_digest,
      schemaVersion: row.schema_version }, summary: row.summary ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at });
}
