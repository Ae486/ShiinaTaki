import { QueueListResultSchema, type QueueListParams, type QueueListResult, type RecoveryClassification, type RunEvent, type RunStatusResult } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import type { RunEventRepo } from "./run-event-repo.ts";
import type { RunEventLiveBus } from "./run-event-live.ts";
import { readStatus } from "./run-readers.ts";
import { boundText, lifecycleEvent } from "./run-event-factory.ts";

export function listQueue(db: Database, input: Partial<QueueListParams> & { now?: string } = {}): QueueListResult {
  const limit = Math.min(input.limit ?? 50, 100); const at = input.now ?? new Date().toISOString();
  const params: Record<string, string | number | null> = { limit, cursor: input.cursor ?? "" };
  const where = ["r.state IN ('queued','running','waiting','recovering','cancel_requested')", "r.run_id > :cursor"];
  if (input.characterId) { where.push("r.character_id=:characterId"); params.characterId = input.characterId; }
  if (input.state) { where.push("r.state=:state"); params.state = input.state; }
  params.limit = limit + 1;
  const rows = db.prepare(`SELECT r.run_id,r.character_id,r.state,r.queued_at,r.deadline_at,r.initiator,r.active_attempt_id,r.provenance_json FROM runs r WHERE ${where.join(" AND ")} ORDER BY r.run_id LIMIT :limit`).all(params) as Record<string, unknown>[];
  const page = rows.slice(0, limit);
  const entries = page.map((row) => ({ runId: String(row.run_id), characterId: String(row.character_id), state: row.state, queuedAt: String(row.queued_at), ...(row.deadline_at ? { deadlineAt: String(row.deadline_at) } : {}), initiator: row.initiator, attemptId: row.active_attempt_id ? String(row.active_attempt_id) : undefined, ageMs: Math.min(86_400_000_000, Math.max(0, Date.parse(at) - Date.parse(String(row.queued_at)))), provenance: JSON.parse(String(row.provenance_json)) }));
  return QueueListResultSchema.parse({ entries, ...(rows.length > limit ? { nextCursor: String(page.at(-1)?.run_id) } : {}) });
}

export function listRecoverableRuns(db: Database, limit = 100): string[] {
  const rows = db.prepare("SELECT run_id FROM runs WHERE state NOT IN ('completed','failed','cancelled','skipped','deadline_exceeded','outcome_unknown') ORDER BY updated_at LIMIT :limit").all({ limit: Math.min(limit, 1000) }) as Array<{ run_id: string }>;
  return rows.map((row) => row.run_id);
}

export function classifyRecovery(input: { db: Database; eventRepo: RunEventRepo; liveBus?: RunEventLiveBus; runId: string; classification: RecoveryClassification; reason?: string; at: string; generation: string }): RunStatusResult {
  const status = readStatus(input.db, input.runId);
  const target = input.classification === "resumable_preparation" ? "queued" : input.classification === "waiting_for_authority" ? "waiting" : "recovering";
  const prior = input.db.prepare("SELECT recovery_classification,recovery_generation,state FROM runs WHERE run_id=:runId").get({ runId: input.runId }) as { recovery_classification?: string | null; recovery_generation?: string | null; state?: string } | undefined;
  if (prior?.recovery_classification === input.classification && prior.state === target) {
    if (prior.recovery_generation !== input.generation) input.db.prepare("UPDATE runs SET recovery_generation=:generation,recovered_at=:at,updated_at=:at WHERE run_id=:runId").run({ generation: input.generation, at: input.at, runId: input.runId });
    return readStatus(input.db, input.runId);
  }
  const code = input.classification === "deadline_exceeded" ? "deadline_exceeded" : input.classification === "budget_exceeded" ? "budget_exceeded" : input.classification === "reconciliation_required" ? "reconciliation_required" : undefined;
  let committed: RunEvent[] = [];
  input.db.transaction(() => {
    const changed = input.db.prepare("UPDATE runs SET state=:state,operation_phase=:phase,state_version=state_version+1,recovery_generation=:generation,recovery_classification=:classification,recovered_at=:at,updated_at=:at WHERE run_id=:runId AND state_version=:version AND state NOT IN ('completed','failed','cancelled','skipped','deadline_exceeded','outcome_unknown')").run({ runId: input.runId, version: status.run.stateVersion, state: target, phase: target === "waiting" ? "waiting" : target === "recovering" ? "recovering" : "admitted", generation: input.generation, classification: input.classification, at: input.at });
    if (changed.changes === 1) committed = [input.eventRepo.append(lifecycleEvent({ runId: input.runId, kind: "recovery.classified", occurredAt: input.at, payload: { kind: "recovery.classified", state: target, classification: input.classification, ...(input.reason ? { reason: boundText(input.reason, 1000) } : {}), ...(code ? { errorCode: code } : {}) } }))];
  });
  if (committed.length > 0) {
    try { input.liveBus?.publish(committed); } catch { /* observers cannot alter committed recovery truth */ }
  }
  return readStatus(input.db, input.runId);
}
