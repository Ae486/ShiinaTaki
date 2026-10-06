/**
 * INPUT: selected authority, original attempt/receipt and local operation/configuration rows.
 * OUTPUT: closed, read-only preview/recovery availability; no capability probe or candidate construction.
 * POS: core/memory/transitions — shares admission predicates; previews still verify complete current evidence.
 */
import type { MemoryTransitionActionReason, MemoryTransitionIntent } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { readTransitionAttempt, readTransitionIntent, assertTransitionPredecessor } from "../../db/memory-transition-repo.ts";
import { readTransitionReceipt } from "../../db/memory-transition-evidence-repo.ts";
import { hasEmergencyStorage, transitionIsQuarantined } from "../../db/memory-transition-emergency-quarantine.ts";

/** Read the selected marker and its identity joins, without rebuilding the corpus for each history row.
 * This projection cannot authorize admission: preview/plan/publication keep their independent full proofs. */
export function transitionOperatorSelection(db: Database) {
  const marker = db.prepare("SELECT mode,active_epoch_id,provider_lineage_id,transition_receipt_id FROM memory_authority_selection WHERE singleton=1").get();
  if (!marker) throw new Error("MEMORY_TRANSITION_UNAVAILABLE");
  const epochId = marker.active_epoch_id == null ? null : String(marker.active_epoch_id);
  if (epochId) {
    const epoch = db.prepare(`SELECT e.provider_id,e.provider_lineage_id FROM canonical_memory_authority_state s JOIN canonical_memory_authority_epochs e
      ON e.epoch_id=s.active_epoch_id WHERE s.singleton=1 AND e.epoch_id=:epoch AND e.status='active'`).get({ epoch: epochId });
    if (!epoch || (epoch.provider_id === "local" ? "canonical-local" : "hindsight") !== marker.mode) throw new Error("MEMORY_TRANSITION_STALE");
    if (marker.transition_receipt_id) {
      const row = db.prepare(`SELECT p.transition_id FROM memory_transition_publications p
        JOIN memory_transition_receipts r USING(transition_id) WHERE p.receipt_id=:receipt AND r.receipt_id=:receipt`).get({ receipt: marker.transition_receipt_id });
      const receipt = row ? readTransitionReceipt(db, String(row.transition_id)) : undefined;
      if (!receipt || receipt.newEpochId !== epochId || receipt.identity.targetProvider !== epoch.provider_id
        || receipt.identity.targetLineageId !== epoch.provider_lineage_id || marker.provider_lineage_id !== epoch.provider_lineage_id) {
        throw new Error("MEMORY_TRANSITION_STALE");
      }
    }
  }
  return { epochId, mode: String(marker.mode) };
}

export function selectedForeignBranch(db: Database): boolean {
  const selected = transitionOperatorSelection(db);
  return !!selected.epochId && hasEmergencyStorage(db)
    && !!db.prepare("SELECT 1 FROM memory_transition_foreign_branches WHERE target_epoch_id=:epoch").get({ epoch: selected.epochId });
}

/** A terminal/unknown operation can still own a nonterminal fence obligation. Only explicit recovery may continue it. */
export function pendingSelectedTransitions(db: Database, epochId: string | null) {
  if (!epochId) return [];
  return db.prepare("SELECT transition_id FROM memory_transition_attempts WHERE phase<>'terminal'").all().flatMap((row) => {
    const transitionId = String(row.transition_id);
    if (transitionIsQuarantined(db, transitionId)) return [];
    const intent = readTransitionIntent(db, transitionId); const receipt = readTransitionReceipt(db, transitionId);
    return intent && (receipt?.newEpochId ?? intent.request.expected.predecessorEpochId) === epochId ? [intent.request.kind] : [];
  });
}

/** Completed historical targets and quarantined predecessors cannot offer recovery into the current authority. */
export function transitionRecoveryReason(db: Database, intent: MemoryTransitionIntent, now: string): MemoryTransitionActionReason | null {
  if (transitionIsQuarantined(db, intent.transitionId)) return "quarantined";
  if (intent.request.kind !== "transition.emergency-local" && selectedForeignBranch(db)) return "foreign-branch";
  const attempt = readTransitionAttempt(db, intent.transitionId);
  if (!attempt || attempt.phase === "terminal") return "settled";
  const original = db.prepare("SELECT terminal_at FROM memory_operations WHERE operation_id=:id").get({ id: intent.operationId });
  const executor = db.prepare("SELECT terminal_at FROM memory_operations WHERE operation_id=:id").get({ id: attempt.operationId });
  if (!original?.terminal_at || !executor?.terminal_at) return "busy";
  if (Date.parse(attempt.leaseUntil) > Date.parse(now)) return "lease-active";
  const receipt = readTransitionReceipt(db, intent.transitionId);
  const selected = transitionOperatorSelection(db);
  if (selected.epochId !== (receipt?.newEpochId ?? intent.request.expected.predecessorEpochId)) return "stale";
  try { if (!receipt) assertTransitionPredecessor(db, intent); }
  catch { return "stale"; }
  return null;
}

/** Never forward exception text, endpoint details or credentials through operator errors. */
export function transitionOperatorReason(cause: unknown): MemoryTransitionActionReason {
  const code = cause instanceof Error ? cause.message.match(/^[A-Z_]+(?=:|$)/)?.[0] : undefined;
  switch (code) {
    case "HINDSIGHT_EXTENSION_UNSUPPORTED": return "capability";
    case "MEMORY_TRANSITION_STALE": return "stale";
    case "MEMORY_TRANSITION_CONFLICT": case "MEMORY_OPERATION_BUSY": return "busy";
    case "MEMORY_TRANSITION_LEASE_LOST": return "lease-active";
    case "MEMORY_TRANSITION_CONFIGURATION": return "configuration";
    case "MEMORY_TRANSITION_FOREIGN_BRANCH": return "foreign-branch";
    case "MEMORY_TRANSITION_OUTCOME_UNKNOWN": return "unknown";
    default: return "unavailable";
  }
}
