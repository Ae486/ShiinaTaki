import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../testing/memory-transition-healthy-fixtures.ts";
import { composeEmergencyFixture } from "../testing/memory-transition-emergency-service-fixtures.ts";
import { applicationTestNative, applicationTestMemoryPayload } from "../testing/hindsight-application-fixtures.ts";
import { W3_AT } from "../testing/memory-transition-candidate-fixtures.ts";
import * as delta from "../testing/memory-transition-delta-native-fixtures.ts";
import { readTransitionPublishedNativeBaseline, readTransitionCandidate } from "./memory-transition-candidate-repo.ts";
import { readTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import { readVerifiedTransitionPublication } from "./memory-transition-publication-reader.ts";
import { readVerifiedEmergencyCandidate } from "./memory-transition-emergency-candidate.ts";
import { readTransitionDocument } from "./memory-transition-document-repo.ts";
import { MemorySurvivingBankEvidenceSchema } from "@taki/shared";
import { readSurvivingBaselinePolicies } from "./memory-transition-surviving-policy.ts";
import * as nativeVerification from "../memory/transitions/transition-native-evidence.ts";
import * as survivingVerification from "../memory/transitions/transition-surviving-evidence.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("reuses only the original committed policy for an exact unchanged missing-policy unit, preserving Canonical references", async () => {
  const h = await createHealthyTransitionHarness({ aliases: true });
  let emergency: ReturnType<typeof composeEmergencyFixture> | undefined;
  try {
    const returned = h.owner.submit(await h.request()); await h.owner.stop();
    expect(h.owner.status(returned.operationId).state).toBe("completed");
    const apply = delta.applyFixtureNativeDelta;
    vi.spyOn(delta, "applyFixtureNativeDelta").mockImplementation((prepared, scope, native) => {
      const result = apply(prepared, scope, native);
      if (prepared.scope.scope.kind === "global") {
        const document = native.find((value) => value.head.object_kind === "document" && value.head.version)!;
        const memory = native.find((value) => value.head.object_kind === "memory_unit" && value.head.version)!;
        native.push(applicationTestNative({ scope, kind: "memory_unit", revision: 7, cursor: result.cursor + 1,
          payload: applicationTestMemoryPayload({ bank_id: scope.bankId, memory_id: "owned-native-observation", revision: 7,
            document_id: document.head.object_id, source_memory_ids: [memory.head.object_id],
            created_at: "2026-09-30T18:00:00.000Z", updated_at: "2026-09-30T19:00:00.000Z" }) }));
      }
      return result;
    });
    const reentered = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight")); await h.owner.stop();
    expect(h.owner.status(reentered.operationId), JSON.stringify(h.records)).toMatchObject({ state: "completed" }); vi.restoreAllMocks();
    const reentryId = reentered.producer!.kind === "transition" ? reentered.producer!.transitionId : "";
    const receipt = readTransitionReceipt(h.db, reentryId)!;
    const publication = readVerifiedTransitionPublication(h.db, receipt.receiptId);
    const previous = readTransitionCandidate(h.db, publication.candidateId);
    const mapping = previous.mappings.find((row) => row.native.object_id === "owned-native-observation")!;
    const original = previous.state.records.find((row) => row.unit.memoryId === mapping.localId)!;
    expect(original.unit.memoryId).not.toBe(mapping.native.object_id);
    expect(original.unit.documentId).not.toBeNull(); expect(original.unit.sourceMemoryIds).toHaveLength(1);
    const before = { ...h.remote.calls };
    emergency = composeEmergencyFixture(h);
    const publish = h.runtime.transitions.publish;
    vi.spyOn(h.runtime.transitions, "publish").mockImplementationOnce((work) => {
      const native = vi.spyOn(nativeVerification, "verifyTransitionNativeEvidence");
      const surviving = vi.spyOn(survivingVerification, "verifySurvivingBankEvidence");
      try {
        const receipt = publish(work);
        const ids = native.mock.calls.map(([evidence]) => evidence.evidenceId);
        // The missing-policy branch rereads the complete healthy predecessor. Even its source/baseline evidence
        // must be verified once per actual COMMIT, while all publication and policy correspondence joins rerun.
        expect(ids.length).toBeGreaterThan(2); expect(new Set(ids).size).toBe(ids.length);
        expect(surviving).toHaveBeenCalledTimes(2);
        return receipt;
      } finally { native.mockRestore(); surviving.mockRestore(); }
    });
    const operation = emergency.emergencyOwner.submit(await emergency.emergencyRequest()); await emergency.emergencyOwner.stop();
    expect(emergency.emergencyOwner.status(operation.operationId).state).toBe("completed");
    const id = operation.producer!.kind === "transition" ? operation.producer!.transitionId : "";
    const completed = readTransitionReceipt(h.db, id)!;
    const current = readVerifiedEmergencyCandidate(h.db, readVerifiedTransitionPublication(h.db, completed.receiptId).candidateId);
    expect(current.state.records.find((row) => row.unit.memoryId === mapping.localId)).toEqual({ ...original,
      unit: { ...original.unit, authorityEpochId: completed.newEpochId }, policy: { ...original.policy, authorityEpochId: completed.newEpochId } });
    expect(current.state.history.filter((row) => row.table === "transition_initial_policy")).toEqual(
      previous.state.history.filter((row) => row.table === "transition_initial_policy"));
    expect(h.remote.calls).toEqual(before);
    const scope = current.scopes.find((row) => row.localBankId === mapping.localBankId)!;
    const evidence = readTransitionDocument(h.db, "surviving_evidence", { id: scope.evidenceId, schema: MemorySurvivingBankEvidenceSchema })!;
    const baseline = readTransitionPublishedNativeBaseline(h.db, { epochId: receipt.newEpochId, nativeBankId: scope.nativeBankId });
    for (const mismatch of ["generation", "lineage", "head", "body-ref", "native", "missing-baseline"] as const) {
      const altered = structuredClone(evidence);
      if (mismatch === "generation") altered.namespace.bank_generation = "00000000-0000-4000-8000-000000000001";
      if (mismatch === "lineage") altered.namespace.provider_lineage = "00000000-0000-4000-8000-000000000002";
      if (mismatch === "head") altered.heads.find((row) => row.object_id === "owned-native-observation")!.version!.object_revision++;
      if (mismatch === "body-ref") altered.heads.find((row) => row.object_id === "owned-native-observation")!.body_ref!.bytes_sha256 = "0".repeat(64);
      if (mismatch === "native") {
        const native = altered.nativeRecords.find((row) => row.object_id === "owned-native-observation")!;
        native.payload = { ...native.payload, text: "changed surviving content" };
      }
      expect(() => readSurvivingBaselinePolicies(h.db, { evidence: altered, predecessorEpochId: receipt.newEpochId,
        baseline: mismatch === "missing-baseline" ? undefined : baseline })).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    }
    for (const missing of ["record", "policy-history", "policy"] as const) {
      const altered = structuredClone(previous);
      if (missing === "record") altered.state.records = altered.state.records.filter((row) => row.unit.memoryId !== mapping.localId);
      if (missing === "policy-history") altered.state.history = altered.state.history.filter((row) => row.table !== "transition_initial_policy");
      if (missing === "policy") altered.state.records.find((row) => row.unit.memoryId === mapping.localId)!.policy.policyVersion++;
      // Corrupt only this synthetic durable document inside a transaction which always rolls back. Reusing the
      // previously read baseline must not bypass a fresh verification of its actual committed publication.
      expect(() => h.db.transaction(() => {
        const triggers = h.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='memory_transition_candidates'").all();
        for (const row of triggers) h.db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`);
        h.db.prepare("UPDATE memory_transition_candidates SET body=:body WHERE id=:id")
          .run({ body: Buffer.from(JSON.stringify(altered)), id: previous.candidateId });
        expect(() => readSurvivingBaselinePolicies(h.db, { evidence, predecessorEpochId: receipt.newEpochId, baseline }))
          .toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        throw new Error("rollback synthetic corruption");
      })).toThrow("rollback synthetic corruption");
      expect(readTransitionCandidate(h.db, previous.candidateId)).toEqual(previous);
    }
  } finally { await emergency?.stopEmergency(); await h.close(); }
}, 60_000);
