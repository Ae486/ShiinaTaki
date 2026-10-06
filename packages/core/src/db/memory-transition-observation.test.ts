import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransitionPublicationFixture } from "../testing/memory-transition-publication-fixtures.ts";
import { publishMemoryTransition } from "./memory-transition-publication-repo.ts";
import { createTransitionPublicationObserver, readVerifiedTransitionPublication } from "./memory-transition-publication-reader.ts";
import { readTransitionPublicationBoundary } from "./memory-transition-publication-proof.ts";
import { TransitionObservationStore } from "../memory/transitions/transition-observation-store.ts";
import { withTransitionObservationContext } from "../memory/transitions/transition-evidence-context.ts";
import * as native from "../memory/transitions/transition-native-evidence.ts";
import { createCanonicalLocalRuntime } from "../memory/canonical-local-runtime.ts";
import { createCanonicalIngestionRepo } from "./canonical-ingestion-repo.ts";
import { sanitizeCommittedPrimarySpan } from "../memory/canonical-ingestion-source.ts";
import { W3_AT } from "../testing/memory-transition-candidate-fixtures.ts";
import { createStructuredMemoryBlockRepo } from "./structured-memory-block-repo.ts";
import type { Database } from "./sqlite.ts";

afterEach(() => vi.restoreAllMocks());
function removeFixtureGuards(db: Database, table: string) {
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=:table").all({ table })) {
    db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`);
  }
}

describe("receipt-scoped verified observation", () => {
  it("reuses immutable computation while independent read, lost-COMMIT replay and closed/recreated observer verify afresh", async () => {
    const f = await createTransitionPublicationFixture(); const observer = createTransitionPublicationObserver(f.db);
    try {
      const input = f.prove(); const receipt = publishMemoryTransition(f.db, input);
      const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
      expect(observer.selected("binding-1")).toEqual({ epochId: receipt.newEpochId, provider: "local" });
      expect(verify).toHaveBeenCalledTimes(f.proofs.length); verify.mockClear();
      expect(observer.selected("binding-1")).toEqual({ epochId: receipt.newEpochId, provider: "local" });
      expect(verify).not.toHaveBeenCalled();
      readVerifiedTransitionPublication(f.db, receipt.receiptId);
      expect(verify).toHaveBeenCalledTimes(f.proofs.length); verify.mockClear();
      expect(publishMemoryTransition(f.db, input)).toEqual(receipt);
      expect(verify).toHaveBeenCalledTimes(f.proofs.length); verify.mockClear();
      observer.selected("replacement-binding"); expect(verify).toHaveBeenCalledTimes(f.proofs.length);
      observer.close(); expect(() => observer.selected("replacement-binding")).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      const reopened = createTransitionPublicationObserver(f.db); verify.mockClear();
      try { reopened.selected("replacement-binding"); expect(verify).toHaveBeenCalledTimes(f.proofs.length); }
      finally { reopened.close(); }
    } finally { observer.close(); await f.close(); }
  });

  it("rejects an observation context at both public independent publication boundaries", async () => {
    const f = await createTransitionPublicationFixture(); const store = new TransitionObservationStore(f.db);
    try {
      const input = f.prove(); const receipt = publishMemoryTransition(f.db, input);
      withTransitionObservationContext({ db: f.db, receiptId: receipt.receiptId, store }, (context) => {
        expect(() => readVerifiedTransitionPublication(f.db, receipt.receiptId, context)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        expect(() => readTransitionPublicationBoundary(f.db, input, context)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      });
      expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).candidateId).toBe(f.candidate.candidateId);
    } finally { store.close(); await f.close(); }
  });

  it.each(["native-body", "native-delete", "native-slot", "native-transition", "candidate", "baseline", "receipt", "proof", "publication"])(
    "rejects changed immutable %s after warming, then requires a new full seed after restored bytes", async (damage) => {
      const f = await createTransitionPublicationFixture(); const observer = createTransitionPublicationObserver(f.db);
      try {
        const receipt = publishMemoryTransition(f.db, f.prove()); observer.selected("binding");
        const table = damage.startsWith("native") ? "memory_transition_native_evidence" : {
          candidate: "memory_transition_candidates", baseline: "memory_transition_baselines", receipt: "memory_transition_receipts",
          proof: "memory_transition_evidence", publication: "memory_transition_publications" }[damage]!;
        removeFixtureGuards(f.db, table);
        f.db.exec("SAVEPOINT damage");
        if (damage === "native-delete") f.db.exec(`DELETE FROM ${table}`);
        else if (damage === "native-slot") f.db.exec(`UPDATE ${table} SET slot=slot || ':changed'`);
        else if (damage === "native-transition") {
          // A different admitted transition is unnecessary: a foreign row key must reject before any retained proof.
          f.db.exec("PRAGMA defer_foreign_keys=ON");
          f.db.exec(`UPDATE ${table} SET transition_id='foreign'`);
        } else if (["native-body", "candidate", "baseline"].includes(damage)) f.db.exec(`UPDATE ${table} SET body=x'7b7d'`);
        else f.db.exec(`UPDATE ${table} SET ${damage}_json='{}'`);
        expect(() => observer.selected("binding")).toThrow();
        // Initial full loading has historically ignored the slot label when reading by ID. The warm observer
        // additionally refuses a changed saved identity; retain that existing full-reader behavior explicitly.
        if (damage === "native-slot") expect(() => readVerifiedTransitionPublication(f.db, receipt.receiptId)).not.toThrow();
        else expect(() => readVerifiedTransitionPublication(f.db, receipt.receiptId)).toThrow();
        f.db.exec("ROLLBACK TO damage"); f.db.exec("RELEASE damage");
        const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
        expect(observer.selected("binding")?.epochId).toBe(receipt.newEpochId);
        expect(verify).toHaveBeenCalledTimes(f.proofs.length);
      } finally { observer.close(); await f.close(); }
    });

  it.each(["marker", "active-epoch", "predecessor", "member", "witness", "cutoff"])("rereads mutable %s after warming", async (damage) => {
    const f = await createTransitionPublicationFixture(); const observer = createTransitionPublicationObserver(f.db);
    try {
      const session = f.custody.begin({ characterId: "taki", repo: f.timeline });
      session.repo.append({ characterId: "taki", role: "user", content: "current custody must remain checked" }); session.finalize();
      const receipt = publishMemoryTransition(f.db, f.prove()); observer.selected("binding");
      if (damage === "marker") f.db.prepare("UPDATE memory_authority_selection SET replica_checkpoint_digest=:hash").run({ hash: "0".repeat(64) });
      if (damage === "active-epoch") f.db.prepare("UPDATE canonical_memory_authority_epochs SET provider_lineage_id='foreign' WHERE epoch_id=:id").run({ id: receipt.newEpochId });
      if (damage === "predecessor") f.db.exec("UPDATE canonical_memory_authority_epochs SET provider_lineage_id='foreign' WHERE epoch_id='hindsight-epoch'");
      if (damage === "member") f.db.exec("DELETE FROM primary_memory_members");
      if (damage === "witness") f.db.exec("DELETE FROM canonical_memory_primary_commits");
      if (damage === "cutoff") f.db.exec("UPDATE memory_transition_attempts SET attempt_json=json_set(attempt_json,'$.cutoffSequence',99)");
      expect(() => observer.selected("binding")).toThrow();
      expect(() => readVerifiedTransitionPublication(f.db, receipt.receiptId)).toThrow();
    } finally { observer.close(); await f.close(); }
  });

  it("allows current Local edits, Blocks and legal custody consumption, but rejects a fabricated consumed span", async () => {
    const f = await createTransitionPublicationFixture(); const observer = createTransitionPublicationObserver(f.db);
    try {
      const session = f.custody.begin({ characterId: "taki", repo: f.timeline });
      const entry = session.repo.append({ characterId: "taki", role: "user", content: "actual pending custody" });
      const receipt = publishMemoryTransition(f.db, f.prove()); observer.selected("binding");
      session.repo.append({ characterId: "taki", role: "assistant", content: "legal late append" }); session.finalize();
      const runtime = createCanonicalLocalRuntime({ db: f.db, epochId: receipt.newEpochId });
      const record = runtime.maintenanceStore.list({ epochId: receipt.newEpochId, characterId: null })[0]!;
      runtime.maintenanceStore.policyEdit({ epochId: receipt.newEpochId, bankId: record.unit.bankId, memoryId: record.unit.memoryId,
        expectedRevision: record.unit.revision, characterId: null, requestId: "observer-legal-policy",
        patch: { layerId: "activity", retention: { kind: "rolling-window", days: 7 } }, now: W3_AT });
      expect(runtime.maintenanceStore.record({ epochId: receipt.newEpochId, bankId: record.unit.bankId,
        memoryId: record.unit.memoryId, characterId: null })?.policy.layerId).toBe("activity");
      createStructuredMemoryBlockRepo(f.db).replace({ blockId: "user-card", scope: { kind: "global", characterId: null },
        content: "Legal current Block edit", actor: "user", expectedEpochId: receipt.newEpochId, expectedRevision: 0, now: W3_AT });
      const journal = createCanonicalIngestionRepo({ db: f.db, maintenance: runtime.maintenanceStore });
      const scope = { epochId: receipt.newEpochId, characterId: "taki" };
      const source = sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: entry.seq,
        entries: journal.pendingEntries({ ...scope, throughSeq: entry.seq }) });
      let state = journal.start({ ...scope, source, now: W3_AT });
      expect(observer.selected("binding")?.epochId).toBe(receipt.newEpochId);
      state = journal.saveGate({ state, gate: { decision: "skip" }, now: W3_AT }); journal.complete({ state, now: W3_AT });
      f.timeline.deleteEntry("taki", entry.seq);
      expect(observer.selected("binding")?.epochId).toBe(receipt.newEpochId);
      expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).candidateId).toBe(f.candidate.candidateId);
      f.db.exec("UPDATE canonical_memory_ingestion_spans SET state='pending'");
      expect(() => observer.selected("binding")).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    } finally { observer.close(); await f.close(); }
  });
});
