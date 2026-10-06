import { describe, expect, it } from "vitest";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTransitionReentryFixture } from "../../testing/memory-transition-reentry-fixtures.ts";
import { readVerifiedTransitionCandidate } from "./transition-final-mapping.ts";
import { captureTransitionLocal } from "../../db/memory-transition-local-capture.ts";
import { prepareTransitionDelta } from "../../db/memory-transition-delta-repo.ts";
import { projectTransitionPendingSources } from "./transition-pending-sources.ts";

describe("W3 awaiting Source disposition evidence", () => {
  it("retains exact unconfirmed bytes and operation identity without creating a confirmed document or memory", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const fixture = createTransitionReentryFixture(db, { awaitingSource: true });
      const candidate = readVerifiedTransitionCandidate(db, fixture.candidate.candidateId);
      expect(candidate.pendingSources).toHaveLength(1);
      const pending = candidate.pendingSources[0]!;
      expect(pending.source.operation_id).toBe(pending.operationId);
      expect(pending.source.original_source.documentId).toBe(pending.documentId);
      expect(pending.source.original_witness).toBeNull();
      expect(Buffer.from(pending.base64, "base64").byteLength).toBe(pending.bodyRef.total_bytes);
      expect(candidate.state.sources.some((row) => row.documentId === pending.documentId)).toBe(false);
      expect(candidate.mappings.some((row) => row.native.object_id === pending.documentId)).toBe(false);
      const capture = captureTransitionLocal(db, fixture.input);
      const prepared = prepareTransitionDelta(db, { ...fixture.input, captureId: capture.captureId, localBankId: "global",
        ...fixture.targets.find((row) => row.target.bank_id === "native-global")! });
      const descriptor = prepared.request.application.find((row) => row.key.artifact_id === pending.artifact.key.artifact_id)!;
      expect(descriptor.disposition).toBe("reuse"); expect(descriptor.native_source_id).toBeNull();
      expect(descriptor.expected_artifact).toEqual(pending.artifact);
      const evidence = fixture.proofs.find((row) => row.evidenceId === pending.evidenceId)!;
      const scope = candidate.scopes.find((row) => row.evidenceId === pending.evidenceId)!;
      expect(() => projectTransitionPendingSources({ ...evidence, bodies: evidence.bodies.filter((row) => row.ref.body_id !== pending.bodyRef.body_id) }, scope)).toThrow();
      expect(() => projectTransitionPendingSources(evidence, { ...scope, nativeBankId: "foreign" })).toThrow();
    } finally { db.close(); }
  });
});
