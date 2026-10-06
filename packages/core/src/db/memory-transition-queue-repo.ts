/**
 * INPUT:  typed captured writes, persisted admission boundary, and fresh target execution identities
 * OUTPUT: bounded durable queued acknowledgements, immutable dispatch reservations and factual results
 * POS:    core/db — custody only; W4 resolves mappings and executes through fresh contexts, never old closures
 */
import { randomUUID } from "node:crypto";
import { MemoryTransitionQueuedIntentSchema, MemoryTransitionQueueExecutionSchema, MemoryTransitionQueueOutcomeSchema,
  type MemoryTransitionQueuedIntent, type MemoryTransitionQueueExecution, type MemoryTransitionQueueOutcome } from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { assertTransitionPredecessor, readTransitionAttempt, readTransitionIntent, requireTransitionLease, type TransitionLease } from "./memory-transition-repo.ts";
import { readTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import type { Database } from "./sqlite.ts";

export type QueueAdmission = Omit<MemoryTransitionQueuedIntent, "version" | "intentId" | "sequence" | "replayId" | "commandHash" | "admittedAt">;

export function readTransitionQueue(db: Database, transitionId: string): MemoryTransitionQueuedIntent[] {
  return db.prepare("SELECT intent_id,sequence,intent_json FROM memory_transition_queue WHERE transition_id=:id ORDER BY sequence").all({ id: transitionId })
    .map((row) => {
      const value = MemoryTransitionQueuedIntentSchema.parse(JSON.parse(String(row.intent_json)));
      if (value.intentId !== row.intent_id || value.sequence !== row.sequence || value.transitionId !== transitionId
        || value.commandHash !== canonicalPayloadHash(["taki-transition-command.v1", admissionFields(value)])) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
      return value;
    });
}
export function readQueueOutcome(db: Database, intentId: string): MemoryTransitionQueueOutcome | undefined {
  const row = db.prepare("SELECT outcome_json FROM memory_transition_queue_results WHERE intent_id=:id").get({ id: intentId })
    ?? db.prepare("SELECT outcome_json FROM memory_transition_queue_observations WHERE intent_id=:id ORDER BY rowid DESC LIMIT 1").get({ id: intentId });
  return row ? MemoryTransitionQueueOutcomeSchema.parse(JSON.parse(String(row.outcome_json))) : undefined;
}
export function readQueueExecution(db: Database, intentId: string): MemoryTransitionQueueExecution | undefined {
  const row = db.prepare("SELECT execution_json FROM memory_transition_queue_executions WHERE intent_id=:id").get({ id: intentId });
  return row ? MemoryTransitionQueueExecutionSchema.parse(JSON.parse(String(row.execution_json))) : undefined;
}

export function enqueueTransitionWrite(db: Database, input: { admission: QueueAdmission; now: string }): MemoryTransitionQueueOutcome {
  let outcome: MemoryTransitionQueueOutcome | undefined;
  db.transaction(() => {
    const { admission, now } = input;
    const rows = readTransitionQueue(db, admission.transitionId);
    const prior = rows.find((row) => row.callerRequestId === admission.callerRequestId);
    if (prior) {
      if (canonicalJson(admissionFields(prior)) !== canonicalJson(admission)) throw new Error("MEMORY_TRANSITION_CONFLICT");
      outcome = readQueueOutcome(db, prior.intentId) ?? acknowledgement(prior);
      return;
    }
    const intent = readTransitionIntent(db, admission.transitionId);
    const attempt = readTransitionAttempt(db, admission.transitionId);
    if (!intent || !attempt || admission.sourceEpochId !== intent.request.expected.predecessorEpochId) throw new Error("MEMORY_TRANSITION_STALE");
    assertTransitionPredecessor(db, intent);
    const operation = db.prepare("SELECT state FROM memory_operations WHERE operation_id=:id").get({ id: attempt.operationId });
    const result = db.prepare("SELECT transition_id FROM memory_transition_results WHERE transition_id=:id").get({ id: attempt.transitionId });
    if (result || attempt.phase === "terminal" || operation?.state !== "running" || attempt.admissionOpenedAt === null || attempt.cutoffAt !== null || attempt.cancellationRequested
      || Date.parse(attempt.leaseUntil) <= Date.parse(now) || Date.parse(now) >= Date.parse(attempt.admissionOpenedAt) + intent.queuePolicy.admissionWindowMs) throw new Error("MEMORY_TRANSITION_CUTOFF");
    const bank = intent.request.expected.banks.find((entry) => canonicalJson(entry.scope) === canonicalJson(admission.scope));
    if (!bank || bank.sourceBankId !== admission.command.request.bankId) throw new Error("MEMORY_TRANSITION_STALE");
    const value = MemoryTransitionQueuedIntentSchema.parse({ ...admission, version: 1, intentId: randomUUID(), replayId: randomUUID(),
      sequence: rows.length + 1, commandHash: canonicalPayloadHash(["taki-transition-command.v1", admission]), admittedAt: now });
    const json = canonicalJson(value); const bytes = Buffer.byteLength(json, "utf8");
    const total = Number(db.prepare("SELECT coalesce(sum(bytes),0) AS n FROM memory_transition_queue WHERE transition_id=:id").get({ id: admission.transitionId })?.n);
    if (rows.length >= intent.queuePolicy.maxIntents || bytes > intent.queuePolicy.maxIntentBytes || total + bytes > intent.queuePolicy.maxBytes) throw new Error("MEMORY_TRANSITION_QUEUE_FULL");
    db.prepare("INSERT INTO memory_transition_queue VALUES (:id,:transition,:sequence,:caller,:replay,:bytes,:json)").run({ id: value.intentId,
      transition: value.transitionId, sequence: value.sequence, caller: value.callerRequestId, replay: value.replayId, bytes, json });
    outcome = acknowledgement(value);
  });
  if (!outcome) throw new Error("MEMORY_TRANSITION_CONFLICT");
  return outcome;
}

/** Persist before dispatch; after reply loss the same target request must be looked up, never replaced. */
export function prepareQueueExecution(db: Database, input: { lease: TransitionLease; now: string; execution: MemoryTransitionQueueExecution }): MemoryTransitionQueueExecution {
  const execution = MemoryTransitionQueueExecutionSchema.parse(input.execution);
  db.transaction(() => {
    const attempt = requireTransitionLease(db, input);
    const queue = readTransitionQueue(db, attempt.transitionId);
    const intent = queue.find((row) => row.intentId === execution.intentId);
    if (!intent || attempt.cutoffSequence === null || execution.replayId !== intent.replayId || readQueueOutcome(db, execution.intentId)) throw new Error("MEMORY_TRANSITION_CONFLICT");
    const prior = readQueueExecution(db, execution.intentId);
    if (prior) {
      if (canonicalJson(prior) !== canonicalJson(execution)) throw new Error("MEMORY_TRANSITION_CONFLICT");
      return;
    }
    // Order is global and stable, including different scopes. W4 may only advance after each factual disposition.
    if (queue.some((row) => row.sequence < intent.sequence && (!readQueueOutcome(db, row.intentId) || readQueueOutcome(db, row.intentId)?.status === "outcome_unknown"))) throw new Error("MEMORY_TRANSITION_CONFLICT");
    const receipt = readTransitionReceipt(db, attempt.transitionId);
    if (!receipt || execution.targetEpochId !== receipt.newEpochId || execution.mappingHash !== receipt.mappingHash) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    const selected = db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state WHERE singleton=1").get();
    if (selected?.active_epoch_id !== execution.targetEpochId) throw new Error("MEMORY_TRANSITION_STALE");
    db.prepare("INSERT INTO memory_transition_queue_executions VALUES (:id,:request,:json)")
      .run({ id: execution.intentId, request: execution.targetRequestId, json: canonicalJson(execution) });
  });
  return execution;
}

export function settleQueueIntent(db: Database, input: { lease: TransitionLease; now: string; outcome: MemoryTransitionQueueOutcome }): void {
  const outcome = MemoryTransitionQueueOutcomeSchema.parse(input.outcome);
  if (outcome.status === "queued" || outcome.intentId === null) throw new Error("MEMORY_TRANSITION_CONFLICT");
  const intentId = outcome.intentId;
  db.transaction(() => {
    const prior = readQueueOutcome(db, intentId);
    if (prior && prior.status !== "outcome_unknown") {
      if (canonicalJson(prior) !== canonicalJson(outcome)) throw new Error("MEMORY_TRANSITION_CONFLICT");
      return;
    }
    const attempt = requireTransitionLease(db, input);
    const intent = readTransitionQueue(db, attempt.transitionId).find((row) => row.intentId === intentId);
    if (!intent) throw new Error("MEMORY_TRANSITION_CONFLICT");
    const execution = readQueueExecution(db, intentId);
    if (outcome.status === "completed" || outcome.status === "outcome_unknown" || outcome.status === "failed") {
      if (!execution || outcome.targetRequestId !== execution.targetRequestId) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
      if (outcome.status === "completed" && outcome.result.kind !== intent.command.kind) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
      if (outcome.status === "completed" && outcome.result.kind === "mutation" && outcome.result.memoryId !== execution.targetLogicalId) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    } else if (execution) throw new Error("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
    if (outcome.status === "outcome_unknown") {
      db.prepare("INSERT INTO memory_transition_queue_observations VALUES (:observation,:id,:json) ON CONFLICT(observation_id) DO NOTHING")
        .run({ observation: canonicalPayloadHash(["taki-transition-queue-observation.v1", outcome]), id: intentId, json: canonicalJson(outcome) });
    } else db.prepare("INSERT INTO memory_transition_queue_results VALUES (:id,:json)").run({ id: intentId, json: canonicalJson(outcome) });
  });
}

function acknowledgement(value: MemoryTransitionQueuedIntent): MemoryTransitionQueueOutcome {
  return { status: "queued", transitionId: value.transitionId, intentId: value.intentId, sequence: value.sequence };
}
function admissionFields(value: MemoryTransitionQueuedIntent): QueueAdmission {
  const { transitionId, sourceEpochId, callerRequestId, provenance, scope, logicalTargetId, expectedRevision, command } = value;
  return { transitionId, sourceEpochId, callerRequestId, provenance, scope, logicalTargetId, expectedRevision, command };
}
