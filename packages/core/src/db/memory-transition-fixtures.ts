/**
 * INPUT:  isolated SQLite test connections
 * OUTPUT: complete identity-bound transition fixtures without native effects or runtime switching
 * POS:    core/db test support — never imported by production composition
 */
import { randomUUID } from "node:crypto";
import type { MemoryTransitionFinalProof, MemoryTransitionIdentity, MemoryTransitionIntent, MemoryTransitionRequest } from "@taki/shared";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { seedHindsightAuthority } from "../memory/operations/memory-operation-fixtures.ts";
import { createMemoryOperationRepo } from "./memory-operation-repo.ts";
import { admitTransition, claimTransition, DEFAULT_TRANSITION_QUEUE_POLICY, readTransitionAttempt, type TransitionLease } from "./memory-transition-repo.ts";
import type { Database } from "./sqlite.ts";

export const TRANSITION_AT = "2026-09-29T00:00:00.000Z";
export const TRANSITION_HASH = "a".repeat(64);
export function transitionIdentity(): MemoryTransitionIdentity {
  return { predecessorEpochId: "epoch", sourceProvider: "hindsight", sourceLineageId: "11111111-1111-4111-8111-111111111111",
    targetProvider: "local", targetLineageId: "target-lineage", configRevision: 3, configFingerprint: TRANSITION_HASH, inventoryRevision: 1,
    inventoryHash: TRANSITION_HASH, banks: [{ scope: { kind: "global", characterId: null }, sourceBankId: "global", targetBankId: "local-bank",
      sourceRevision: 1, nativeBankId: "global", nativeGeneration: "generation", manifestHash: TRANSITION_HASH, mappingHash: TRANSITION_HASH,
      policyRevision: 1, blockRevision: 1 }], baselineReceiptId: null, baselineHash: null, custodyBoundaryHash: TRANSITION_HASH };
}
export function transitionRequest(): Extract<MemoryTransitionRequest, { kind: "transition.return-local" }> {
  const expected = transitionIdentity();
  return { kind: "transition.return-local", requestId: randomUUID(), previewId: randomUUID(),
    previewHash: canonicalPayloadHash(["taki-transition-preview.v1", "transition.return-local", expected]), expected, confirmation: "healthy-switch" };
}
export function transitionIntent(request = transitionRequest()): MemoryTransitionIntent {
  return { version: 1, transitionId: randomUUID(), operationId: randomUUID(), request, actorId: "operator-1", admittedAt: TRANSITION_AT,
    queuePolicy: { ...DEFAULT_TRANSITION_QUEUE_POLICY }, incidentId: null };
}
export function seedTransition(db: Database, intent = transitionIntent()): MemoryTransitionIntent {
  seedHindsightAuthority(db);
  const repo = createMemoryOperationRepo(db, () => TRANSITION_AT);
  db.transaction(() => {
    repo.insertAdmitted({ operationId: intent.operationId, kind: intent.request.kind, family: "memory-transition", request: intent.request,
      authorityEpochId: "epoch", producer: { kind: "transition", transitionId: intent.transitionId, requestId: intent.request.requestId }, bootId: "old" });
    admitTransition(db, { intent, current: intent.request.expected });
  });
  repo.transition({ operationId: intent.operationId, expectedState: "admitted", patch: { state: "running" } });
  return intent;
}
export function startTransition(db: Database, intent: MemoryTransitionIntent): TransitionLease {
  return claimTransition(db, { transitionId: intent.transitionId, ownerId: "owner", now: TRANSITION_AT, leaseMs: 60_000 });
}
export function currentLease(db: Database, intent: MemoryTransitionIntent): TransitionLease {
  const value = readTransitionAttempt(db, intent.transitionId);
  if (!value) throw new Error("missing fixture lease");
  return value;
}
export function transitionProof(intent: MemoryTransitionIntent, lease: TransitionLease): MemoryTransitionFinalProof {
  return { version: 1, transitionId: intent.transitionId, attemptId: lease.attemptId, generation: lease.generation, identity: intent.request.expected,
    fencedManifestHash: TRANSITION_HASH, mappingHash: TRANSITION_HASH, custodyBoundaryHash: TRANSITION_HASH, cutoffSequence: 0,
    unresolvedSourceHash: TRANSITION_HASH, banks: [{ sourceBankId: "global", manifestHash: TRANSITION_HASH, mappingHash: TRANSITION_HASH,
      native: { protocol: "taki-transition-v1", fenceId: "fence", holderGeneration: 1, certificateId: "certificate", nativeSnapshotId: "native-snapshot",
        nativeCursor: 0, applicationSnapshotId: "app-snapshot", applicationCursor: 0, nativeGeneration: "generation",
        maintenanceInputHash: TRANSITION_HASH, maintenanceOutcomeHash: TRANSITION_HASH, proofHash: TRANSITION_HASH } }],
    incidentId: null, incidentHash: null, backupId: null, recordedAt: TRANSITION_AT };
}
