import { describe, expect, it } from "vitest";
import { createTransitionCandidateFixture } from "../../testing/memory-transition-candidate-fixtures.ts";
import { applicationTestReplica } from "../../testing/hindsight-application-runtime-fixtures.ts";
import { transitionProjectionContext } from "../transitions/transition-local-projection.ts";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { hindsightApplicationEvidenceReader, hindsightApplicationBindingBody } from "./hindsight-application-binding-context.ts";
import { readHindsightApplicationSourceArtifact } from "./hindsight-application-source-evidence.ts";
import { readHindsightApplicationNative } from "./hindsight-application-projection.ts";

describe("Source-evidence ordinary paired replica consumers", () => {
  it("publishes complete nested closure, reads its original fragment and creates association-only rebind without changing bytes", () => {
    const fixtureDb = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const fixture = createTransitionCandidateFixture(fixtureDb, { aliases: true, aliasEvidence: true });
    const native = fixture.proofs.find((row) => row.status.bank_id === "native-global")!;
    const context = transitionProjectionContext(native);
    const scope = { bankId: native.status.bank_id, namespace: native.status.proof!.application_snapshot.namespace };
    const replica = applicationTestReplica({ scope });
    try {
      replica.publish(context.bundle);
      const sources = replica.repo.sourceArtifacts(scope);
      const alias = sources.find((row) => row.body_ref.body_schema === "application-source-evidence.v1")!;
      const evidence = hindsightApplicationEvidenceReader(replica.repo, scope);
      const source = readHindsightApplicationSourceArtifact({ ...scope, artifact: alias, evidence });
      expect(source.evidenceOnly).toBe(true); expect(source.source.original_source.retainedText).toBe("append fragment two");
      const body = evidence.body(alias.body_ref).content;
      if (body.body_schema !== "application-source-evidence.v1" || alias.binding.kind !== "exact_native") throw new Error("fixture source evidence");
      const head = replica.repo.nativeHead({ ...scope, objectKind: "document", objectId: alias.binding.native.object_id })!;
      const physical = readHindsightApplicationNative({ ...scope, head, evidence });
      const bank = replica.repo.bankBinding(scope.bankId)!.bank!;
      const rebound = hindsightApplicationBindingBody({ ...scope, authorityEpochId: "epoch", bankScope: { kind: "global", characterId: null },
        repo: replica.repo, bank, evidence, original: undefined }, { head, prior: alias, native: physical, at: "2026-10-01T00:00:00.000Z" });
      expect(rebound).toEqual({ schema: "application-source-evidence.v1", value: body.value });
      expect(replica.repo.record({ ...scope, memoryId: "native-logical-unit", includeHidden: true })?.policy.policyVersion).toBe(7);
      expect(() => readHindsightApplicationSourceArtifact({ ...scope, artifact: alias,
        evidence: { ...evidence, body: (ref) => { if (ref.body_id === body.value.source_ref.body_id) throw new Error("missing original bytes"); return evidence.body(ref); } } }))
        .toThrow("missing original bytes");
    } finally { replica.db.close(); fixtureDb.close(); }
  });
});
