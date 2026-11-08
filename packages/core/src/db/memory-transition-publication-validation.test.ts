import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransitionPublicationFixture } from "../testing/memory-transition-publication-fixtures.ts";
import { publishMemoryTransition } from "./memory-transition-publication-repo.ts";
import { readVerifiedTransitionPublication } from "./memory-transition-publication-reader.ts";
import * as native from "../memory/transitions/transition-native-evidence.ts";
import { createCanonicalLocalRuntime } from "../memory/canonical-local-runtime.ts";
import { createCanonicalIngestionRepo } from "./canonical-ingestion-repo.ts";
import { sanitizeCommittedPrimarySpan } from "../memory/canonical-ingestion-source.ts";
import { W3_AT } from "../testing/memory-transition-candidate-fixtures.ts";
import { createStructuredMemoryBlockRepo } from "./structured-memory-block-repo.ts";
import type { Database } from "./sqlite.ts";
import { ZodError } from "zod";

afterEach(() => vi.restoreAllMocks());
function removeFixtureGuards(db: Database, table: string) {
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=:table").all({ table })) {
    db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`);
  }
}

describe("independent publication verification", () => {
  it("classifies a null stored publication as invalid proof shape", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const receipt = publishMemoryTransition(f.db, f.prove());
      f.db.transaction(() => {
        removeFixtureGuards(f.db, "memory_transition_publications");
        f.db.prepare("UPDATE memory_transition_publications SET publication_json='null' WHERE receipt_id=:id")
          .run({ id: receipt.receiptId });
      });
      expect(() => readVerifiedTransitionPublication(f.db, receipt.receiptId)).toThrow(ZodError);
    } finally { await f.close(); }
  });

  it("fully verifies each new read and lost-COMMIT replay", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const input = f.prove(); const receipt = publishMemoryTransition(f.db, input);
      const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
      for (let index = 0; index < 2; index++) {
        expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).candidateId).toBe(f.candidate.candidateId);
        expect(verify).toHaveBeenCalledTimes(f.proofs.length); verify.mockClear();
      }
      expect(publishMemoryTransition(f.db, input)).toEqual(receipt);
      expect(verify).toHaveBeenCalledTimes(f.proofs.length);
    } finally { await f.close(); }
  });

  it.each(["native-body", "native-delete", "native-transition", "candidate", "baseline", "receipt", "proof", "publication"])(
    "rejects changed immutable %s at the next full boundary, then accepts restored bytes", async (damage) => {
      const f = await createTransitionPublicationFixture();
      try {
        const receipt = publishMemoryTransition(f.db, f.prove());
        readVerifiedTransitionPublication(f.db, receipt.receiptId);
        const table = damage.startsWith("native") ? "memory_transition_native_evidence" : {
          candidate: "memory_transition_candidates", baseline: "memory_transition_baselines", receipt: "memory_transition_receipts",
          proof: "memory_transition_evidence", publication: "memory_transition_publications" }[damage]!;
        expect(() => f.db.transaction(() => {
          removeFixtureGuards(f.db, table);
          if (damage === "native-delete") f.db.exec(`DELETE FROM ${table}`);
          else if (damage === "native-transition") {
            f.db.exec("PRAGMA defer_foreign_keys=ON");
            f.db.exec(`UPDATE ${table} SET transition_id='foreign'`);
          } else {
            const column = ["native-body", "candidate", "baseline"].includes(damage) ? "body" : `${damage}_json`;
            for (const row of f.db.prepare(`SELECT rowid AS key, ${column} AS value FROM ${table}`).all()) {
              const value = JSON.parse(row.value instanceof Uint8Array ? Buffer.from(row.value).toString("utf8") : String(row.value));
              if (damage === "native-body") value.status.proof.proof_hash = "0".repeat(64);
              else if (damage === "proof") value.fencedManifestHash = "0".repeat(64);
              else if (damage === "publication") value.publicationId = "0".repeat(64);
              else value.mappingHash = "0".repeat(64);
              const text = JSON.stringify(value);
              f.db.prepare(`UPDATE ${table} SET ${column}=:value WHERE rowid=:key`)
                .run({ value: column === "body" ? Buffer.from(text) : text, key: row.key! });
            }
          }
          expect(() => readVerifiedTransitionPublication(f.db, receipt.receiptId)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
          throw new Error("ROLLBACK_TEST_DAMAGE");
        })).toThrow("ROLLBACK_TEST_DAMAGE");
        expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).candidateId).toBe(f.candidate.candidateId);
      } finally { await f.close(); }
    });

  it.each(["marker", "active-epoch", "predecessor", "member", "witness", "cutoff"])("rereads mutable %s on a later full proof", async (damage) => {
    const f = await createTransitionPublicationFixture();
    try {
      const session = f.custody.begin({ characterId: "taki", repo: f.timeline });
      session.repo.append({ characterId: "taki", role: "user", content: "current custody must remain checked" }); session.finalize();
      const receipt = publishMemoryTransition(f.db, f.prove()); readVerifiedTransitionPublication(f.db, receipt.receiptId);
      if (damage === "marker") f.db.prepare("UPDATE memory_authority_selection SET replica_checkpoint_digest=:hash").run({ hash: "0".repeat(64) });
      if (damage === "active-epoch") f.db.prepare("UPDATE canonical_memory_authority_epochs SET provider_lineage_id='foreign' WHERE epoch_id=:id").run({ id: receipt.newEpochId });
      if (damage === "predecessor") f.db.exec("UPDATE canonical_memory_authority_epochs SET provider_lineage_id='foreign' WHERE epoch_id='hindsight-epoch'");
      if (damage === "member") f.db.exec("DELETE FROM primary_memory_members");
      if (damage === "witness") f.db.exec("DELETE FROM canonical_memory_primary_commits");
      if (damage === "cutoff") f.db.exec("UPDATE memory_transition_attempts SET attempt_json=json_set(attempt_json,'$.cutoffSequence',99)");
      expect(() => readVerifiedTransitionPublication(f.db, receipt.receiptId)).toThrow();
    } finally { await f.close(); }
  });

  it("allows current Local edits, Blocks and legal custody consumption, but rejects a fabricated consumed span", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const session = f.custody.begin({ characterId: "taki", repo: f.timeline });
      const entry = session.repo.append({ characterId: "taki", role: "user", content: "actual pending custody" });
      const receipt = publishMemoryTransition(f.db, f.prove()); readVerifiedTransitionPublication(f.db, receipt.receiptId);
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
      expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).candidateId).toBe(f.candidate.candidateId);
      state = journal.saveGate({ state, gate: { decision: "skip" }, now: W3_AT }); journal.complete({ state, now: W3_AT });
      f.timeline.deleteEntry("taki", entry.seq);
      expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).candidateId).toBe(f.candidate.candidateId);
      expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).candidateId).toBe(f.candidate.candidateId);
      f.db.exec("UPDATE canonical_memory_ingestion_spans SET state='pending'");
      expect(() => readVerifiedTransitionPublication(f.db, receipt.receiptId)).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    } finally { await f.close(); }
  });
});
