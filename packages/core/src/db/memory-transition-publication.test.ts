import { describe, expect, it, vi } from "vitest";
import { createTransitionPublicationFixture } from "../testing/memory-transition-publication-fixtures.ts";
import { publishMemoryTransition } from "./memory-transition-publication-repo.ts";
import { readVerifiedTransitionPublication } from "./memory-transition-publication-reader.ts";
import { readMemoryAuthoritySelection } from "../memory/legacy-migration/legacy-activation-repo.ts";
import { createCanonicalLocalRuntime } from "../memory/canonical-local-runtime.ts";
import { join } from "node:path";
import { openDatabase } from "./sqlite.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { createPrimaryMemoryCustody } from "./primary-memory-custody-repo.ts";
import { createCanonicalIngestionSourceRepo } from "./canonical-ingestion-source-repo.ts";
import { selectMemoryRuntime } from "../memory/runtime-selector.ts";

describe("receipt-proven transition publication", () => {
  it.each(["marker", "epoch", "candidate", "publication"])("refuses a corrupted %s join after reopen instead of enabling a provider", async (part) => {
    const f = await createTransitionPublicationFixture();
    try {
      const receipt = publishMemoryTransition(f.db, f.prove());
      if (part === "marker") f.db.prepare("UPDATE memory_authority_selection SET replica_checkpoint_digest=:hash").run({ hash: "a".repeat(64) });
      else if (part === "epoch") f.db.prepare("UPDATE canonical_memory_authority_epochs SET provider_lineage_id='foreign' WHERE epoch_id=:id").run({ id: receipt.newEpochId });
      else if (part === "candidate") {
        expect(() => f.db.exec("UPDATE memory_transition_candidates SET body=x'7b7d'")).toThrow("immutable");
        f.db.exec("DROP TRIGGER memory_transition_candidates_immutable_update; UPDATE memory_transition_candidates SET body=x'7b7d'");
      } else {
        expect(() => f.db.exec("UPDATE memory_transition_publications SET publication_json='{}'")).toThrow("immutable");
        f.db.exec("DROP TRIGGER memory_transition_publications_no_update; UPDATE memory_transition_publications SET publication_json='{}'");
      }
      const reopened = openDatabase({ path: join(f.dataDir, "memory.sqlite"), migrations: MIGRATIONS });
      try {
        expect(() => readMemoryAuthoritySelection(reopened)).toThrow();
        const construct = vi.fn((): never => { throw new Error("must not construct a provider"); });
        expect(() => selectMemoryRuntime({ db: reopened, createCanonical: construct, createLegacy: construct, createHindsight: construct })).toThrow();
        expect(construct).not.toHaveBeenCalled();
      } finally { reopened.close(); }
    } finally { await f.close(); }
  });
  it("refuses a late Character absent from the complete candidate scopes without changing authority", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const marker = readMemoryAuthoritySelection(f.db); const input = f.prove();
      f.timeline.append({ characterId: "late-character", role: "user", content: "Arrived during drain." });
      expect(() => publishMemoryTransition(f.db, input)).toThrow("MEMORY_TRANSITION_STALE");
      expect(readMemoryAuthoritySelection(f.db)).toEqual(marker);
      expect(f.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(0);
    } finally { await f.close(); }
  });
  it("publishes real Local rows and a distinct receipt while preserving B4 history; lost replies reconcile", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const historical = f.db.prepare("SELECT * FROM hindsight_authority_activation_receipts").all();
      const input = f.prove(); const receipt = publishMemoryTransition(f.db, input);
      expect(readMemoryAuthoritySelection(f.db)).toMatchObject({ mode: "canonical-local", epochId: receipt.newEpochId,
        transitionReceiptId: receipt.receiptId });
      expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).candidateId).toBe(f.candidate.candidateId);
      expect(() => f.db.exec("INSERT OR REPLACE INTO memory_transition_publications SELECT * FROM memory_transition_publications")).toThrow("immutable");
      expect(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_units WHERE authority_epoch_id=:epoch").get({ epoch: receipt.newEpochId })?.n).toBe(2);
      expect(f.db.prepare("SELECT * FROM hindsight_authority_activation_receipts").all()).toEqual(historical);
      expect(publishMemoryTransition(f.db, input)).toEqual(receipt);
      expect(createCanonicalLocalRuntime({ db: f.db, epochId: receipt.newEpochId }).provider.providerId).toBe("local");
    } finally { await f.close(); }
  });
  it.each(["canonical_memory_authority_epochs", "canonical_memory_units", "canonical_memory_policy",
    "memory_transition_receipts", "memory_transition_publications", "memory_authority_selection", "COMMIT"])(
    "rolls back the entire publication on %s failure", async (table) => {
      const f = await createTransitionPublicationFixture();
      try {
        const input = f.prove(); const marker = f.db.prepare("SELECT * FROM memory_authority_selection").get();
        if (table === "COMMIT") {
          f.db.exec("CREATE TABLE w4_missing(id TEXT PRIMARY KEY); CREATE TABLE w4_deferred(id TEXT REFERENCES w4_missing(id) DEFERRABLE INITIALLY DEFERRED)");
          f.db.exec("CREATE TRIGGER w4_failure AFTER INSERT ON memory_transition_publications BEGIN INSERT INTO w4_deferred VALUES('missing'); END");
        } else f.db.exec(`CREATE TRIGGER w4_failure BEFORE ${table === "memory_authority_selection" ? "UPDATE" : "INSERT"} ON ${table}
          BEGIN SELECT RAISE(ABORT,'owned publication failure'); END`);
        expect(() => publishMemoryTransition(f.db, input)).toThrow();
        expect(f.db.prepare("SELECT * FROM memory_authority_selection").get()).toEqual(marker);
        expect(f.db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state").get()?.active_epoch_id).toBe("hindsight-epoch");
        expect(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_banks WHERE authority_epoch_id=:epoch").get({ epoch: f.candidate.targetEpochId })?.n).toBe(0);
        expect(f.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(0);
        f.db.exec("DROP TRIGGER w4_failure");
        expect(publishMemoryTransition(f.db, input).newEpochId).toBe(f.candidate.targetEpochId);
      } finally { await f.close(); }
    });
  it("reopens the complete receipt and carries a late primary append/finalize through an unavailable binding", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const session = f.custody.begin({ characterId: "taki", repo: f.timeline });
      const first = session.repo.append({ characterId: "taki", role: "user", content: "before the authority commit" });
      const receipt = publishMemoryTransition(f.db, f.prove());
      const last = session.repo.append({ characterId: "taki", role: "assistant", content: "after the commit, before binding" });
      session.finalize(); session.finalize();
      const reopened = openDatabase({ path: join(f.dataDir, "memory.sqlite"), migrations: MIGRATIONS });
      try {
        expect(readMemoryAuthoritySelection(reopened).transitionReceiptId).toBe(receipt.receiptId);
        expect(createPrimaryMemoryCustody({ db: reopened, bootId: "restart" }).reconcile()).toBe(0);
        const witnesses = createCanonicalIngestionSourceRepo(reopened).pendingEntries({ epochId: receipt.newEpochId,
          characterId: "taki", throughSeq: last.seq });
        expect(witnesses.map((row) => row.entry.seq)).toEqual([first.seq, last.seq]);
      } finally { reopened.close(); }
    } finally { await f.close(); }
  });
});
