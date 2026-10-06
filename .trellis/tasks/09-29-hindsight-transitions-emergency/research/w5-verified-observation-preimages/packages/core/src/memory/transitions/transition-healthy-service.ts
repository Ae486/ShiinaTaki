/**
 * INPUT:  authenticated Core configuration/client custody and composed transition/runtime producers
 * OUTPUT: current preview, pure admission plan, complete healthy operation execution and historical status
 * POS:    core/memory/transitions — used by the existing durable operation owner; emergency remains a separate producer
 */
import { randomUUID } from "node:crypto";
import { MemoryTransitionPreviewParamsSchema, type MemoryTransitionPreview, type MemoryTransitionRequest } from "@taki/shared";
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

type Dependencies = Omit<HealthyTransitionExecutionDependencies, "signal"> & { actorId: string; logger: Logger };
export function createHealthyTransitionService(deps: Dependencies) {
  const controller = new AbortController(); const running = new Set<Promise<void>>();
  const alive = () => { if (controller.signal.aborted) throw new Error("MEMORY_TRANSITION_UNAVAILABLE"); };
  const plan: MemoryTransitionDriver["plan"] = (request) => {
    alive(); if (request.kind === "transition.emergency-local") unavailable();
    const preview = readTransitionPreview(deps.db, request.previewId);
    assertTransitionPreviewRequest(preview, { request, now: deps.now(), actorId: deps.actorId });
    if (request.recovery) validateRecovery(deps, request);
    else {
      const current = readHealthyTransitionIdentity(deps.db, { kind: request.kind, fingerprint: deps.fingerprint(),
        providerLineage: request.expected.sourceProvider === "hindsight" ? request.expected.sourceLineageId : request.expected.targetLineageId });
      if (transitionLocalHash(current) !== transitionLocalHash(request.expected)
        || !deps.ready(current.predecessorEpochId, current.sourceProvider)) throw new Error("MEMORY_TRANSITION_STALE");
    }
    return { current: preview.expected, actorId: deps.actorId };
  };
  const driver: MemoryTransitionDriver = { plan, execute: async (input) => {
    alive();
    const execution = executeHealthyTransition({ ...deps, signal: controller.signal }, input);
    running.add(execution);
    try { await execution; } catch (error) {
      recordServiceFailure(deps, input, error);
    } finally { running.delete(execution); }
    return null;
  } };
  return { ...driver,
    preview: async (params: { kind: "transition.return-local" | "transition.reenter-hindsight"; recoveryTransitionId?: string }): Promise<MemoryTransitionPreview> => {
      alive(); const request = MemoryTransitionPreviewParamsSchema.parse(params);
      const fingerprint = deps.fingerprint(); const client = requireHindsightTransitionClient(deps.client());
      const manifest = await client.compatibility({ timeoutMs: deps.requestTimeoutMs, signal: controller.signal });
      alive(); const capability = requireHindsightTransitionSourceCapability(manifest);
      if (fingerprint !== deps.fingerprint()) throw new Error("MEMORY_TRANSITION_STALE");
      const recovery = request.recoveryTransitionId ? recoveryIdentity(deps, request.recoveryTransitionId, request.kind) : null;
      const expected = recovery?.expected ?? readHealthyTransitionIdentity(deps.db, { kind: request.kind, fingerprint, providerLineage: capability.providerLineage });
      if ((expected.sourceProvider === "hindsight" ? expected.sourceLineageId : expected.targetLineageId) !== capability.providerLineage) throw new Error("MEMORY_TRANSITION_STALE");
      if (!recovery && !deps.ready(expected.predecessorEpochId, expected.sourceProvider)) unavailable();
      const preview: MemoryTransitionPreview = { version: 1, previewId: randomUUID(), kind: request.kind, expected,
        previewHash: canonicalPayloadHash(["taki-transition-preview.v1", request.kind, expected]), actorId: deps.actorId,
        createdAt: deps.now(), expiresAt: new Date(Date.parse(deps.now()) + 120_000).toISOString(), capabilityHash: transitionLocalHash(manifest),
        recovery: recovery?.recovery ?? null };
      saveTransitionPreview(deps.db, preview); return preview;
    },
    status: (transitionId: string) => readHealthyTransitionStatus(deps.db, { transitionId, now: deps.now(), ready: deps.ready }),
    stop: async () => { controller.abort(); await Promise.allSettled(running); },
  };
}
export type HealthyTransitionService = ReturnType<typeof createHealthyTransitionService>;
function recordServiceFailure(deps: Dependencies, input: Parameters<MemoryTransitionDriver["execute"]>[0], error: unknown): void {
  // Claim/storage failures can precede the execution's owned catch. End this operation truthfully without
  // releasing the original fence or leaving the operation indefinitely running in the same Core process.
  if (input.producer.kind === "transition" && !readTransitionResolution(deps.db, input.operationId)) {
    const state = readHealthyTransitionStatus(deps.db, { transitionId: input.producer.transitionId, now: deps.now(), ready: deps.ready });
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
  if (!intent || !attempt || intent.request.kind !== kind || attempt.phase === "terminal") throw new Error("MEMORY_TRANSITION_STALE");
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
