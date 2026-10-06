import { describe, expect, it } from "vitest";
import { createTransitionPublicationFixture } from "../../testing/memory-transition-publication-fixtures.ts";
import { readTransitionLocalAncestors } from "../../db/memory-transition-candidate-repo.ts";
import { withTransitionEvidenceContext } from "./transition-evidence-context.ts";
import { projectTransitionLocalBank } from "./transition-local-projection.ts";

describe("independent boundary pure projection reuse", () => {
  it("reuses complete semantic identity, freezes output and discards entries at boundary exit", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const run = () => withTransitionEvidenceContext(f.db, (verification) => {
        const input = { evidence: verification.read(f.db, f.proofs[0]!.evidenceId), scope: f.candidate.scopes[0]!,
          epochId: f.candidate.targetEpochId, createdAt: f.candidate.createdAt,
          localEpochIds: readTransitionLocalAncestors(f.db, f.candidate.predecessorEpochId), verification };
        const first = projectTransitionLocalBank(input);
        expect(projectTransitionLocalBank(input)).toBe(first);
        expect(() => first.records.pop()).toThrow();
        const changed = projectTransitionLocalBank({ ...input, ...{ futureSemanticField: 1 } });
        expect(changed).not.toBe(first); expect(changed).toEqual(first);
        const restored = projectTransitionLocalBank(input);
        expect(restored).not.toBe(first); // One current variant per Bank.
        expect(() => projectTransitionLocalBank({ ...input, evidence: structuredClone(input.evidence) })).toThrow();
        f.db.exec("DROP TRIGGER IF EXISTS memory_transition_native_evidence_immutable_update");
        f.db.prepare("UPDATE memory_transition_native_evidence SET slot='corrupt-slot' WHERE id=:id").run({ id: input.evidence.evidenceId });
        expect(() => projectTransitionLocalBank(input)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        return first;
      });
      let first: ReturnType<typeof run> | undefined;
      expect(() => f.db.transaction(() => { first = run(); throw new Error("fixture rollback"); })).toThrow("fixture rollback");
      expect(first).toBeDefined();
      const values = [0, 1].map(() => withTransitionEvidenceContext(f.db, (verification) =>
        projectTransitionLocalBank({ evidence: verification.read(f.db, f.proofs[0]!.evidenceId),
          scope: f.candidate.scopes[0]!, epochId: f.candidate.targetEpochId, createdAt: f.candidate.createdAt,
          localEpochIds: readTransitionLocalAncestors(f.db, f.candidate.predecessorEpochId), verification })));
      expect(values[0]).toEqual(values[1]); expect(values[0]).not.toBe(values[1]);
    } finally { await f.close(); }
  });
});
