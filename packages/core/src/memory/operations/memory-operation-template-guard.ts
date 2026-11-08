/**
 * INPUT:  active durable template holds, the selected authority epoch and a new operation request
 * OUTPUT: fail-closed exclusion that survives generic failed/unknown operation settlement
 * POS:    operation admission — the existing W6 handler still validates every emergency exception
 */
import type { MemoryOperationRequest } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { readCurrentMemoryAuthorityIdentity } from "../legacy-migration/legacy-activation-repo.ts";
import { activeTemplateHold, hasTemplateExecutionStorage } from "../hindsight/template-lifecycle/template-execution-reads.ts";
import { MemoryOperationRefusal } from "./memory-operation-contract.ts";

export function assertTemplateOperationAdmission(db: Database, request: MemoryOperationRequest): void {
  // Admission already owns the synchronous writer transaction. Without an active hold,
  // do not create a second authority-proof boundary ahead of the transition owner's shared context.
  if (!hasTemplateExecutionStorage(db)
    || !db.prepare("SELECT 1 FROM hindsight_template_holds WHERE state='active' LIMIT 1").get()) return;
  const selected = readCurrentMemoryAuthorityIdentity(db);
  if (selected.mode !== "hindsight" || !selected.epochId) return;
  const hold = activeTemplateHold(db, selected.epochId);
  if (!hold || request.kind === "template.recover" && request.planId === hold.planId) return;
  // No hold can disable offline takeover. W6 verifies inventory and quarantines the old epoch
  // in this same transaction before the newly admitted emergency operation becomes visible.
  if (request.kind === "transition.emergency-local" && !request.recovery) return;
  throw new MemoryOperationRefusal("MEMORY_TEMPLATE_HOLD", hold.originalOperationId);
}
