import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HindsightTransitionDeltaResultSchema } from "@taki/shared";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTransitionReentryFixture } from "../../testing/memory-transition-reentry-fixtures.ts";
import { applicationTestNative, applicationTestMemoryPayload, type ApplicationNativeFixture } from "../../testing/hindsight-application-fixtures.ts";
import { evidenceFromBundle } from "../../testing/memory-transition-candidate-fixtures.ts";
import { captureTransitionLocal } from "../../db/memory-transition-local-capture.ts";
import { prepareTransitionDelta, recordTransitionDeltaResult } from "../../db/memory-transition-delta-repo.ts";
import { hindsightTransitionHash } from "../hindsight/hindsight-transition-proof.ts";
import { transitionProjectionContext } from "./transition-local-projection.ts";
import { sealTransitionNativeEvidence } from "./transition-native-evidence.ts";
import { validateTransitionFinalMapping, buildTransitionHindsightCandidate, readVerifiedTransitionCandidate } from "./transition-final-mapping.ts";
import { persistTransitionNativeEvidence } from "../../db/memory-transition-candidate-repo.ts";
import { transitionFinalFixture } from "../../testing/memory-transition-final-fixtures.ts";

describe("W3 final maintenance mapping join", () => {
  it("joins every prepared Bank and final result into a complete independently reconstructable candidate", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const fixture = createTransitionReentryFixture(db); const capture = captureTransitionLocal(db, fixture.input);
      const preparationIds: string[] = []; const evidenceIds: string[] = [];
      for (const target of fixture.targets) {
        const scope = fixture.candidate.scopes.find((row) => row.nativeBankId === target.target.bank_id)!;
        const prepared = prepareTransitionDelta(db, { ...fixture.input, captureId: capture.captureId, localBankId: scope.localBankId, ...target });
        const produced = transitionFinalFixture(prepared, fixture.proofs.find((row) => row.status.bank_id === scope.nativeBankId)!);
        recordTransitionDeltaResult(db, { ...fixture.input, preparationId: prepared.preparationId, result: produced.result });
        persistTransitionNativeEvidence(db, { ...fixture.input, evidence: produced.evidence });
        preparationIds.push(prepared.preparationId); evidenceIds.push(produced.evidence.evidenceId);
      }
      expect(() => buildTransitionHindsightCandidate(db, { ...fixture.input, preparationIds: preparationIds.slice(1), evidenceIds })).toThrow();
      const candidate = buildTransitionHindsightCandidate(db, { ...fixture.input, preparationIds, evidenceIds });
      expect(candidate.state.banks).toHaveLength(3); expect(candidate.state.records).toHaveLength(3);
      expect(readVerifiedTransitionCandidate(db, candidate.candidateId)).toEqual(candidate);
      expect(db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state").get()?.active_epoch_id).toBe(fixture.candidate.targetEpochId);
    } finally { db.close(); }
  });
  it("requires the final proof's exact delta result and retains later derived objects outside the immediate mapping", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const f = createTransitionReentryFixture(db); const capture = captureTransitionLocal(db, f.input);
      const target = f.targets.find((row) => row.target.bank_id === "native-b-bank")!;
      const prepared = prepareTransitionDelta(db, { ...f.input, captureId: capture.captureId, localBankId: "b-bank", ...target });
      const resultBody = { protocol: "taki-transition-v1", operation_id: prepared.request.operation_id, transition_id: f.intent.transitionId,
        bank_id: prepared.scope.nativeBankId, provider_lineage: prepared.target.request.provider_lineage, bank_generation: prepared.scope.nativeGeneration,
        request_hash: prepared.request.request_hash, baseline_proof_hash: prepared.request.baseline_proof_hash, unused_scope_hash: null,
        local_manifest_hash: capture.contentHash, native_before_cursor: 1, native_through_cursor: 1, application_through_cursor: 0,
        mappings: prepared.request.native.map((row) => ({ source: row.source, target: row.target, disposition: "reused" })),
        artifacts: prepared.request.application.map((row) => ({ key: row.key, previous: row.expected_artifact,
          previous_body_hash: row.expected_body_hash, current: row.expected_artifact, source_record_hash: row.source_record_hash, disposition: "reused" })) };
      const result = HindsightTransitionDeltaResultSchema.parse({ ...resultBody, result_hash: hindsightTransitionHash(resultBody) });
      recordTransitionDeltaResult(db, { ...f.input, preparationId: prepared.preparationId, result });
      const old = f.proofs.find((row) => row.status.bank_id === "native-b-bank")!; const context = transitionProjectionContext(old);
      const scope = { bankId: prepared.scope.nativeBankId, namespace: old.status.proof!.application_snapshot.namespace };
      const native: ApplicationNativeFixture[] = context.heads.map((head) => ({ head, body: context.reader.body(head.body_ref!), bodies: [context.reader.body(head.body_ref!)] }));
      native.push(applicationTestNative({ scope, kind: "memory_unit", cursor: 2, payload: applicationTestMemoryPayload({ bank_id: scope.bankId,
        memory_id: randomUUID(), document_id: null, fact_type: "observation" }) }));
      const final = evidenceFromBundle({ transitionId: f.intent.transitionId, scope, native,
        artifacts: [...context.artifacts.values()].map((artifact) => ({ artifact, body: context.reader.body(artifact.body_ref) })) });
      final.status.request = target.target.request; final.status.executor = target.target.executor;
      const proof = final.status.proof!; proof.executor = target.target.executor; proof.request_hash = target.target.request.request_hash;
      proof.delta_result_hash = result.result_hash;
      proof.proof_hash = hindsightTransitionHash({ domain: "transition-proof.v1", proof: Object.fromEntries(Object.entries(proof).filter(([key]) => key !== "proof_hash")) });
      for (const page of final.maintenancePages) page.certificate_hash = proof.proof_hash;
      for (const page of final.auxiliaryPages) page.proof_hash = proof.proof_hash;
      const evidence = sealTransitionNativeEvidence(final);
      const mapping = validateTransitionFinalMapping(db, prepared, evidence);
      expect(mapping).toHaveLength(1); expect(evidence.nativePages.flatMap((page) => page.records)).toHaveLength(2);
      expect(() => validateTransitionFinalMapping(db, prepared, { ...evidence, status: { ...evidence.status,
        proof: { ...proof, delta_result_hash: "f".repeat(64) } } })).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    } finally { db.close(); }
  });
});
