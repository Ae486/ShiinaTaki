/**
 * INPUT:  a real Local provider refusal with the exact reserved target request and normalized command
 * OUTPUT: immutable bounded non-effect evidence for known Local validation/CAS refusals
 * POS:    core/db — only positive synchronous Local refusals; unknown and native effects require their own receipts
 */
import { z } from "zod";
import type { MemoryResult, MemoryTransitionQueueExecution } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { readCanonicalReceipt } from "./canonical-memory-maintenance-storage.ts";
import { readQueueExecution } from "./memory-transition-queue-repo.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import type { transitionTargetCommand } from "../memory/transitions/transition-queue-mapping.ts";

// These Local errors are raised before mutation or after its SQLite transaction rolls back. Generic/internal,
// integrity and unknown errors are excluded: their names do not prove that an effect did not commit.
const RefusalCode = z.enum(["MEMORY_INVALID_REQUEST", "MEMORY_CAPABILITY_UNSUPPORTED", "MEMORY_REVISION_MISMATCH",
  "MEMORY_NOT_FOUND", "MEMORY_AUTHORITY_MISMATCH", "MEMORY_OPERATION_CANCELLED"]);
const Refusal = z.strictObject({ domain: z.literal("taki-transition-local-refusal.v1"),
  executionHash: z.string().regex(/^[a-f0-9]{64}$/), commandHash: z.string().regex(/^[a-f0-9]{64}$/), errorCode: RefusalCode });
interface RefusalInput { execution: MemoryTransitionQueueExecution; command: ReturnType<typeof transitionTargetCommand> }

export function recordTransitionLocalRefusal(db: Database, input: RefusalInput & { result: MemoryResult<unknown> }): void {
  const { result, execution } = input;
  if (result.ok || result.providerId !== "local" || result.requestId !== execution.targetRequestId
    || result.authorityEpochId !== execution.targetEpochId || !RefusalCode.safeParse(result.error.code).success) return;
  const refusal = Refusal.parse({ domain: "taki-transition-local-refusal.v1", executionHash: transitionLocalHash(execution),
    commandHash: transitionLocalHash(input.command), errorCode: result.error.code });
  db.transaction(() => {
    if (readCanonicalReceipt(db, execution.targetEpochId, execution.targetRequestId)
      || transitionLocalHash(readQueueExecution(db, execution.intentId)) !== refusal.executionHash) invalid();
    const prior = readTransitionLocalRefusal(db, input);
    if (prior) { if (transitionLocalHash(prior) !== transitionLocalHash(refusal)) invalid(); return; }
    db.prepare("INSERT INTO memory_transition_target_refusals VALUES(:id,:json)")
      .run({ id: execution.targetRequestId, json: JSON.stringify(refusal) });
  });
}

export function readTransitionLocalRefusal(db: Database, input: RefusalInput) {
  const row = db.prepare("SELECT refusal_json FROM memory_transition_target_refusals WHERE target_request_id=:id")
    .get({ id: input.execution.targetRequestId });
  if (!row) return undefined;
  const refusal = Refusal.parse(JSON.parse(String(row.refusal_json)));
  if (refusal.executionHash !== transitionLocalHash(input.execution) || refusal.commandHash !== transitionLocalHash(input.command)
    || readCanonicalReceipt(db, input.execution.targetEpochId, input.execution.targetRequestId)) invalid();
  return refusal;
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
