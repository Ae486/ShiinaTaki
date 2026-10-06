/**
 * INPUT:  authenticated Core configuration/client custody and composed transition/runtime producers
 * OUTPUT: current preview, pure admission plan, complete healthy operation execution and historical status
 * POS:    core/memory/transitions — used by the existing durable operation owner; emergency remains a separate producer
 */
import { randomUUID } from "node:crypto";
import { MemoryTransitionPreviewParamsSchema, type MemoryHealthyTransitionPreview, type MemoryTransitionRequest } from "@taki/shared";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import { readHealthyTransitionIdentity, assertTransitionConfiguration } from "./transition-current-identity.ts";
import { saveTransitionPreview, readTransitionPreview, assertTransitionPreviewRequest } from "../../db/memory-transition-preview-repo.ts";
import { readTransitionAttempt, readTransitionIntent } from "../../db/memory-transition-repo.ts";
import { readTransitionReceipt } from "../../db/memory-transition-evidence-repo.ts";
import { readTransitionResolution } from "../../db/memory-transition-recovery-repo.ts";
import { recordTransitionDriverFailure } from "../../db/memory-transition-driver-failure.ts";
import { requireHindsightTransitionSourceCapability } from "../hindsight/hindsight-transition-source-capability.ts";
import { requireHindsightTransitionClient } from "../hindsight/hindsight-transition-capability.ts";
import { readHealthyTransitionStatus } from "./transition-healthy-status.ts";
import { executeHealthyTransition, logHealthyTransitionFailure, type HealthyTransitionExecutionDependencies } from "./transition-healthy-execution.ts";
import type { MemoryTransitionDriver } from "../operations/memory-operation-transition-storage.ts";
import type { Logger } from "../../logging/logger.ts";
import { hasEmergencyStorage, transitionIsQuarantined } from "../../db/memory-transition-emergency-quarantine.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { readTransitionOverview } from "./transition-operator-overview.ts";

type Dependencies = Omit<HealthyTransitionExecutionDependencies, "signal"> & { actorId: string; logger: Logger;
  /** Observation only; preview, admission and execution keep the independent full ready boundary. */
  observeReady?: HealthyTransitionExecutionDependencies["ready"] };
export function createHealthyTransitionService(deps: Dependencies) {
  const controller = new AbortController(); const running = new Map<Promise<void>, { transitionId: string; controller: AbortController }>();
  const alive = () => { if (controller.signal.aborted) throw new Error("MEMORY_TRANSITION_UNAVAILABLE"); };
  const plan: MemoryTransitionDriver["plan"] = (request, verification) => {
    verification?.assertOwner(deps.db); verification?.assertIndependent();
    alive(); if (request.kind === "transition.emergency-local") unavailable();
    const preview = readTransitionPreview(deps.db, request.previewId);
    if (preview.version !== 1) unavailable();
    assertTransitionPreviewRequest(preview, { request, now: deps.now(), actorId: deps.actorId });
    if (request.recovery) validateRecovery(deps, request);
    else {
      const current = readHealthyTransitionIdentity(deps.db, { kind: request.kind, fingerprint: deps.fingerprint(),
        providerLineage: request.expected.sourceProvider === "hindsight" ? request.expected.sourceLineageId : request.expected.targetLineageId }, verification);
      if (transitionLocalHash(current) !== transitionLocalHash(request.expected)
        || !deps.ready(current.predecessorEpochId, current.sourceProvider, verification)) throw new Error("MEMORY_TRANSITION_STALE");
    }
    // Full verification can consume real time without yielding. Entry validity cannot authorize an expired result.
    assertTransitionPreviewRequest(readTransitionPreview(deps.db, request.previewId), { request, now: deps.now(), actorId: deps.actorId });
    return { current: preview.expected, actorId: deps.actorId };
  };
  const driver: MemoryTransitionDriver = { plan, execute: async (input) => {
    alive();
    const ownedController = new AbortController();
    const execution = executeHealthyTransition({ ...deps, signal: AbortSignal.any([controller.signal, ownedController.signal]) }, input);
    running.set(execution, { transitionId: input.producer.kind === "transition" ? input.producer.transitionId : "", controller: ownedController });
    try { await execution; } catch (error) {
      recordServiceFailure(deps, input, error);
    } finally { running.delete(execution); }
    return null;
  } };
  return { ...driver,
    overview: () => readTransitionOverview({ ...deps, ready: deps.observeReady ?? deps.ready,
      status: (transitionId) => readHealthyTransitionStatus(deps.db, { transitionId, now: deps.now(), ready: deps.observeReady ?? deps.ready, fingerprint: deps.fingerprint }) }),
    preview: async (params: { kind: "transition.return-local" | "transition.reenter-hindsight"; recoveryTransitionId?: string }): Promise<MemoryHealthyTransitionPreview> => {
      alive(); const request = MemoryTransitionPreviewParamsSchema.parse(params);
      if (request.kind === "transition.emergency-local") unavailable();
      const selected = readMemoryAuthoritySelection(deps.db);
      if (selected.epochId && hasEmergencyStorage(deps.db) && deps.db.prepare("SELECT 1 FROM memory_transition_foreign_branches WHERE target_epoch_id=:epoch")
        .get({ epoch: selected.epochId })) throw new Error("MEMORY_TRANSITION_FOREIGN_BRANCH");
      if (request.recoveryTransitionId && transitionIsQuarantined(deps.db, request.recoveryTransitionId)) unavailable();
      const fingerprint = deps.fingerprint(); const client = requireHindsightTransitionClient(deps.client());
      const manifest = await client.compatibility({ timeoutMs: deps.requestTimeoutMs, signal: controller.signal });
      alive(); const capability = requireHindsightTransitionSourceCapability(manifest);
      if (fingerprint !== deps.fingerprint()) throw new Error("MEMORY_TRANSITION_STALE");
      const recovery = request.recoveryTransitionId ? recoveryIdentity(deps, request.recoveryTransitionId, request.kind) : null;
      const expected = recovery?.expected ?? readHealthyTransitionIdentity(deps.db, { kind: request.kind, fingerprint, providerLineage: capability.providerLineage });
      if ((expected.sourceProvider === "hindsight" ? expected.sourceLineageId : expected.targetLineageId) !== capability.providerLineage) throw new Error("MEMORY_TRANSITION_STALE");
      if (!recovery && !deps.ready(expected.predecessorEpochId, expected.sourceProvider)) unavailable();
      const preview: MemoryHealthyTransitionPreview = { version: 1, previewId: randomUUID(), kind: request.kind, expected,
        previewHash: canonicalPayloadHash(["taki-transition-preview.v1", request.kind, expected]), actorId: deps.actorId,
        createdAt: deps.now(), expiresAt: new Date(Date.parse(deps.now()) + 120_000).toISOString(), capabilityHash: transitionLocalHash(manifest),
        recovery: recovery?.recovery ?? null };
      saveTransitionPreview(deps.db, preview); return preview;
    },
    status: (transitionId: string) => readHealthyTransitionStatus(deps.db, { transitionId, now: deps.now(), ready: deps.observeReady ?? deps.ready, fingerprint: deps.fingerprint }),
    quarantine: () => {
      for (const value of running.values()) if (transitionIsQuarantined(deps.db, value.transitionId)) value.controller.abort();
    },
    stop: async () => { controller.abort();
      await Promise.allSettled([...running].filter(([, value]) => !transitionIsQuarantined(deps.db, value.transitionId)).map(([promise]) => promise)); },
  };
}
export type HealthyTransitionService = ReturnType<typeof createHealthyTransitionService>;
function recordServiceFailure(deps: Dependencies, input: Parameters<MemoryTransitionDriver["execute"]>[0], error: unknown): void {
  // Claim/storage failures can precede the execution's owned catch. End this operation truthfully without
  // releasing the original fence or leaving the operation indefinitely running in the same Core process.
  if (input.producer.kind === "transition" && !readTransitionResolution(deps.db, input.operationId)) {
    const state = readHealthyTransitionStatus(deps.db, { transitionId: input.producer.transitionId, now: deps.now(), ready: deps.observeReady ?? deps.ready });
    const receipt = state.transition.receipt;
    recordTransitionDriverFailure(deps.db, input.operationId, { kind: "transition", transitionId: input.producer.transitionId,
      receiptId: receipt?.receiptId ?? null, authorityCommitted: !!receipt,
      runtime: state.progress.runtime === "ready" ? "ready" : "unavailable",
      queue: state.progress.queue.admitted === state.progress.queue.settled ? "settled" : "unsettled",
      outcome: "outcome_unknown", errorCode: "MEMORY_TRANSITION_OUTCOME_UNKNOWN" });
  }
  logHealthyTransitionFailure(deps.logger, error, "service");
}
function recoveryIdentity(deps: Dependencies, transitionId: string, kind: string) {
  const intent = readTransitionIntent(deps.db, transitionId); const attempt = readTransitionAttempt(deps.db, transitionId);
  if (!intent || !attempt || intent.request.kind !== kind || attempt.phase === "terminal"
    || transitionIsQuarantined(deps.db, transitionId)) throw new Error("MEMORY_TRANSITION_STALE");
  return { expected: intent.request.expected, recovery: { transitionId, expectedGeneration: attempt.generation,
    expectedReceiptId: readTransitionReceipt(deps.db, transitionId)?.receiptId ?? null } };
}
function validateRecovery(deps: Dependencies, request: MemoryTransitionRequest): void {
  const recovery = request.recovery; if (!recovery) unavailable();
  const current = recoveryIdentity(deps, recovery.transitionId, request.kind);
  if (transitionLocalHash(current.expected) !== transitionLocalHash(request.expected)
    || transitionLocalHash(current.recovery) !== transitionLocalHash(recovery)) throw new Error("MEMORY_TRANSITION_STALE");
  assertTransitionConfiguration(deps.db, request.expected, deps.fingerprint());
}
function unavailable(): never { throw new Error("MEMORY_TRANSITION_UNAVAILABLE"); }
