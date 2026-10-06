import { describe, expect, it } from "vitest";
import { createTransitionPublicationFixture } from "../testing/memory-transition-publication-fixtures.ts";
import { W3_AT } from "../testing/memory-transition-candidate-fixtures.ts";
import { publishMemoryTransition } from "./memory-transition-publication-repo.ts";
import { readVerifiedTransitionPublication } from "./memory-transition-publication-reader.ts";
import { createCanonicalLocalRuntime } from "../memory/canonical-local-runtime.ts";
import { createCanonicalIngestionRepo } from "./canonical-ingestion-repo.ts";
import { createHindsightIngestionRepo } from "./hindsight-ingestion-repo.ts";
import { ingestionSourceDigest, sanitizeCommittedPrimarySpan } from "../memory/canonical-ingestion-source.ts";
import { readTransitionCustody } from "./memory-transition-custody.ts";

describe("transition custody boot evidence", () => {
  it.each(["source", "target"] as const)("validates completed %s span membership even before Timeline compaction", async (side) => {
    const f = await createTransitionPublicationFixture();
    try {
      const session = f.custody.begin({ characterId: "taki", repo: f.timeline });
      const entry = session.repo.append({ characterId: "taki", role: "user", content: "exact completed membership" }); session.finalize();
      const receipt = side === "target" ? publishMemoryTransition(f.db, f.prove()) : null;
      const epochId = receipt?.newEpochId ?? "hindsight-epoch";
      const journal = receipt ? createCanonicalIngestionRepo({ db: f.db,
        maintenance: createCanonicalLocalRuntime({ db: f.db, epochId }).maintenanceStore })
        : createHindsightIngestionRepo({ db: f.db, pending: { get: () => undefined } });
      const scope = { epochId, characterId: "taki" };
      const source = sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: entry.seq,
        entries: journal.pendingEntries({ ...scope, throughSeq: entry.seq }) });
      const state = journal.start({ ...scope, source, now: W3_AT });
      // Both real ingestion journals produce the same skip completion; keep their typed states separate.
      if (receipt) {
        const local = createCanonicalIngestionRepo({ db: f.db,
          maintenance: createCanonicalLocalRuntime({ db: f.db, epochId }).maintenanceStore });
        const pending = local.pending(scope)!;
        local.complete({ state: local.saveGate({ state: pending, gate: { decision: "skip" }, now: W3_AT }), now: W3_AT });
      } else {
        const native = createHindsightIngestionRepo({ db: f.db, pending: { get: () => undefined } });
        const pending = native.pending(scope)!;
        native.complete({ state: native.saveGate({ state: pending, gate: { decision: "skip" }, now: W3_AT }), now: W3_AT });
      }
      const read = () => receipt ? readVerifiedTransitionPublication(f.db, receipt.receiptId) : readTransitionCustody(f.db, epochId);
      expect(read).not.toThrow();
      const damaged = { ...source, proofs: source.proofs.map((proof) => ({ ...proof, digest: "0".repeat(64) })) };
      const table = receipt ? "canonical_memory_ingestion_spans" : "hindsight_ingestion_spans";
      f.db.prepare(`UPDATE ${table} SET source_json=:json,source_hash=:hash WHERE span_id=:id`)
        .run({ json: JSON.stringify(damaged), hash: ingestionSourceDigest(damaged), id: state.spanId });
      expect(read).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    } finally { await f.close(); }
  });

  it("rejects a finalized source group whose last member disappeared before proof", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const session = f.custody.begin({ characterId: "taki", repo: f.timeline });
      session.repo.append({ characterId: "taki", role: "user", content: "finalized source" }); session.finalize();
      f.db.prepare("DELETE FROM primary_memory_members WHERE group_id=:id").run({ id: session.groupId });
      expect(() => f.prove()).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    } finally { await f.close(); }
  });

  it.each(["member-missing", "member-foreign", "witness-missing", "witness-foreign", "predecessor-provider", "predecessor-lineage"])(
    "refuses %s after a genuine publication", async (damage) => {
      const f = await createTransitionPublicationFixture();
      try {
        const session = f.custody.begin({ characterId: "taki", repo: f.timeline });
        session.repo.append({ characterId: "taki", role: "user", content: "exact custody" }); session.finalize();
        const receipt = publishMemoryTransition(f.db, f.prove());
        if (damage === "member-missing") f.db.exec("DELETE FROM primary_memory_members");
        if (damage === "member-foreign") f.db.exec("UPDATE primary_memory_members SET entry_id='foreign'");
        if (damage === "witness-missing") f.db.exec("DELETE FROM canonical_memory_primary_commits");
        if (damage === "witness-foreign") f.db.exec("UPDATE canonical_memory_primary_commits SET run_id='foreign'");
        if (damage === "predecessor-provider") f.db.exec("UPDATE canonical_memory_authority_epochs SET provider_id='local' WHERE epoch_id='hindsight-epoch'");
        if (damage === "predecessor-lineage") f.db.exec("UPDATE canonical_memory_authority_epochs SET provider_lineage_id='foreign' WHERE epoch_id='hindsight-epoch'");
        expect(() => readVerifiedTransitionPublication(f.db, receipt.receiptId)).toThrow();
      } finally { await f.close(); }
    });

  it("accepts actual target ingestion in progress and complete compacted rows, never a missing pending source", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const session = f.custody.begin({ characterId: "taki", repo: f.timeline });
      const entry = session.repo.append({ characterId: "taki", role: "user", content: "consumed exactly once" }); session.finalize();
      const receipt = publishMemoryTransition(f.db, f.prove());
      const runtime = createCanonicalLocalRuntime({ db: f.db, epochId: receipt.newEpochId });
      const journal = createCanonicalIngestionRepo({ db: f.db, maintenance: runtime.maintenanceStore });
      const scope = { epochId: receipt.newEpochId, characterId: "taki" };
      const source = sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: entry.seq,
        entries: journal.pendingEntries({ ...scope, throughSeq: entry.seq }) });
      let state = journal.start({ ...scope, source, now: W3_AT });
      expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).receiptId).toBe(receipt.receiptId);
      expect(() => readTransitionCustody(f.db, receipt.newEpochId)).toThrow("MEMORY_INGESTION_INCOMPLETE");
      state = journal.saveGate({ state, gate: { decision: "skip" }, now: W3_AT }); journal.complete({ state, now: W3_AT });
      f.timeline.deleteEntry("taki", entry.seq);
      expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).receiptId).toBe(receipt.receiptId);
      expect(journal.pendingEntries({ ...scope, throughSeq: entry.seq })).toEqual([]);
      f.db.exec("UPDATE canonical_memory_ingestion_spans SET state='pending'");
      expect(() => readVerifiedTransitionPublication(f.db, receipt.receiptId)).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    } finally { await f.close(); }
  });

  it("carries only outstanding members of a partly consumed and compacted source group", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const session = f.custody.begin({ characterId: "taki", repo: f.timeline });
      const first = session.repo.append({ characterId: "taki", role: "user", content: "already processed" });
      const last = session.repo.append({ characterId: "taki", role: "assistant", content: "still pending" }); session.finalize();
      const journal = createHindsightIngestionRepo({ db: f.db, pending: { get: () => undefined } });
      const scope = { epochId: "hindsight-epoch", characterId: "taki" };
      const source = sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: first.seq,
        entries: journal.pendingEntries({ ...scope, throughSeq: first.seq }) });
      let state = journal.start({ ...scope, source, now: W3_AT });
      state = journal.saveGate({ state, gate: { decision: "skip" }, now: W3_AT }); journal.complete({ state, now: W3_AT });
      f.timeline.deleteEntry("taki", first.seq);
      const receipt = publishMemoryTransition(f.db, f.prove());
      const publication = readVerifiedTransitionPublication(f.db, receipt.receiptId);
      expect(publication.sourceCustody.groups[0]?.members.map((member) => member.seq)).toEqual([first.seq, last.seq]);
      expect(publication.sourceCustody.witnesses.map((row) => row.seq)).toEqual([last.seq]);
      expect(f.db.prepare("SELECT timeline_seq FROM canonical_memory_primary_commits").all()).toEqual([{ timeline_seq: last.seq }]);
    } finally { await f.close(); }
  });

  it("accepts a real user-only retraction after publication", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const session = f.custody.begin({ characterId: "taki", repo: f.timeline });
      const first = session.repo.append({ characterId: "taki", role: "user", content: "cancelled before response" });
      const receipt = publishMemoryTransition(f.db, f.prove());
      session.repo.deleteEntry("taki", first.seq); session.finalize();
      expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).receiptId).toBe(receipt.receiptId);
      expect(f.db.prepare("SELECT * FROM canonical_memory_primary_commits").all()).toEqual([]);
    } finally { await f.close(); }
  });
});
