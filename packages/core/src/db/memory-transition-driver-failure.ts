/**
 * INPUT:  an admitted operation identity and a factual unresolved driver result
 * OUTPUT: immutable per-operation failure evidence, including failures before executor claim
 * POS:    core/db — makes failed recovery observable without rewriting the original transition result
 */
import { MemoryTransitionResultSchema, type MemoryTransitionResult } from "@taki/shared";
import { readTransitionIntent } from "./memory-transition-repo.ts";
import { readTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import { readTransitionRecovery } from "./memory-transition-recovery-repo.ts";
import { canonicalJson } from "../memory/legacy-migration/legacy-identities.ts";
import type { Database } from "./sqlite.ts";

export function readTransitionDriverFailure(db: Database, operationId: string): MemoryTransitionResult | undefined {
  const row = db.prepare("SELECT transition_id,result_json FROM memory_transition_driver_failures WHERE operation_id=:id").get({ id: operationId });
  if (!row) return undefined;
  const result = MemoryTransitionResultSchema.parse(JSON.parse(String(row.result_json)));
  const intent = readTransitionIntent(db, result.transitionId); const recovery = readTransitionRecovery(db, operationId);
  if (!intent || row.transition_id !== intent.transitionId || result.outcome !== "outcome_unknown"
    || (recovery ? recovery.transitionId !== intent.transitionId : intent.operationId !== operationId)) invalid();
  return result;
}
export function recordTransitionDriverFailure(db: Database, operationId: string, raw: MemoryTransitionResult): void {
  const result = MemoryTransitionResultSchema.parse(raw);
  db.transaction(() => {
    const prior = readTransitionDriverFailure(db, operationId);
    if (prior) { if (canonicalJson(prior) !== canonicalJson(result)) invalid(); return; }
    const intent = readTransitionIntent(db, result.transitionId); const recovery = readTransitionRecovery(db, operationId);
    const receipt = readTransitionReceipt(db, result.transitionId);
    if (!intent || (recovery ? recovery.transitionId !== intent.transitionId : intent.operationId !== operationId)
      || result.outcome !== "outcome_unknown" || result.receiptId !== (receipt?.receiptId ?? null)) invalid();
    db.prepare("INSERT INTO memory_transition_driver_failures VALUES(:operation,:transition,:json)")
      .run({ operation: operationId, transition: intent.transitionId, json: canonicalJson(result) });
  });
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
