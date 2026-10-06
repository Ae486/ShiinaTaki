/**
 * INPUT:  validated manual identities and the scheduler's captured claim and outcome
 * OUTPUT: durable per-request evidence; terminal facts remain immutable across later Bank runs
 * POS:    core/db — called inside the existing B5 scheduler transaction, never an independent executor
 */
import { MemoryReplicaRequestSchema, type MemoryReplicaRequest, type MemoryReplicaScheduledRun, type MemoryReplicaSyncState } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { canonicalJson } from "../memory/legacy-migration/legacy-identities.ts";

export function readReplicaRequest(db: Database, requestId: string): MemoryReplicaRequest | undefined {
  const stored = db.prepare("SELECT bank_id,state,state_json FROM hindsight_replica_manual_requests WHERE request_id=:id").get({ id: requestId });
  if (!stored) return undefined;
  const row = MemoryReplicaRequestSchema.parse(JSON.parse(String(stored.state_json)));
  if (row.requestId !== requestId || row.bankId !== stored.bank_id || row.state !== stored.state) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
  return row;
}

export function insertReplicaRequest(db: Database, raw: MemoryReplicaRequest): void {
  const row = MemoryReplicaRequestSchema.parse(raw);
  db.prepare("INSERT INTO hindsight_replica_manual_requests(request_id,bank_id,state,state_json) VALUES (:id,:bank,:state,:json)")
    .run({ id: row.requestId, bank: row.bankId, state: row.state, json: canonicalJson(row) });
}

export function updateReplicaRequest(db: Database, previous: MemoryReplicaRequest, raw: MemoryReplicaRequest): void {
  const row = MemoryReplicaRequestSchema.parse(raw);
  if (row.requestId !== previous.requestId || row.bankId !== previous.bankId || row.kind !== previous.kind) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
  const result = db.prepare("UPDATE hindsight_replica_manual_requests SET state=:state,state_json=:json WHERE request_id=:id AND state_json=:previous")
    .run({ state: row.state, json: canonicalJson(row), id: row.requestId, previous: canonicalJson(previous) });
  if (result.changes !== 1) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
}

export function claimReplicaRequest(db: Database, run: MemoryReplicaScheduledRun): void {
  if (!run.manualRequestId) return; // Pre-051/manual legacy claims have no invented identity.
  const row = readReplicaRequest(db, run.manualRequestId);
  if (!row || row.state !== "queued" || row.bankId !== run.lease.bankId) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
  updateReplicaRequest(db, row, { ...row, state: "claimed", claim: run.lease });
}

export function settleReplicaRequest(db: Database, run: MemoryReplicaScheduledRun, state: MemoryReplicaSyncState): void {
  if (!run.manualRequestId) return;
  const row = readReplicaRequest(db, run.manualRequestId);
  if (!row || row.state !== "claimed" || canonicalJson(row.claim) !== canonicalJson(run.lease)) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
  updateReplicaRequest(db, row, { ...row, state: state.errorCode === null ? "succeeded" : "failed",
    settledAt: state.updatedAt, errorCode: state.errorCode, nextAction: state.nextAction, lastSuccessAt: state.lastSuccessAt });
}
