/**
 * INPUT:  current W1 lease, verified committed publication and a fresh selected target provider
 * OUTPUT: stable ordered queue execution with target request-before-effect and factual receipt reconciliation
 * POS:    core/memory/transitions — owns only new internal target calls; old Runs/Effects are immutable provenance
 */
import type { MemoryProvider } from "../memory-provider.ts";
import type { MemoryTransitionQueueExecution } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { readTransitionQueue, readQueueOutcome, readQueueExecution, prepareQueueExecution, settleQueueIntent } from "../../db/memory-transition-queue-repo.ts";
import { readTransitionReceipt } from "../../db/memory-transition-evidence-repo.ts";
import { readVerifiedTransitionPublication } from "../../db/memory-transition-publication-reader.ts";
import type { MemoryAuthorityVerification } from "../runtime-authority-verification.ts";
import { readVerifiedTransitionCandidate } from "./transition-final-mapping.ts";
import { readVerifiedEmergencyCandidate } from "../../db/memory-transition-emergency-candidate.ts";
import { requireTransitionLease, type TransitionLease } from "../../db/memory-transition-repo.ts";
import { reconcileTransitionEffect } from "../../db/memory-transition-effect-repo.ts";
import { recordTransitionLocalRefusal } from "../../db/memory-transition-target-refusal.ts";
import { requireTransitionTargetReady } from "../../db/memory-transition-native-outcome.ts";
import { mapTransitionQueueIntent, transitionTargetCommand } from "./transition-queue-mapping.ts";
import { transitionIsQuarantined } from "../../db/memory-transition-emergency-quarantine.ts";

interface Dependencies { db: Database; provider(epochId: string): MemoryProvider; now?: () => string;
  verifyTransitionPublication?: MemoryAuthorityVerification["verifyTransitionPublication"];
  recoverTarget?(execution: MemoryTransitionQueueExecution, signal: AbortSignal): Promise<void> }
export function createTransitionIntentExecutor(input: Dependencies) {
  let stopped = false; const controller = new AbortController(); const active = new Map<Promise<void>, string>();
  const live = () => [...active].filter(([, id]) => !transitionIsQuarantined(input.db, id)).map(([promise]) => promise);
  const now = () => input.now?.() ?? new Date().toISOString();
  const run = async (lease: TransitionLease) => {
    if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED");
    if (live().length) throw new Error("MEMORY_TRANSITION_CONFLICT");
    const task = executeQueue({ ...input, now, lease, signal: controller.signal }); active.set(task, lease.transitionId);
    try { await task; } finally { active.delete(task); }
  };
  return { run, stop: async () => { stopped = true; controller.abort(); await Promise.allSettled(live()); } };
}
async function executeQueue(input: Dependencies & { now(): string;
  lease: TransitionLease; signal: AbortSignal }): Promise<void> {
  const { db, lease } = input;
  requireTransitionLease(db, { lease, now: input.now() });
  const receipt = readTransitionReceipt(db, lease.transitionId);
  if (!receipt) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  const publication = input.verifyTransitionPublication?.(receipt.receiptId) ?? readVerifiedTransitionPublication(db, receipt.receiptId);
  const candidate = receipt.kind === "transition.emergency-local" ? readVerifiedEmergencyCandidate(db, publication.candidateId)
    : readVerifiedTransitionCandidate(db, publication.candidateId);
  requireTransitionTargetReady(db, receipt.newEpochId);
  const provider = input.provider(receipt.newEpochId);
  if (provider.providerId !== receipt.identity.targetProvider || provider.providerLineageId !== receipt.identity.targetLineageId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  for (const intent of readTransitionQueue(db, lease.transitionId)) {
    if (input.signal.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
    requireTransitionLease(db, { lease, now: input.now() });
    const settled = readQueueOutcome(db, intent.intentId);
    if (settled && settled.status !== "outcome_unknown") continue;
    let execution = readQueueExecution(db, intent.intentId);
    if (!execution) {
      const mapped = mapTransitionQueueIntent(db, { intent, candidate, receipt, now: input.now() });
      if (!mapped) { settleQueueIntent(db, { lease, now: input.now(), outcome: { status: "conflict", intentId: intent.intentId,
        errorCode: "MEMORY_TRANSITION_CONFLICT", settledAt: input.now() } }); continue; }
      execution = prepareQueueExecution(db, { lease, now: input.now(), execution: mapped });
    }
    const work = { intent, execution, provider: receipt.identity.targetProvider, now: input.now() };
    let outcome = reconcileTransitionEffect(db, work);
    if (!outcome && settled?.status === "outcome_unknown" && input.recoverTarget) {
      // Only the target's durable Pending/parent recovery may advance this same saved request. The original source
      // Run is provenance, and an unknown observation never grants a new raw provider dispatch or replacement ID.
      try { await input.recoverTarget(execution, input.signal); } catch { /* Unknown retains its original owner. */ }
      requireTransitionLease(db, { lease, now: input.now() });
      outcome = reconcileTransitionEffect(db, { ...work, now: input.now() });
    }
    if (!outcome && settled?.status !== "outcome_unknown") {
      const command = transitionTargetCommand(intent, execution);
      const context = { requestId: execution.targetRequestId, authorityEpochId: execution.targetEpochId,
        actor: "foreground-agent" as const, signal: input.signal,
        provenance: { callerId: `transition:${intent.intentId}`, runId: null, attemptId: null, effectId: null } };
      try {
        const result = command.kind === "retain" ? await provider.retain(context, command.request) : await provider.mutate(context, command.request);
        if (provider.providerId === "local") recordTransitionLocalRefusal(db, { execution, command, result });
      } catch { /* Reconcile the actual receipt even when the provider lost its post-effect reply. */ }
      outcome = reconcileTransitionEffect(db, { ...work, now: input.now() });
    }
    settleQueueIntent(db, { lease, now: input.now(), outcome: outcome ?? { status: "outcome_unknown", intentId: intent.intentId,
      targetRequestId: execution.targetRequestId, settledAt: input.now() } });
    if (!outcome) return;
  }
}
