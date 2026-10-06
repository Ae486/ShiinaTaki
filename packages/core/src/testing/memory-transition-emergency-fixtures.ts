/**
 * INPUT:  owned synthetic healthy journey with actual Core operation/publication producers
 * OUTPUT: stopped Hindsight predecessor, original emergency incident and verified surviving candidate
 * POS:    core/testing — no private corpus, model calls or native service process
 */
import { randomUUID } from "node:crypto";
import type { MemoryTransitionIntent } from "@taki/shared";
import { createHealthyTransitionHarness } from "./memory-transition-healthy-fixtures.ts";
import { admitFixtureTransition, W3_AT } from "./memory-transition-candidate-fixtures.ts";
import { readEmergencyTransitionIdentity } from "../memory/transitions/transition-current-identity.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { DEFAULT_TRANSITION_QUEUE_POLICY, readTransitionAttempt, updateTransitionAttempt } from "../db/memory-transition-repo.ts";
import { reserveEmergencyCapture, acknowledgeEmergencyIncident } from "../db/memory-transition-emergency-repo.ts";
import { createHindsightBackupStore } from "../memory/hindsight-backup/hindsight-backup-store.ts";
import { sealEmergencyEvidence } from "../memory/hindsight-backup/hindsight-backup-emergency.ts";
import { openReadonlyDatabase } from "../db/sqlite.ts";
import { captureSurvivingBankEvidence } from "../db/memory-transition-surviving-capture.ts";
import { prepareEmergencyCandidate } from "../db/memory-transition-emergency-candidate.ts";
import { buildEmergencyPublicationProof } from "../db/memory-transition-emergency-publication.ts";
import { recordTransitionProof } from "../db/memory-transition-evidence-repo.ts";

export async function createEmergencyCandidateFixture(options: {
  beforeEmergency?(h: Awaited<ReturnType<typeof createHealthyTransitionHarness>>): void;
} = {}) {
  const h = await createHealthyTransitionHarness({ aliases: true });
  try {
    // The first healthy cycle materializes the fixture's genuinely bound policies. Emergency never creates them.
    for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
      const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
      if (h.owner.status(operation.operationId).state !== "completed") throw new Error("owned healthy fixture incomplete");
    }
    options.beforeEmergency?.(h);
    await h.runtime.stop();
    const expected = readEmergencyTransitionIdentity(h.db);
    const kind = "transition.emergency-local" as const;
    const intent: MemoryTransitionIntent = { version: 1, transitionId: randomUUID(), operationId: randomUUID(), actorId: "owned-emergency",
      admittedAt: W3_AT, queuePolicy: { ...DEFAULT_TRANSITION_QUEUE_POLICY }, incidentId: randomUUID(),
      request: { kind, requestId: randomUUID(), previewId: randomUUID(), expected, confirmation: "emergency-takeover",
        previewHash: canonicalPayloadHash(["taki-transition-preview.v1", kind, expected]) } };
    const lease = admitFixtureTransition(h.db, intent); const work = { lease, now: W3_AT,
      currentTime: () => h.clock.value, assertConfiguration: () => undefined };
    const capture = reserveEmergencyCapture(h.db, work); const store = createHindsightBackupStore(h.dataDir);
    const sealed = await sealEmergencyEvidence({ db: h.db, store, capture, lastVerified: null });
    acknowledgeEmergencyIncident(h.db, { ...work, manifest: sealed.manifest });
    const copy = openReadonlyDatabase(store.incidentCorePath(capture.incidentId));
    const evidence = (() => {
      try { return expected.banks.map((bank) => captureSurvivingBankEvidence(copy, { capture, bank, lineage: expected.sourceLineageId })); }
      finally { copy.close(); }
    })();
    const candidate = prepareEmergencyCandidate(h.db, { ...work, evidence });
    const prove = () => {
      const proof = buildEmergencyPublicationProof(h.db, { ...work, candidateId: candidate.candidateId });
      recordTransitionProof(h.db, { ...work, proof });
      work.lease = updateTransitionAttempt(h.db, { ...work, lease: readTransitionAttempt(h.db, intent.transitionId)!, patch: { phase: "proven" } });
      return { ...work, candidateId: candidate.candidateId };
    };
    return { ...h, intent, capture, sealed, store, evidence, candidate, work, prove };
  } catch (error) { await h.close(); throw error; }
}
