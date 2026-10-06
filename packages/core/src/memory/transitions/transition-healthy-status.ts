/**
 * INPUT:  the original transition/operation evidence and pure binding availability
 * OUTPUT: factual per-Bank, queue, release and recovery progress under every selected provider
 * POS:    core/memory/transitions — read-only observation; no client, model or producer dispatch
 */
import { MemoryTransitionReadSchema, type MemoryTransitionRead } from "@taki/shared";
import { readTransitionAttempt, readTransitionIntent } from "../../db/memory-transition-repo.ts";
import { readTransitionReceipt, readTransitionResult } from "../../db/memory-transition-evidence-repo.ts";
import { readTransitionResolution } from "../../db/memory-transition-recovery-repo.ts";
import { readTransitionDriverFailure } from "../../db/memory-transition-driver-failure.ts";
import { readTransitionNativeCommand, latestTransitionNativeObservation, transitionNativeDispatched } from "../../db/memory-transition-driver-repo.ts";
import { readTransitionUndispatched } from "../../db/memory-transition-undispatched.ts";
import { readTransitionQueue, readQueueOutcome } from "../../db/memory-transition-queue-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { transitionRecoveryReason } from "./transition-operator-actions.ts";
import { assertEmergencyConfiguration, assertTransitionConfiguration } from "./transition-current-identity.ts";

export function readHealthyTransitionStatus(db: Database, input: { transitionId: string; now: string;
  ready(epochId: string, provider: "local" | "hindsight"): boolean; fingerprint?: () => string | null }): MemoryTransitionRead {
  const intent = readTransitionIntent(db, input.transitionId); if (!intent) throw new Error("MEMORY_TRANSITION_STALE");
  const attempt = readTransitionAttempt(db, intent.transitionId) ?? null;
  const receipt = readTransitionReceipt(db, intent.transitionId) ?? null;
  const result = (attempt ? readTransitionResolution(db, attempt.operationId)?.result : undefined)
    ?? readTransitionDriverFailure(db, attempt?.operationId ?? intent.operationId)
    ?? readTransitionResult(db, intent.transitionId) ?? null;
  const runtime = receipt ? input.ready(receipt.newEpochId, receipt.identity.targetProvider) ? "ready" : "unavailable"
    : (!attempt || attempt.phase === "terminal") && input.ready(intent.request.expected.predecessorEpochId, intent.request.expected.sourceProvider) ? "source" : "unavailable";
  const banks = intent.request.expected.banks.map((bank) => {
    const nativeBankId = bank.nativeBankId ?? bank.targetBankId;
    const command = nativeBankId ? readTransitionNativeCommand(db, { transitionId: intent.transitionId, bankId: nativeBankId, kind: "acquire", slot: "original" }) : undefined;
    const observation = nativeBankId ? latestTransitionNativeObservation(db, intent.transitionId, nativeBankId) : undefined;
    const undispatched = nativeBankId ? readTransitionUndispatched(db, intent.transitionId, nativeBankId) : undefined;
    return { sourceBankId: bank.sourceBankId, nativeBankId,
      dispatch: undispatched ? "never-dispatched" : command ? transitionNativeDispatched(db, command.commandId) ? "sent" : "prepared" : "unprepared",
      nativePhase: observation?.status.phase ?? null, activeWriters: observation?.status.active_writers ?? null,
      acceptedOperations: observation?.status.accepted_operations ?? null, finalProof: !!observation?.status.proof,
      finalized: !!observation?.status.outcome || !!undispatched };
  });
  const queue = readTransitionQueue(db, intent.transitionId);
  const outcomes = queue.map((item) => readQueueOutcome(db, item.intentId));
  let recoverable = transitionRecoveryReason(db, intent, input.now) === null;
  if (recoverable) {
    try {
      if (intent.request.kind === "transition.emergency-local") assertEmergencyConfiguration(db, intent.request.expected);
      else if (input.fingerprint) assertTransitionConfiguration(db, intent.request.expected, input.fingerprint());
    } catch { recoverable = false; }
  }
  return MemoryTransitionReadSchema.parse({ transition: { intent, attempt, receipt, result,
    available: runtime !== "unavailable", blocking: runtime === "unavailable" ? ["MEMORY_TRANSITION_OUTCOME_UNKNOWN"] : [] },
    progress: { phase: attempt?.phase ?? null, banks, runtime,
      queue: { admitted: queue.length, settled: outcomes.filter((value) => value && value.status !== "outcome_unknown").length,
        unknown: outcomes.filter((value) => value?.status === "outcome_unknown").length },
      nativeReleasePending: intent.request.kind !== "transition.emergency-local" && !!attempt && attempt.phase !== "terminal" },
    recoverable });
}
