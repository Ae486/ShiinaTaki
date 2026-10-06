/**
 * INPUT:  live provider bindings, Core-owned custody/maintenance and durable W1/W3 transition identities
 * OUTPUT: complete drain/publication/binding/intent seams for the healthy operation driver and target-only recovery
 * POS:    core/memory/transitions — process owner; no partial operator action or second scheduler is enabled
 */
import type { Database } from "../../db/sqlite.ts";
import { readTransitionIntent, requireTransitionLease, type TransitionLease } from "../../db/memory-transition-repo.ts";
import { readTransitionReceipt } from "../../db/memory-transition-evidence-repo.ts";
import { readTransitionResolution } from "../../db/memory-transition-recovery-repo.ts";
import { publishMemoryTransition } from "../../db/memory-transition-publication-repo.ts";
import { buildTransitionPublicationProof } from "../../db/memory-transition-publication-proof.ts";
import { readVerifiedTransitionPublication } from "../../db/memory-transition-publication-reader.ts";
import { recordTransitionNativeOutcome, readTransitionNativeRelease } from "../../db/memory-transition-native-outcome.ts";
import { abortMemoryTransition } from "../../db/memory-transition-abort.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import { readQueueOutcome, readTransitionQueue } from "../../db/memory-transition-queue-repo.ts";
import type { PrimaryMemoryCustody } from "../../db/primary-memory-custody-repo.ts";
import type { LocalRuntimeBinding } from "../local-runtime-binding.ts";
import type { HindsightRuntimeBinding } from "../hindsight-runtime-binding.ts";
import type { SelectedMemoryRuntime } from "../runtime-selector.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { transitionIsQuarantined } from "../../db/memory-transition-emergency-quarantine.ts";
import { createTransitionIntentExecutor } from "./transition-intent-executor.ts";

interface Dependencies { db: Database; local: LocalRuntimeBinding; hindsight: HindsightRuntimeBinding;
  selected: SelectedMemoryRuntime; custody: PrimaryMemoryCustody; alive(): void; settle(): Promise<void>; startHindsight(): void;
  retireBackground?(): void }

export function createMemoryTransitionRuntime(input: Dependencies) {
  const executor = createTransitionIntentExecutor({ db: input.db, provider: (epochId) => {
    input.alive(); const selected = readMemoryAuthoritySelection(input.db);
    if (selected.epochId !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    if (selected.mode === "hindsight") {
      const runtime = input.hindsight.current();
      if (!runtime) throw new Error("MEMORY_RUNTIME_UNAVAILABLE"); return runtime.state.provider;
    }
    const runtime = input.local.current();
    if (!runtime) throw new Error("MEMORY_RUNTIME_UNAVAILABLE");
    return runtime.provider;
  }, recoverTarget: async (execution, signal) => {
    input.alive(); const runtime = input.hindsight.current();
    if (!runtime || runtime.state.runtime.epoch.epochId !== execution.targetEpochId) return;
    await runtime.state.service.recover({ bankId: execution.targetBankId, context: {
      signal,
      timeoutMs: runtime.state.runtime.connection.requestTimeoutMs } });
  } });
  let active: Promise<void> | undefined; let activeTransitionId: string | undefined; let stopped = false; const controller = new AbortController();
  const quarantinedEpochs = new Set<string>();
  const alive = () => { input.alive(); if (stopped) throw new Error("MEMORY_OPERATION_CANCELLED"); };
  return {
    emergencyQuiesce: (epochId: string) => {
      alive();
      const selection = readMemoryAuthoritySelection(input.db);
      if (selection.mode === "hindsight" && selection.epochId !== epochId) throw new Error("MEMORY_TRANSITION_STALE");
      input.hindsight.quarantine(epochId);
      // A reentry can commit Hindsight before its bind has withdrawn the preceding Local instance.
      // Retire that stale publication synchronously too; its old epoch cannot become the emergency target.
      // Same-target recovery already selects Local and must keep the new Local generation alive.
      if (selection.mode === "hindsight") input.local.retire();
      if (selection.mode === "hindsight" && !quarantinedEpochs.has(epochId)) input.retireBackground?.();
      quarantinedEpochs.add(epochId);
      input.custody.reconcile();
    },
    proof: (work: Parameters<typeof buildTransitionPublicationProof>[1]) => { alive(); return buildTransitionPublicationProof(input.db, work); },
    publish: (work: Parameters<typeof publishMemoryTransition>[1]) => { alive(); return publishMemoryTransition(input.db, work); },
    nativeOutcome: (work: Parameters<typeof recordTransitionNativeOutcome>[1]) => { alive(); recordTransitionNativeOutcome(input.db, work); },
    nativeRelease: (work: Parameters<typeof readTransitionNativeRelease>[1]) => { alive(); return readTransitionNativeRelease(input.db, work); },
    abort: (work: Parameters<typeof abortMemoryTransition>[1]) => { alive(); return abortMemoryTransition(input.db, work); },
    quiesce: (work: { lease: TransitionLease; now: string; timeoutMs: number }) => {
      alive(); if (active) throw new Error("MEMORY_TRANSITION_CONFLICT");
      activeTransitionId = work.lease.transitionId;
      active = quiesce(input, { ...work, signal: controller.signal }).finally(() => { active = undefined; }); return active;
    },
    bind: async (transitionId: string) => {
      alive(); const receipt = readTransitionReceipt(input.db, transitionId);
      if (!receipt) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
      readVerifiedTransitionPublication(input.db, receipt.receiptId);
      // Old references are withdrawn and retired before any target constructor can execute. An unavailable selected
      // target is repaired through these same checks; no call below re-publishes an authority marker.
      if (receipt.identity.targetProvider === "local") {
        if (receipt.kind === "transition.emergency-local") input.hindsight.quarantine(receipt.identity.predecessorEpochId);
        else await input.hindsight.retire();
        alive(); input.custody.reconcile();
        return input.selected.recoverCanonical(receipt.newEpochId);
      } else {
        input.local.retire(); await Promise.all([input.local.settle(), input.settle()]); alive(); input.custody.reconcile();
        input.selected.recoverHindsight(receipt.newEpochId); input.startHindsight();
      }
      return "published" as const;
    },
    resumeSource: async (operationId: string) => {
      alive(); await resumeSource(input, operationId, alive);
    },
    executeIntents: (lease: TransitionLease) => { alive(); return executor.run(lease); },
    queue: (transitionId: string) => readTransitionQueue(input.db, transitionId).map((intent) => ({ intent, outcome: readQueueOutcome(input.db, intent.intentId) ?? null })),
    stop: async () => { stopped = true; controller.abort(); await executor.stop();
      if (active && (!activeTransitionId || !transitionIsQuarantined(input.db, activeTransitionId))) await Promise.allSettled([active]); },
  };
}
export type MemoryTransitionRuntime = ReturnType<typeof createMemoryTransitionRuntime>;

async function resumeSource(input: Dependencies, operationId: string, alive: () => void): Promise<void> {
  const resolution = readTransitionResolution(input.db, operationId);
  if (resolution?.release.disposition !== "source-aborted" || resolution.result.authorityCommitted) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  const release = readTransitionNativeRelease(input.db, { lease: { transitionId: resolution.transitionId,
    attemptId: resolution.release.attemptId, generation: resolution.release.generation }, now: resolution.release.recordedAt });
  if (transitionLocalHash(release) !== transitionLocalHash(resolution.release)) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  const intent = readTransitionIntent(input.db, resolution.transitionId)!;
  const selected = readMemoryAuthoritySelection(input.db);
  if (selected.epochId !== intent.request.expected.predecessorEpochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  if (selected.mode === "hindsight") {
    await input.hindsight.retire(); alive(); input.selected.recoverHindsight(selected.epochId); input.startHindsight();
  } else {
    input.local.retire(); await Promise.all([input.local.settle(), input.settle()]); alive(); input.selected.recoverCanonical(selected.epochId!);
  }
}

async function quiesce(input: Dependencies, work: { lease: TransitionLease; now: string; timeoutMs: number; signal: AbortSignal }): Promise<void> {
  requireTransitionLease(input.db, work);
  const intent = readTransitionIntent(input.db, work.lease.transitionId)!;
  if (readMemoryAuthoritySelection(input.db).epochId !== intent.request.expected.predecessorEpochId) throw new Error("MEMORY_TRANSITION_STALE");
  if (intent.request.expected.sourceProvider === "local") {
    const runtime = input.local.current(); if (!runtime) throw new Error("MEMORY_RUNTIME_UNAVAILABLE");
    try { await runtime.fence.quiesce({ ...work, keepFencedOnFailure: true }); await input.settle(); await runtime.ingestion.settle(); }
    catch (error) { runtime.fence.retire(); throw error; }
  } else {
    const runtime = input.hindsight.current(); if (!runtime) throw new Error("MEMORY_RUNTIME_UNAVAILABLE");
    try {
      await runtime.writeFence.quiesce({ ...work, keepFencedOnFailure: true });
      await Promise.all([runtime.workFence.quiesce({ ...work, keepFencedOnFailure: true }), runtime.scheduler.pause()]);
      await input.settle();
    } catch (error) { runtime.writeFence.retire(); runtime.workFence.retire(); throw error; }
  }
  input.alive(); input.custody.reconcile(); requireTransitionLease(input.db, work);
}
