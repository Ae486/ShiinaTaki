import { describe, expect, it } from "vitest";
import { createTransitionPublicationFixture } from "../testing/memory-transition-publication-fixtures.ts";
import { publishMemoryTransition } from "./memory-transition-publication-repo.ts";
import { readVerifiedTransitionPublication } from "./memory-transition-publication-reader.ts";
import { discoverTransitionLocal } from "./memory-transition-local-capture.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";

describe("installed derived state publication", () => {
  it("preserves every model/directive when SQL inventory order differs from canonical candidate order", async () => {
    const f = await createTransitionPublicationFixture({ derived: true });
    try {
      expect(f.candidate.state.derived.some((row) => row.payload.kind === "mental_model")).toBe(true);
      expect(f.candidate.state.derived.some((row) => row.payload.kind === "directive")).toBe(true);
      const receipt = publishMemoryTransition(f.db, f.prove());
      const installed = discoverTransitionLocal(f.db, receipt.newEpochId).state.derived;
      // Keep the fixture's actual differing orders as the regression trigger.
      expect(installed).not.toEqual(f.candidate.state.derived);
      expect(installed.map(transitionLocalHash).sort()).toEqual(f.candidate.state.derived.map(transitionLocalHash).sort());
      expect(readVerifiedTransitionPublication(f.db, receipt.receiptId).candidateId).toBe(f.candidate.candidateId);
    } finally { await f.close(); }
  });

  it("still rolls back any changed installed derived payload", async () => {
    const f = await createTransitionPublicationFixture({ derived: true });
    try {
      const input = f.prove();
      const marker = f.db.prepare("SELECT * FROM memory_authority_selection").get();
      f.db.exec(`CREATE TRIGGER corrupt_installed_derived AFTER INSERT ON canonical_memory_derived BEGIN
        UPDATE canonical_memory_derived SET payload_json=json_set(payload_json,'$.content','owned corruption')
        WHERE authority_epoch_id=NEW.authority_epoch_id AND bank_id=NEW.bank_id AND object_id=NEW.object_id; END`);
      expect(() => publishMemoryTransition(f.db, input)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(f.db.prepare("SELECT * FROM memory_authority_selection").get()).toEqual(marker);
      expect(f.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(0);
      expect(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_derived WHERE authority_epoch_id=:epoch")
        .get({ epoch: f.candidate.targetEpochId })?.n).toBe(0);
    } finally { await f.close(); }
  });
});
