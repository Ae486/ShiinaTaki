import { describe, expect, it } from "vitest";
import { createTransitionPublicationFixture } from "../../testing/memory-transition-publication-fixtures.ts";
import { withTransitionEvidenceContext } from "./transition-evidence-context.ts";
import { projectTransitionLocalBank } from "./transition-local-projection.ts";
import { readTransitionLocalAncestors } from "../../db/memory-transition-candidate-repo.ts";

describe("synchronous projection artifacts", () => {
  it("freezes outputs, keys every semantic input and discards artifacts after each full boundary", async () => {
    const f = await createTransitionPublicationFixture();
    try {
      const run = () => withTransitionEvidenceContext(f.db, (verification) => {
        const evidence = verification.read(f.db, f.proofs[0]!.evidenceId);
        const project = (future: number) => projectTransitionLocalBank({ evidence, scope: f.candidate.scopes[0]!,
          epochId: f.candidate.targetEpochId, createdAt: f.candidate.createdAt,
          localEpochIds: readTransitionLocalAncestors(f.db, f.candidate.predecessorEpochId),
          ...{ futureSemanticField: future }, verification });
        const first = project(1); expect(project(1)).toBe(first);
        expect(() => first.records.pop()).toThrow(); expect(() => { first.bank.name = "corrupted"; }).toThrow();
        const changed = project(2); expect(changed).not.toBe(first); expect(changed).toEqual(first);
        // The same boundary retains only the current variant for this Bank.
        const restored = project(1); expect(restored).not.toBe(first); expect(restored).toEqual(first);
        return restored;
      });
      const first = run(); const next = run();
      expect(next).toEqual(first); expect(next).not.toBe(first);
    } finally { await f.close(); }
  });
});
