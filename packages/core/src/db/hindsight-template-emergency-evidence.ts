/**
 * INPUT:  the old Hindsight epoch and its durable template plans, admissions and effect evidence
 * OUTPUT: offline candidate operation IDs and complete hashed unknown-effect inventory
 * POS:    W6 quarantine companion — terminal generic rows do not erase an unpublished template hold
 */
import type { MemoryEmergencyUnknownEffect } from "@taki/shared";
import { hasTemplateExecutionStorage } from "../memory/hindsight/template-lifecycle/template-execution-reads.ts";
import { emergencyRowHash } from "./memory-transition-row-hash.ts";
import type { Database } from "./sqlite.ts";

const TABLE_KEYS = [
  ["hindsight_template_plans", "plan_id"], ["hindsight_template_admissions", "request_id"],
  ["hindsight_template_executors", "plan_id"], ["hindsight_template_dispatches", "dispatch_id"],
  ["hindsight_template_bank_receipts", "request_id"], ["hindsight_template_observations", "observation_id"],
  ["hindsight_template_holds", "plan_id"], ["hindsight_template_publications", "publication_id"],
] as const;

export function pendingTemplateQuarantineOperations(db: Database, epochId: string): string[] {
  if (!hasTemplateExecutionStorage(db)) return [];
  const admitted = db.prepare(`SELECT a.operation_id FROM hindsight_template_admissions a
    JOIN hindsight_template_holds h USING(plan_id) WHERE h.epoch_id=:epoch AND h.state='active' ORDER BY a.operation_id`)
    .all({ epoch: epochId }).map((row) => String(row.operation_id));
  const reserved = unresolvedReservations(db, epochId).map((row) => String(row.operation_id));
  return [...new Set([...admitted, ...reserved])].sort();
}

export function quarantineTemplateHolds(db: Database, epochId: string): void {
  if (!hasTemplateExecutionStorage(db)) return;
  // 059's transition trigger requires the real W6 quarantine row to exist already.
  db.prepare("UPDATE hindsight_template_holds SET state='quarantined' WHERE epoch_id=:epoch AND state='active'").run({ epoch: epochId });
}

export function readTemplateEmergencyEffects(db: Database, epochId: string): MemoryEmergencyUnknownEffect[] {
  if (!hasTemplateExecutionStorage(db)) return [];
  const effects: MemoryEmergencyUnknownEffect[] = TABLE_KEYS.flatMap(([table, key]) => db.prepare(`SELECT t.* FROM ${table} t
    JOIN hindsight_template_holds h ON h.plan_id=t.plan_id WHERE h.epoch_id=:epoch
      AND (h.state IN ('active','quarantined') OR EXISTS(SELECT 1 FROM hindsight_template_admissions a
        JOIN memory_transition_emergency_quarantine q ON q.operation_id=a.operation_id WHERE a.plan_id=h.plan_id))
    ORDER BY t.${key}`).all({ epoch: epochId }).map((row) => ({ table, epochId,
    recordKey: JSON.stringify([row[key]]), rowHash: emergencyRowHash(row), disposition: "held-unknown" as const })));
  for (const row of unresolvedReservations(db, epochId)) effects.push({ table: "hindsight_template_bank_reservations", epochId,
    recordKey: JSON.stringify([row.reservation_id]), rowHash: emergencyRowHash(row), disposition: "held-unknown" });
  return effects;
}

/** A create can lose its reply before an Apply plan exists. Preserve that original operation as unknown too. */
function unresolvedReservations(db: Database, epochId: string) {
  return db.prepare(`SELECT r.* FROM hindsight_template_bank_reservations r WHERE r.epoch_id=:epoch
    AND (EXISTS(SELECT 1 FROM memory_transition_emergency_quarantine q WHERE q.operation_id=r.operation_id)
      OR NOT EXISTS(SELECT 1 FROM hindsight_template_plans p JOIN hindsight_template_holds h USING(plan_id)
        WHERE p.epoch_id=r.epoch_id AND json_extract(p.document_json,'$.guard.provisionBankId')=r.bank_id AND h.state='published'))
    ORDER BY r.reservation_id`).all({ epoch: epochId });
}
