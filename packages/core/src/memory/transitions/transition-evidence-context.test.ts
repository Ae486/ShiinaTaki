import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTransitionCandidateFixture, W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { createTransitionPublicationFixture } from "../../testing/memory-transition-publication-fixtures.ts";
import { persistTransitionNativeEvidence, readTransitionNativeEvidence } from "../../db/memory-transition-candidate-repo.ts";
import { readTransitionAttempt, requireTransitionLease } from "../../db/memory-transition-repo.ts";
import { publishMemoryTransition } from "../../db/memory-transition-publication-repo.ts";
import { readVerifiedTransitionPublication } from "../../db/memory-transition-publication-reader.ts";
import { buildTransitionLocalCandidate } from "./transition-local-candidate.ts";
import { withTransitionEvidenceContext, type TransitionEvidenceContext } from "./transition-evidence-context.ts";
import * as native from "./transition-native-evidence.ts";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const f = createTransitionCandidateFixture(db);
  for (const evidence of f.proofs) persistTransitionNativeEvidence(db, { ...f.input, evidence });
  return { ...f, db, id: f.proofs[0]!.evidenceId };
}
function corrupt(db: Database, id: string) {
  db.exec("DROP TRIGGER memory_transition_native_evidence_immutable_update");
  db.prepare("UPDATE memory_transition_native_evidence SET body=x'7b7d' WHERE id=:id").run({ id });
}

describe("synchronous transition evidence boundaries", () => {
  it("isolates mutable bundle views and rejects caller envelopes, another database and an expired context", () => {
    const f = fixture(); const other = openDatabase({ path: ":memory:", migrations: [] });
    let saved: TransitionEvidenceContext | undefined;
    try {
      withTransitionEvidenceContext(f.db, (context) => {
        saved = context;
        const evidence = readTransitionNativeEvidence(f.db, f.id, context);
        expect(() => context.bundle(structuredClone(evidence))).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        expect(() => readTransitionNativeEvidence(other, f.id, context)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        expect(() => evidence.nativePages.pop()).toThrow();
        const first = context.bundle(evidence); const body = [...first.bodies.values()][0]!;
        const bytes = Uint8Array.from(body.bytes);
        body.bytes.fill(0); first.bodies.clear();
        expect(() => first.pages.pop()).toThrow();
        expect(context.bundle(evidence).bodies.get(body.ref.body_id)?.bytes).toEqual(bytes);
      });
      expect(() => saved!.read(f.db, f.id)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(() => withTransitionEvidenceContext(f.db, () => undefined, saved)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    } finally { f.db.close(); other.close(); }
  });

  it("closes on throw or asynchronous misuse and nested synchronous calls retain their owner", () => {
    const f = fixture(); let saved: TransitionEvidenceContext | undefined;
    try {
      expect(() => withTransitionEvidenceContext(f.db, (context) => {
        saved = context; throw new Error("owned callback failure");
      })).toThrow("owned callback failure");
      expect(() => saved!.read(f.db, f.id)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(() => withTransitionEvidenceContext(f.db, (context) => {
        saved = context; return Promise.resolve();
      })).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(() => saved!.read(f.db, f.id)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      withTransitionEvidenceContext(f.db, (context) => {
        withTransitionEvidenceContext(f.db, (nested) => expect(nested.read(f.db, f.id).evidenceId).toBe(f.id), context);
        expect(context.read(f.db, f.id).evidenceId).toBe(f.id);
      });
    } finally { f.db.close(); }
  });

  it.each(["body", "transition_id", "slot", "delete"])("rejects changed actual %s in a live context", (field) => {
    const f = fixture();
    try {
      withTransitionEvidenceContext(f.db, (context) => {
        const evidence = context.read(f.db, f.id);
        if (field === "body") corrupt(f.db, f.id);
        else if (field === "delete") {
          f.db.exec("DROP TRIGGER memory_transition_native_evidence_immutable_delete");
          f.db.prepare("DELETE FROM memory_transition_native_evidence WHERE id=:id").run({ id: f.id });
        } else {
          f.db.exec("DROP TRIGGER memory_transition_native_evidence_immutable_update");
          f.db.exec("PRAGMA foreign_keys=OFF");
          f.db.prepare(`UPDATE memory_transition_native_evidence SET ${field}='changed' WHERE id=:id`).run({ id: f.id });
        }
        expect(() => context.read(f.db, f.id)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        expect(() => context.bundle(evidence)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      });
    } finally { f.db.close(); }
  });

  it("completes real candidate/proof/COMMIT under a finite lease with costly verification and no heartbeat", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      let elapsed = 0; const verify = native.verifyTransitionNativeEvidence;
      // Simulate expensive synchronous corpus validation, not wall-clock sleeps.
      // All real validation and publication joins still execute; each full pass costs 45 seconds.
      vi.spyOn(native, "verifyTransitionNativeEvidence").mockImplementation((evidence) => {
        const bundle = verify(evidence); elapsed += 45_000; return bundle;
      });
      f.input.currentTime = () => new Date(Date.parse(W3_AT) + elapsed).toISOString();
      f.input.assertConfiguration = () => { requireTransitionLease(f.db,
        { lease: f.input.lease, now: f.input.currentTime() }); };
      const candidate = buildTransitionLocalCandidate(f.db, { ...f.input, evidenceIds: f.proofs.map((e) => e.evidenceId) });
      expect(candidate).toEqual(f.candidate);
      const receipt = publishMemoryTransition(f.db, f.prove());
      f.input.lease = readTransitionAttempt(f.db, f.intent.transitionId)!;
      f.input.assertConfiguration();
      expect(f.db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state").get()?.active_epoch_id).toBe(candidate.targetEpochId);
      expect(f.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(1);
      // Reconstruct through a new boundary after the finite-lease scenario has finished.
      vi.restoreAllMocks();
      expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).candidateId).toBe(candidate.candidateId);
    } finally { await f.close(); }
  });

  it("still rejects genuine lease exhaustion and rolls back candidate and scope insertion", () => {
    const f = fixture();
    try {
      let elapsed = 0; const verify = native.verifyTransitionNativeEvidence;
      vi.spyOn(native, "verifyTransitionNativeEvidence").mockImplementation((evidence) => {
        const bundle = verify(evidence); elapsed += 300_000; return bundle;
      });
      expect(() => buildTransitionLocalCandidate(f.db, { ...f.input, evidenceIds: f.proofs.map((e) => e.evidenceId),
        assertConfiguration: () => { requireTransitionLease(f.db, { lease: f.lease,
          now: new Date(Date.parse(W3_AT) + elapsed).toISOString() }); } })).toThrow("MEMORY_TRANSITION_LEASE_LOST");
      expect(f.db.prepare("SELECT count(*) AS n FROM memory_transition_candidates").get()?.n).toBe(0);
      expect(f.db.prepare("SELECT count(*) AS n FROM memory_transition_scope_ids").get()?.n).toBe(0);
    } finally { f.db.close(); }
  });

  it("revalidates storage between candidate, proof and COMMIT and again after publication", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const input = f.prove(); const id = f.proofs[0]!.evidenceId;
      const original = f.db.prepare("SELECT body FROM memory_transition_native_evidence WHERE id=:id").get({ id })!.body!;
      const marker = f.db.prepare("SELECT * FROM memory_authority_selection").get();
      corrupt(f.db, id);
      expect(() => publishMemoryTransition(f.db, input)).toThrow();
      expect(f.db.prepare("SELECT * FROM memory_authority_selection").get()).toEqual(marker);
      expect(f.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(0);
      f.db.prepare("UPDATE memory_transition_native_evidence SET body=:body WHERE id=:id").run({ body: original, id });
      const receipt = publishMemoryTransition(f.db, input);
      f.db.prepare("UPDATE memory_transition_native_evidence SET body=x'7b7d' WHERE id=:id").run({ id });
      expect(() => readVerifiedTransitionPublication(f.db, receipt.receiptId)).toThrow();
    } finally { await f.close(); }
  });
});
