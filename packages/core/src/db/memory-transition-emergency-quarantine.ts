/**
 * INPUT:  a validated explicit emergency admission in the existing operation-owner transaction
 * OUTPUT: immutable old-producer quarantine and truthful unknown operation settlements
 * POS:    core/db — preserves old attempts, receipts and queues; never fabricates Native completion
 */
import type { MemoryOperation } from "@taki/shared";
import { MemoryOperationRefusal, EXCLUSIVE_MEMORY_FAMILIES } from "../memory/operations/memory-operation-contract.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { readTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import type { MemoryOperationRepo } from "./memory-operation-repo.ts";
import type { Database } from "./sqlite.ts";

/** Historical migration fixtures remain readable before the additive emergency schema is installed. */
export function hasEmergencyStorage(db: Database): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_transition_emergency_quarantine'").get();
}

export function transitionIsQuarantined(db: Database, transitionId: string): boolean {
  if (!hasEmergencyStorage(db)) return false;
  return !!db.prepare("SELECT 1 FROM memory_transition_emergency_quarantine WHERE transition_id=:id").get({ id: transitionId });
}
export function operationIsQuarantined(db: Database, operationId: string): boolean {
  if (!hasEmergencyStorage(db)) return false;
  return !!db.prepare("SELECT 1 FROM memory_transition_emergency_quarantine WHERE operation_id=:id").get({ id: operationId });
}

/** Shared by the read-only operator projection and actual admission; old Local work is never bypassed. */
export function emergencyCanQuarantineOperation(db: Database, operation: MemoryOperation, epochId: string): boolean {
  if (operation.kind.startsWith("transition.")) {
    if (operation.kind === "transition.emergency-local" || operation.producer?.kind !== "transition") return false;
    const receipt = readTransitionReceipt(db, operation.producer.transitionId);
    return receipt ? receipt.newEpochId === epochId && receipt.identity.targetProvider === "hindsight"
      : operation.authorityEpochId === epochId;
  }
  return operation.authorityEpochId === epochId && (operation.kind === "replica.sync"
    || operation.kind.startsWith("backup.") || operation.kind === "bank.provision" || operation.kind === "connection.revalidate");
}

/** Called after the first full plan and before insertAdmitted, inside its outer transaction. */
export function quarantineEmergencyProducers(db: Database, input: {
  repo: MemoryOperationRepo; emergencyOperationId: string; epochId: string; bankIds: string[]; now: string;
}): MemoryOperation[] {
  const active = input.repo.listActive();
  const belongs = (operation: MemoryOperation) => emergencyCanQuarantineOperation(db, operation, input.epochId);
  for (const operation of active) {
    const family = String(db.prepare("SELECT family FROM memory_operations WHERE operation_id=:id").get({ id: operation.operationId })?.family);
    if ((EXCLUSIVE_MEMORY_FAMILIES as readonly string[]).includes(family) && !belongs(operation)) {
      throw new MemoryOperationRefusal("MEMORY_OPERATION_BUSY", operation.operationId);
    }
  }
  // An old operation may already be unknown while its durable attempt still excludes the source.
  const pending = db.prepare(`SELECT i.operation_id FROM memory_transition_intents i
    JOIN memory_transition_attempts a USING(transition_id) WHERE a.phase<>'terminal'`).all();
  const candidates = new Map(active.filter(belongs).map((operation) => [operation.operationId, operation]));
  for (const row of pending) {
    const operation = input.repo.get(String(row.operation_id));
    if (operation && belongs(operation)) candidates.set(operation.operationId, operation);
  }
  const changed: MemoryOperation[] = [];
  for (const operation of candidates.values()) {
    if (operationIsQuarantined(db, operation.operationId)) continue;
    const transitionId = operation.producer?.kind === "transition" ? operation.producer.transitionId : null;
    db.prepare("INSERT INTO memory_transition_emergency_quarantine VALUES(:id,:transition,:emergency,:epoch,:hash,:at)")
      .run({ id: operation.operationId, transition: transitionId, emergency: input.emergencyOperationId,
        epoch: input.epochId, hash: transitionLocalHash(operation), at: input.now });
    if (operation.terminalAt === null) changed.push(input.repo.transition({ operationId: operation.operationId,
      expectedState: operation.state, patch: { state: "outcome_unknown", reason: "commitment_unknown",
        errorCode: transitionId ? "MEMORY_TRANSITION_OUTCOME_UNKNOWN" : null, result: null } }));
  }
  for (const manual of db.prepare("SELECT * FROM hindsight_replica_manual_requests WHERE state IN ('queued','claimed')").all()) {
    if (!input.bankIds.includes(String(manual.bank_id))) throw new MemoryOperationRefusal("MEMORY_OPERATION_BUSY");
    if (db.prepare("SELECT 1 FROM memory_transition_emergency_manual_quarantine WHERE request_id=:id").get({ id: String(manual.request_id) })) continue;
    db.prepare("INSERT INTO memory_transition_emergency_manual_quarantine VALUES(:id,:emergency,:epoch,:hash,:at)")
      .run({ id: String(manual.request_id), emergency: input.emergencyOperationId, epoch: input.epochId,
        hash: transitionLocalHash(manual), at: input.now });
  }
  return changed;
}
