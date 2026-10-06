/**
 * INPUT:  live transition ownership and previously stored actual native abort outcomes for every Bank
 * OUTPUT: atomic explicit cancellation of undispatched queued intents and a factual source-release resolution
 * POS:    core/db — never assumes an unknown native write was cancelled; source binding is reconstructed separately
 */
import { MemoryTransitionResolutionSchema, type MemoryTransitionResolution } from "@taki/shared";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { readTransitionNativeRelease } from "./memory-transition-native-outcome.ts";
import { requireTransitionLease, type TransitionLease } from "./memory-transition-repo.ts";
import { readTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import { readQueueExecution, readQueueOutcome, readTransitionQueue, settleQueueIntent } from "./memory-transition-queue-repo.ts";
import { readTransitionResolution, resolveTransition } from "./memory-transition-recovery-repo.ts";
import type { Database } from "./sqlite.ts";

export function abortMemoryTransition(db: Database, input: { lease: TransitionLease; now: string; failed?: boolean }): MemoryTransitionResolution {
  const existing = readTransitionResolution(db, input.lease.operationId);
  if (existing) return existing;
  let resolution: MemoryTransitionResolution | undefined;
  db.transaction(() => {
    const attempt = requireTransitionLease(db, input);
    if (attempt.cutoffSequence === null || readTransitionReceipt(db, attempt.transitionId)) invalid();
    const release = readTransitionNativeRelease(db, input);
    if (release.disposition !== "source-aborted") invalid();
    for (const intent of readTransitionQueue(db, attempt.transitionId)) {
      if (readQueueExecution(db, intent.intentId)) throw new Error("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
      const outcome = readQueueOutcome(db, intent.intentId);
      if (outcome && outcome.status !== "cancelled") invalid();
      if (!outcome) settleQueueIntent(db, { ...input, outcome: { status: "cancelled", intentId: intent.intentId, settledAt: input.now } });
    }
    const body = { version: 1 as const, operationId: attempt.operationId, transitionId: attempt.transitionId, release,
      result: { kind: "transition" as const, transitionId: attempt.transitionId, receiptId: null, authorityCommitted: false, runtime: "source" as const,
        queue: "settled" as const, outcome: input.failed ? "failed" as const : "cancelled" as const,
        errorCode: input.failed ? "MEMORY_TRANSITION_UNAVAILABLE" as const : null } };
    resolution = MemoryTransitionResolutionSchema.parse({ ...body, resolutionId: canonicalPayloadHash(["taki-transition-resolution.v1", body]) });
    resolveTransition(db, { ...input, resolution });
  });
  if (!resolution) invalid(); return resolution;
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
