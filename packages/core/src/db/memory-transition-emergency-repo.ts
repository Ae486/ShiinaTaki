/**
 * INPUT:  the current emergency lease and an exact verified offline seal
 * OUTPUT: immutable capture-before-copy identity and seal-before-publication acknowledgement
 * POS:    core/db — recovery retains the original capture attempt even after executor takeover
 */
import { randomUUID } from "node:crypto";
import { HindsightIncidentManifestSchema, MemoryEmergencyCaptureSchema,
  type HindsightIncidentManifest, type MemoryEmergencyCapture } from "@taki/shared";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { assertTransitionPredecessor, readTransitionIntent, requireTransitionLease, type TransitionLease } from "./memory-transition-repo.ts";
import type { Database } from "./sqlite.ts";

export function readEmergencyCapture(db: Database, transitionId: string): MemoryEmergencyCapture | undefined {
  const row = db.prepare("SELECT * FROM memory_transition_emergency_captures WHERE transition_id=:id").get({ id: transitionId });
  if (!row) return undefined;
  const value = MemoryEmergencyCaptureSchema.parse(JSON.parse(String(row.capture_json)));
  const intent = readTransitionIntent(db, transitionId);
  if (!intent || value.captureId !== row.capture_id || value.transitionId !== row.transition_id || value.incidentId !== row.incident_id
    || intent.incidentId !== value.incidentId || value.operationId !== intent.operationId
    || value.predecessorEpochId !== intent.request.expected.predecessorEpochId
    || value.identityHash !== transitionLocalHash(intent.request.expected)) invalid();
  return value;
}

export function reserveEmergencyCapture(db: Database, input: { lease: TransitionLease; now: string }): MemoryEmergencyCapture {
  let capture: MemoryEmergencyCapture | undefined;
  db.transaction(() => {
    const attempt = requireTransitionLease(db, input); const intent = readTransitionIntent(db, attempt.transitionId);
    if (!intent || intent.request.kind !== "transition.emergency-local" || !intent.incidentId
      || !["fenced", "proven"].includes(attempt.phase) || attempt.cutoffAt === null) invalid();
    assertTransitionPredecessor(db, intent);
    capture = readEmergencyCapture(db, intent.transitionId);
    if (capture) return;
    capture = MemoryEmergencyCaptureSchema.parse({ version: 1, captureId: randomUUID(), transitionId: intent.transitionId,
      incidentId: intent.incidentId, operationId: intent.operationId, attemptId: attempt.attemptId, generation: attempt.generation,
      predecessorEpochId: intent.request.expected.predecessorEpochId, identityHash: transitionLocalHash(intent.request.expected), createdAt: input.now });
    db.prepare("INSERT INTO memory_transition_emergency_captures VALUES(:capture,:transition,:incident,:json)")
      .run({ capture: capture.captureId, transition: capture.transitionId, incident: capture.incidentId, json: JSON.stringify(capture) });
  });
  return capture ?? invalid();
}

export function readEmergencyIncident(db: Database, transitionId: string): HindsightIncidentManifest | undefined {
  const row = db.prepare("SELECT * FROM memory_transition_incidents WHERE transition_id=:id").get({ id: transitionId });
  if (!row) return undefined;
  const value = HindsightIncidentManifestSchema.parse(JSON.parse(String(row.manifest_json)));
  const capture = readEmergencyCapture(db, transitionId);
  if (!capture || !value.transition || value.incidentId !== row.incident_id || value.incidentId !== capture.incidentId
    || value.authorityEpochId !== capture.predecessorEpochId || transitionLocalHash(value.transition.capture) !== transitionLocalHash(capture)
    || transitionLocalHash(value) !== row.manifest_hash) invalid();
  const { factsHash, ...facts } = value.transition;
  if (factsHash !== transitionLocalHash(facts)) invalid();
  return value;
}

/** Only the producer calls this after digest-verified artifact read-back. It never publishes an authority. */
export function acknowledgeEmergencyIncident(db: Database, input: { lease: TransitionLease; now: string; manifest: HindsightIncidentManifest }): void {
  db.transaction(() => {
    requireTransitionLease(db, input);
    const capture = readEmergencyCapture(db, input.lease.transitionId);
    const manifest = HindsightIncidentManifestSchema.parse(input.manifest);
    if (!capture || !manifest.transition || manifest.incidentId !== capture.incidentId
      || manifest.authorityEpochId !== capture.predecessorEpochId
      || transitionLocalHash(manifest.transition.capture) !== transitionLocalHash(capture)) invalid();
    const prior = readEmergencyIncident(db, capture.transitionId);
    if (prior) { if (transitionLocalHash(prior) !== transitionLocalHash(manifest)) invalid(); return; }
    db.prepare("INSERT INTO memory_transition_incidents VALUES(:incident,:transition,:hash,:json)")
      .run({ incident: capture.incidentId, transition: capture.transitionId, hash: transitionLocalHash(manifest), json: JSON.stringify(manifest) });
  });
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
