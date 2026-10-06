import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmergencyCandidateFixture } from "../testing/memory-transition-emergency-fixtures.ts";
import { W3_AT } from "../testing/memory-transition-candidate-fixtures.ts";
import { readVerifiedEmergencyCandidate } from "./memory-transition-emergency-candidate.ts";
import { publishMemoryTransition } from "./memory-transition-publication-repo.ts";
import { readVerifiedTransitionPublication } from "./memory-transition-publication-reader.ts";
import { readTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import { discoverTransitionLocal } from "./memory-transition-local-capture.ts";
import { readMemoryAuthoritySelection } from "../memory/legacy-migration/legacy-activation-repo.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { sortState } from "../memory/transitions/transition-local-candidate.ts";
import { createHindsightIngestionRepo } from "./hindsight-ingestion-repo.ts";
import { sanitizeCommittedPrimarySpan } from "../memory/canonical-ingestion-source.ts";
import { createCanonicalIngestionSourceRepo } from "./canonical-ingestion-source-repo.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("emergency surviving candidate and atomic publication", () => {
  it("preserves mixed unknown and unconsumed primary members without re-adopting the unknown member", async () => {
    let first = 0; let last = 0; let sourceEpoch = "";
    const f = await createEmergencyCandidateFixture({ beforeEmergency: (h) => {
      sourceEpoch = readMemoryAuthoritySelection(h.db).epochId!;
      const session = h.runtime.custody.begin({ characterId: "taki", repo: h.timeline });
      first = session.repo.append({ characterId: "taki", role: "user", content: "unknown old ingestion" }).seq;
      last = session.repo.append({ characterId: "taki", role: "assistant", content: "unconsumed exact member" }).seq;
      session.finalize();
      const journal = createHindsightIngestionRepo({ db: h.db, pending: { get: () => undefined } });
      const scope = { epochId: sourceEpoch, characterId: "taki" };
      journal.start({ ...scope, now: W3_AT, source: sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: first,
        entries: journal.pendingEntries({ ...scope, throughSeq: first }) }) });
    } });
    try {
      const unknown = f.db.prepare("SELECT * FROM hindsight_ingestion_spans WHERE authority_epoch_id=:epoch").all({ epoch: sourceEpoch });
      const receipt = publishMemoryTransition(f.db, f.prove());
      const publication = readVerifiedTransitionPublication(f.db, receipt.receiptId);
      expect(publication.sourceCustody.groups[0]!.members.map((row) => row.seq)).toEqual([first, last]);
      expect(publication.sourceCustody.witnesses.map((row) => row.seq)).toEqual([last]);
      const local = createCanonicalIngestionSourceRepo(f.db);
      const entries = f.timeline.rangeAscending("taki", 0, last).filter((row) => row.seq === first || row.seq === last);
      local.recordPrimaryCommitted({ characterId: "taki", entries, epochId: receipt.newEpochId });
      expect(local.pendingEntries({ epochId: receipt.newEpochId, characterId: "taki", throughSeq: last }).map((row) => row.entry.seq)).toEqual([last]);
      expect(f.db.prepare("SELECT * FROM hindsight_ingestion_spans WHERE authority_epoch_id=:epoch").all({ epoch: sourceEpoch })).toEqual(unknown);
      expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).receiptId).toBe(receipt.receiptId);
    } finally { await f.close(); }
  }, 30_000);
  it("rebuilds original logical state and selects Local with one immutable incident/foreign-branch receipt", async () => {
    const f = await createEmergencyCandidateFixture();
    try {
      expect(f.sealed.manifest.transition?.banks.every((bank) => bank.evidence === "paired-replica" && bank.survivingEvidenceId)).toBe(true);
      expect(readVerifiedEmergencyCandidate(f.db, f.candidate.candidateId)).toEqual(f.candidate);
      const receipt = publishMemoryTransition(f.db, f.prove());
      expect(receipt.kind).toBe("transition.emergency-local");
      const publication = readVerifiedTransitionPublication(f.db, receipt.receiptId);
      expect(publication).toMatchObject({ version: 2, kind: "emergency-surviving", incidentId: f.capture.incidentId, baselineId: null });
      expect(readMemoryAuthoritySelection(f.db)).toMatchObject({ mode: "canonical-local", epochId: receipt.newEpochId });
      const installed = discoverTransitionLocal(f.db, receipt.newEpochId).state; sortState(installed);
      for (const key of ["banks", "sources", "records", "derived", "blocks", "historicalReferences", "sourceAliases", "sourceSets"] as const) {
        expect(transitionLocalHash(installed[key]), key).toBe(transitionLocalHash(f.candidate.state[key]));
      }
      expect(f.db.prepare("SELECT * FROM memory_transition_foreign_branches").all()).toHaveLength(1);
      expect(publishMemoryTransition(f.db, { ...f.work, candidateId: f.candidate.candidateId })).toEqual(receipt);
      expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { await f.close(); }
  }, 60_000);

  it("rolls back the entire authority transaction when immutable receipt insertion fails", async () => {
    const f = await createEmergencyCandidateFixture();
    try {
      const work = f.prove(); const predecessor = readMemoryAuthoritySelection(f.db);
      f.db.exec("CREATE TRIGGER owned_receipt_failure BEFORE INSERT ON memory_transition_receipts BEGIN SELECT RAISE(ABORT,'owned receipt failure'); END");
      expect(() => publishMemoryTransition(f.db, work)).toThrow("owned receipt failure");
      expect(readMemoryAuthoritySelection(f.db)).toEqual(predecessor);
      expect(readTransitionReceipt(f.db, f.intent.transitionId)).toBeUndefined();
      expect(f.db.prepare("SELECT * FROM memory_transition_foreign_branches").all()).toEqual([]);
      expect(f.db.prepare("SELECT * FROM canonical_memory_authority_epochs WHERE epoch_id=:id").get({ id: f.candidate.targetEpochId })).toBeUndefined();
      expect(await f.store.readIncident(f.capture.incidentId)).toEqual(f.sealed.manifest);
    } finally { await f.close(); }
  }, 60_000);
});
