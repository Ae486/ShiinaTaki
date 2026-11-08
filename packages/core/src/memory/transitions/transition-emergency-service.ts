/**
 * INPUT:  explicit operator confirmation, surviving Core state and the existing artifact/runtime owners
 * OUTPUT: offline preview, durable original incident, atomic Local publication and exact recovery
 * POS:    core/memory/transitions — intentionally has no client, credential, compatibility or model dependency
 */
import { randomUUID } from "node:crypto";
import { MemoryEmergencyTransitionPreviewSchema, MemoryTransitionResolutionSchema,
  type MemoryEmergencyTransitionPreview, type MemoryTransitionIntent } from "@taki/shared";
import { openReadonlyDatabase, type Database } from "../../db/sqlite.ts";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { saveTransitionPreview, readTransitionPreview, assertTransitionPreviewRequest } from "../../db/memory-transition-preview-repo.ts";
import { claimTransition, readTransitionAttempt, readTransitionIntent, changeTransitionAdmission, updateTransitionAttempt,
  requireTransitionLease, renewTransitionLease, type TransitionLease } from "../../db/memory-transition-repo.ts";
import { readTransitionProof, readTransitionReceipt, recordTransitionProof } from "../../db/memory-transition-evidence-repo.ts";
import { resolveTransition } from "../../db/memory-transition-recovery-repo.ts";
import { recordTransitionDriverFailure } from "../../db/memory-transition-driver-failure.ts";
import { reserveEmergencyCapture, acknowledgeEmergencyIncident, readEmergencyIncident } from "../../db/memory-transition-emergency-repo.ts";
import { captureSurvivingBankEvidence } from "../../db/memory-transition-surviving-capture.ts";
import { prepareEmergencyCandidate } from "../../db/memory-transition-emergency-candidate.ts";
import { buildEmergencyPublicationProof } from "../../db/memory-transition-emergency-publication.ts";
import { readQueueOutcome, readTransitionQueue } from "../../db/memory-transition-queue-repo.ts";
import { sealEmergencyEvidence } from "../hindsight-backup/hindsight-backup-emergency.ts";
import type { HindsightBackupStore } from "../hindsight-backup/hindsight-backup-store.ts";
import type { HindsightBackupService } from "../hindsight-backup/hindsight-backup-service.ts";
import { readEmergencyTransitionIdentity, assertEmergencyConfiguration } from "./transition-current-identity.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import { readHealthyTransitionStatus } from "./transition-healthy-status.ts";
import type { MemoryTransitionRuntime } from "./transition-runtime.ts";
import type { MemoryTransitionDriver } from "../operations/memory-operation-transition-storage.ts";
import { readEmergencyPreviewDisclosure } from "./transition-emergency-preview.ts";
import type { Logger } from "../../logging/logger.ts";
import type { TransitionEvidenceContext } from "./transition-evidence-context.ts";
import { createTransitionExecutionHeartbeat } from "./transition-execution-heartbeat.ts";

interface Dependencies {
  db: Database; ownerId: string; actorId: string; now(): string; runtime: MemoryTransitionRuntime; store: HindsightBackupStore;
  logger?: Logger;
  backup?: Pick<HindsightBackupService, "lastVerified" | "retireEpoch">;
  ready(epochId: string, provider: "local" | "hindsight"): boolean;
}
export function createEmergencyTransitionService(deps: Dependencies) {
  const lifetime = new AbortController(); const active = new Set<Promise<void>>();
  const alive = () => { if (lifetime.signal.aborted) throw new Error("MEMORY_TRANSITION_UNAVAILABLE"); };
  const plan: MemoryTransitionDriver["plan"] = (request, verification) => {
    alive(); verification?.assertOwner(deps.db);
    if (request.kind !== "transition.emergency-local") stale();
    // This separately confirmed offline request must be fresh when its synchronous owner submission starts.
    // Full local verification may take longer than the confirmation window; it cannot manufacture user delay.
    // Reuse only that entry time across the owner's two plans, never a prior submission's validity or current state.
    const admissionAt = verification?.admissionStartedAt ?? deps.now();
    const preview = readTransitionPreview(deps.db, request.previewId);
    assertTransitionPreviewRequest(preview, { request, now: admissionAt, actorId: deps.actorId });
    if (preview.version !== 2 || !preview.offline || preview.takeover !== "eligible" || !preview.expected) stale();
    const actual = request.recovery ? recoveryIdentity(deps, request.recovery.transitionId, verification)
      : { expected: readEmergencyTransitionIdentity(deps.db, verification, deps.runtime.verifySelectedAuthority), recovery: null };
    if (transitionLocalHash(actual.expected) !== transitionLocalHash(request.expected)
      || transitionLocalHash(actual.recovery) !== transitionLocalHash(request.recovery ?? null)) stale();
    assertEmergencyConfiguration(deps.db, request.expected);
    assertTransitionPreviewRequest(readTransitionPreview(deps.db, request.previewId), { request, now: admissionAt, actorId: deps.actorId });
    return { current: preview.expected, actorId: deps.actorId };
  };
  const driver: MemoryTransitionDriver = { plan,
    emergencyAdmitted: (epochId) => {
      // Publication withdrawal is synchronous. Native-dependent producers retain their unresolved original facts.
      deps.runtime.emergencyQuiesce(epochId); deps.backup?.retireEpoch?.(epochId);
    },
    execute: async (input) => {
      alive(); const execution = executeEmergencyTransition(deps, input, { alive, signal: lifetime.signal }); active.add(execution);
      try { await execution; } finally { active.delete(execution); }
      return null;
    },
  };
  return { ...driver,
    preview: async (params: { kind: "transition.emergency-local"; recoveryTransitionId?: string }): Promise<MemoryEmergencyTransitionPreview> => {
      alive(); if (params.kind !== "transition.emergency-local") stale();
      return previewEmergencyTransition(deps, params);
    },
    status: (transitionId: string) => readHealthyTransitionStatus(deps.db, { transitionId, now: deps.now(), ready: deps.ready }),
    stop: async () => { lifetime.abort(); await Promise.allSettled(active); },
  };
}

function recoveryIdentity(deps: Dependencies, transitionId: string, verification?: TransitionEvidenceContext) {
  const intent = readTransitionIntent(deps.db, transitionId); const attempt = readTransitionAttempt(deps.db, transitionId);
  if (!intent || intent.request.kind !== "transition.emergency-local" || !attempt || attempt.phase === "terminal") stale();
  const receipt = readTransitionReceipt(deps.db, transitionId); const selected = deps.runtime.verifySelectedAuthority(verification);
  if (selected.epochId !== (receipt?.newEpochId ?? intent.request.expected.predecessorEpochId)) stale();
  return { expected: intent.request.expected, recovery: { transitionId, expectedGeneration: attempt.generation,
    expectedReceiptId: receipt?.receiptId ?? null } };
}

function previewEmergencyTransition(deps: Dependencies, params: { kind: "transition.emergency-local"; recoveryTransitionId?: string }): MemoryEmergencyTransitionPreview {
  const disclosure = readEmergencyPreviewDisclosure(deps.db, deps.backup?.lastVerified() ?? null, deps.now());
  let value: { expected: MemoryEmergencyTransitionPreview["expected"]; recovery: MemoryEmergencyTransitionPreview["recovery"] } = { expected: null, recovery: null };
  if (params.recoveryTransitionId) {
    value = recoveryIdentity(deps, params.recoveryTransitionId);
    // A committed emergency repairs the same Local target; its incident carries the historical source disclosure.
    const incident = readEmergencyIncident(deps.db, params.recoveryTransitionId);
    if (incident?.transition) {
      disclosure.blocking = [];
      disclosure.banks = incident.transition.banks.map((bank) => MemoryEmergencyTransitionPreviewSchema.shape.banks.element.strip().parse(bank));
      disclosure.inventory = "complete";
      disclosure.lastVerifiedBackupId = incident.lastVerifiedBackupId;
      disclosure.backupAgeSeconds = incident.backupAgeSeconds;
    } else if (disclosure.blocking.length > 0) value.expected = null;
  } else if (disclosure.blocking.length === 0) {
    try { value.expected = readEmergencyTransitionIdentity(deps.db, undefined, deps.runtime.verifySelectedAuthority); }
    catch (error) { disclosure.blocking.push(error instanceof Error && error.message === "MEMORY_TRANSITION_PROOF_INVALID"
      ? "incomplete-replica" : "source-unavailable"); }
  }
  const preview = MemoryEmergencyTransitionPreviewSchema.parse({ version: 2, previewId: randomUUID(), kind: params.kind,
    ...value, ...disclosure, takeover: value.expected ? "eligible" : "refused",
    previewHash: canonicalPayloadHash(["taki-transition-preview.v1", params.kind, value.expected]),
    actorId: deps.actorId, createdAt: deps.now(), expiresAt: new Date(Date.parse(deps.now()) + 120_000).toISOString(),
    capabilityHash: null, offline: true, remoteHead: "unknown", remoteLoss: "unknown" });
  saveTransitionPreview(deps.db, preview); return preview;
}

async function executeEmergencyTransition(deps: Dependencies, input: Parameters<MemoryTransitionDriver["execute"]>[0], lifetime: { alive(): void; signal: AbortSignal }): Promise<void> {
  if (input.producer.kind !== "transition") stale();
  const intent = readTransitionIntent(deps.db, input.producer.transitionId);
  if (!intent || intent.request.kind !== "transition.emergency-local") stale();
  let lease: TransitionLease = claimTransition(deps.db, { transitionId: intent.transitionId, operationId: input.operationId,
    ownerId: deps.ownerId, now: deps.now(), leaseMs: 300_000 });
  const controller = new AbortController(); const signal = AbortSignal.any([controller.signal, lifetime.signal]);
  const alive = () => { lifetime.alive(); signal.throwIfAborted(); };
  const refresh = () => { lease = readTransitionAttempt(deps.db, intent.transitionId)!; input.checkpoint(input.producer); };
  const work = () => ({ lease, now: deps.now(), currentTime: () => { alive(); return deps.now(); }, assertConfiguration: () => {
    alive(); requireTransitionLease(deps.db, { lease, now: deps.now() }); assertEmergencyConfiguration(deps.db, intent.request.expected);
  } });
  const phase = (next: "draining" | "fenced" | "proven" | "binding" | "settling") => {
    updateTransitionAttempt(deps.db, { ...work(), patch: { phase: next } }); refresh();
  };
  const heartbeat = createTransitionExecutionHeartbeat({ signal, abort: () => controller.abort(),
    renew: () => { work().assertConfiguration(); renewTransitionLease(deps.db, work()); },
    assertCurrent: () => work().assertConfiguration(),
    failure: () => undefined, // The owned catch below records the exact failing attempt once.
  });
  try {
    deps.runtime.emergencyQuiesce(intent.request.expected.predecessorEpochId);
    await heartbeat.boundary();
    if (!readTransitionReceipt(deps.db, intent.transitionId)) await captureAndPublish(deps, intent, { work, refresh, phase, boundary: heartbeat.boundary });
    const receipt = readTransitionReceipt(deps.db, intent.transitionId)!;
    if (readTransitionAttempt(deps.db, intent.transitionId)!.phase === "committed") phase("binding");
    await heartbeat.boundary(); await deps.runtime.bind(intent.transitionId); await heartbeat.boundary();
    if (!deps.ready(receipt.newEpochId, "local")) throw new Error("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
    await heartbeat.boundary();
    if (readTransitionAttempt(deps.db, intent.transitionId)!.phase === "binding") phase("settling");
    await deps.runtime.executeIntents(lease); await heartbeat.boundary(true);
    resolveEmergency(deps, { operationId: input.operationId, intent, lease, work }); input.checkpoint(input.producer);
  } catch (error) {
    const receipt = readTransitionReceipt(deps.db, intent.transitionId);
    const cause = (error instanceof Error ? error.message : "").match(/^(?:MEMORY_|HINDSIGHT_)[A-Z_]+(?=:|$)/)?.[0]
      ?? "MEMORY_TRANSITION_OUTCOME_UNKNOWN";
    deps.logger?.warn({ code: "MEMORY_TRANSITION_OUTCOME_UNKNOWN", cause, transitionId: intent.transitionId,
      phase: readTransitionAttempt(deps.db, intent.transitionId)?.phase, receiptId: receipt?.receiptId ?? null },
    "offline takeover requires original-identity recovery");
    const settled = readTransitionQueue(deps.db, intent.transitionId).every((row) => {
      const outcome = readQueueOutcome(deps.db, row.intentId); return outcome && outcome.status !== "outcome_unknown";
    });
    recordTransitionDriverFailure(deps.db, input.operationId, { kind: "transition", transitionId: intent.transitionId,
      receiptId: receipt?.receiptId ?? null, authorityCommitted: !!receipt,
      runtime: receipt && deps.ready(receipt.newEpochId, "local") ? "ready" : "unavailable", queue: settled ? "settled" : "unsettled",
      outcome: "outcome_unknown", errorCode: "MEMORY_TRANSITION_OUTCOME_UNKNOWN" }); input.checkpoint(input.producer);
  } finally { await heartbeat.stop(); }
}

type EmergencyWork = () => { lease: TransitionLease; now: string; currentTime(): string; assertConfiguration(): void };
async function captureAndPublish(deps: Dependencies, intent: MemoryTransitionIntent, control: {
  work: EmergencyWork; refresh(): void; phase(next: "draining" | "fenced" | "proven"): void; boundary(): Promise<void>;
}) {
  const { work, refresh, phase } = control;
  let attempt = readTransitionAttempt(deps.db, intent.transitionId)!;
  if (attempt.phase === "admitted") phase("draining");
  if (attempt.cutoffSequence === null) { changeTransitionAdmission(deps.db, { ...work(), action: "close" }); refresh(); }
  if (readTransitionAttempt(deps.db, intent.transitionId)!.phase === "draining") phase("fenced");
  work().assertConfiguration();
  const capture = reserveEmergencyCapture(deps.db, work());
  const sealed = await sealEmergencyEvidence({ db: deps.db, store: deps.store, capture,
    lastVerified: deps.backup?.lastVerified() ?? null, now: deps.now });
  await control.boundary();
  work().assertConfiguration(); acknowledgeEmergencyIncident(deps.db, { ...work(), manifest: sealed.manifest });
  const copy = openReadonlyDatabase(deps.store.incidentCorePath(capture.incidentId));
  const evidence = [];
  try {
    for (const bank of intent.request.expected.banks) {
      evidence.push(captureSurvivingBankEvidence(copy, { capture, bank, lineage: intent.request.expected.sourceLineageId }));
      await control.boundary();
    }
  } finally { copy.close(); }
  const candidate = prepareEmergencyCandidate(deps.db, { ...work(), evidence, verifyTransitionPublication: deps.runtime.verifyTransitionPublication });
  await control.boundary();
  attempt = readTransitionAttempt(deps.db, intent.transitionId)!;
  const oldProof = attempt.lastEvidenceId ? readTransitionProof(deps.db, attempt.lastEvidenceId) : undefined;
  if (!oldProof || oldProof.attemptId !== attempt.attemptId) {
    const proof = buildEmergencyPublicationProof(deps.db, { ...work(), candidateId: candidate.candidateId });
    await control.boundary();
    recordTransitionProof(deps.db, { ...work(), proof }); refresh();
  }
  if (readTransitionAttempt(deps.db, intent.transitionId)!.phase === "fenced") phase("proven");
  await control.boundary();
  deps.runtime.publish({ ...work(), candidateId: candidate.candidateId }); refresh();
}
function resolveEmergency(deps: Dependencies, input: { operationId: string; intent: MemoryTransitionIntent; lease: TransitionLease; work: EmergencyWork }) {
  const { intent, lease, work } = input; const receipt = readTransitionReceipt(deps.db, intent.transitionId)!;
  const publication = deps.runtime.verifyTransitionPublication(receipt.receiptId);
  if (publication.version !== 2) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  const body = { version: 1, operationId: input.operationId, transitionId: intent.transitionId,
    release: { protocol: "taki-transition-v1", attemptId: lease.attemptId, generation: lease.generation,
      disposition: "offline-quarantined", proofHash: transitionLocalHash(publication), incidentId: intent.incidentId,
      recordedAt: deps.now(), banks: intent.request.expected.banks.map((bank) => ({ sourceBankId: bank.sourceBankId,
        nativeGeneration: bank.nativeGeneration, fenceId: null, outcomeReceiptId: null,
        dispatch: "offline-quarantined", proofHash: publication.incidentHash })) },
    result: { kind: "transition", transitionId: intent.transitionId, receiptId: receipt.receiptId,
      authorityCommitted: true, runtime: "ready", queue: "settled", outcome: "completed", errorCode: null } };
  resolveTransition(deps.db, { ...work(), resolution: MemoryTransitionResolutionSchema.parse({ ...body,
    resolutionId: canonicalPayloadHash(["taki-transition-resolution.v1", body]) }) });
}
function stale(): never { throw new Error("MEMORY_TRANSITION_STALE"); }
