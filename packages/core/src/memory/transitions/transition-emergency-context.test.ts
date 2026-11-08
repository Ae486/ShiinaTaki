import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmergencyCandidateFixture } from "../../testing/memory-transition-emergency-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { openDatabase } from "../../db/sqlite.ts";
import { publishMemoryTransition } from "../../db/memory-transition-publication-repo.ts";
import { prepareEmergencyCandidate, readVerifiedEmergencyCandidate } from "../../db/memory-transition-emergency-candidate.ts";
import { readVerifiedEmergencyPublication } from "../../db/memory-transition-emergency-publication.ts";
import { readTransitionPublishedNativeBaseline, readTransitionLocalAncestors } from "../../db/memory-transition-candidate-repo.ts";
import { readSurvivingBaselinePolicies } from "../../db/memory-transition-surviving-policy.ts";
import { withTransitionEvidenceContext, type TransitionEvidenceContext } from "./transition-evidence-context.ts";
import { projectSurvivingLocalBank } from "./transition-local-projection.ts";
import * as surviving from "./transition-surviving-evidence.ts";
import * as native from "./transition-native-evidence.ts";
import * as projection from "../hindsight/hindsight-application-projection.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("independent synchronous emergency evidence", () => {
  it.each(["candidate", "proof", "publication"] as const)("deduplicates expensive immutable work within %s without a verdict cache", async (stage) => {
    const f = await createEmergencyCandidateFixture();
    try {
      const work = stage === "publication" ? f.prove() : f.work;
      const verifySurviving = surviving.verifySurvivingBankEvidence; const verifyNative = native.verifyTransitionNativeEvidence;
      const advance = () => { f.clock.value = new Date(Date.parse(f.clock.value) + 45_000).toISOString(); };
      const sv = vi.spyOn(surviving, "verifySurvivingBankEvidence").mockImplementation((raw) => { const value = verifySurviving(raw); advance(); return value; });
      const nv = vi.spyOn(native, "verifyTransitionNativeEvidence").mockImplementation((raw) => { const value = verifyNative(raw); advance(); return value; });
      const project = vi.spyOn(projection, "projectHindsightApplicationRecord");
      if (stage === "candidate") expect(prepareEmergencyCandidate(f.db, { ...work, evidence: f.evidence })).toEqual(f.candidate);
      if (stage === "proof") f.prove();
      if (stage === "publication") {
        const receipt = publishMemoryTransition(f.db, { ...work, candidateId: f.candidate.candidateId });
        expect(receipt.newEpochId).toBe(f.candidate.targetEpochId);
      }
      expect(sv.mock.calls.map(([value]) => value.evidenceId).sort()).toEqual(f.evidence.map((value) => value.evidenceId).sort());
      const nativeIds = nv.mock.calls.map(([value]) => value.evidenceId);
      expect(nativeIds.length).toBe(2); expect(new Set(nativeIds).size).toBe(nativeIds.length);
      expect(project).toHaveBeenCalledTimes(f.evidence.reduce((n, e) => n + e.heads.filter((head) => head.version).length, 0));
      expect(Date.parse(f.clock.value) - Date.parse(W3_AT)).toBe(180_000);
      // Another independent reader must verify all immutable evidence again, even immediately after success.
      sv.mockClear(); nv.mockClear(); project.mockClear();
      readVerifiedEmergencyCandidate(f.db, f.candidate.candidateId);
      expect(sv).toHaveBeenCalledTimes(2); expect(nv).toHaveBeenCalledTimes(2); expect(project).toHaveBeenCalled();
    } finally { await f.close(); }
  }, 30_000);

  // Each case constructs the same complete SQLite fixture as the 30-second cases above. Its full closure
  // work exceeds Vitest's default five-second budget under the Core suite's two-worker load.
  it("rejects forged objects, cross-database and expired contexts and isolates body bytes and Maps", async () => {
    const f = await createEmergencyCandidateFixture(); const other = openDatabase({ path: ":memory:", migrations: [] });
    let saved: TransitionEvidenceContext | undefined;
    try {
      withTransitionEvidenceContext(f.db, (context) => {
        saved = context; const evidence = context.readSurviving(f.db, f.evidence[0]!.evidenceId);
        expect(() => context.surviving(structuredClone(evidence))).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        expect(() => context.readSurviving(other, evidence.evidenceId)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        expect(() => evidence.heads.pop()).toThrow();
        const view = context.surviving(evidence); const body = view.reader.body(evidence.bodies[0]!.ref);
        const bytes = Uint8Array.from(body.bytes); const size = view.artifacts.size;
        body.bytes.fill(0); view.artifacts.clear();
        expect(context.surviving(evidence).reader.body(body.ref).bytes).toEqual(bytes);
        expect(context.surviving(evidence).artifacts.size).toBe(size);
      });
      expect(() => saved!.readSurviving(f.db, f.evidence[0]!.evidenceId)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(() => withTransitionEvidenceContext(f.db, (context) => { saved = context; return Promise.resolve(); })).toThrow();
      expect(() => saved!.readSurviving(f.db, f.evidence[0]!.evidenceId)).toThrow();
    } finally { other.close(); await f.close(); }
  }, 30_000);

  it("rereads surviving SQL bytes and identity even when a pure projection already exists", async () => {
    const f = await createEmergencyCandidateFixture();
    try {
      for (const fault of ["body", "slot", "transition_id", "delete"] as const) {
        expect(() => f.db.transaction(() => {
          withTransitionEvidenceContext(f.db, (context) => {
            const id = f.evidence[0]!.evidenceId;
            readVerifiedEmergencyCandidate(f.db, f.candidate.candidateId, context);
            f.db.exec("DROP TRIGGER memory_transition_surviving_evidence_no_update");
            f.db.exec("DROP TRIGGER memory_transition_surviving_evidence_no_delete");
            if (fault === "delete") f.db.prepare("DELETE FROM memory_transition_surviving_evidence WHERE id=:id").run({ id });
            else if (fault === "body") f.db.prepare("UPDATE memory_transition_surviving_evidence SET body=x'7b7d' WHERE id=:id").run({ id });
            else {
              const value = fault === "transition_id" ? f.db.prepare("SELECT transition_id FROM memory_transition_intents WHERE transition_id<>:id LIMIT 1").get({ id: f.intent.transitionId })!.transition_id : "changed";
              f.db.prepare(`UPDATE memory_transition_surviving_evidence SET ${fault}=:value WHERE id=:id`).run({ id, value: String(value) });
            }
            expect(() => readVerifiedEmergencyCandidate(f.db, f.candidate.candidateId, context)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
          });
          throw new Error("rollback synthetic corruption");
        })).toThrow("rollback synthetic corruption");
      }
    } finally { await f.close(); }
  }, 30_000);

  it("keys pure projection by full mappings and explicit policy Map entries rather than {}", async () => {
    const f = await createEmergencyCandidateFixture();
    try {
      withTransitionEvidenceContext(f.db, (verification) => {
        const scope = f.candidate.scopes[0]!; const evidence = verification.readSurviving(f.db, scope.evidenceId);
        const nativeBaseline = readTransitionPublishedNativeBaseline(f.db, { epochId: f.candidate.predecessorEpochId, nativeBankId: scope.nativeBankId, verification });
        const policies = readSurvivingBaselinePolicies(f.db, { evidence, predecessorEpochId: f.candidate.predecessorEpochId, baseline: nativeBaseline, verification });
        const input = { evidence, scope, epochId: f.candidate.targetEpochId, createdAt: f.candidate.createdAt, nativeBaseline,
          previous: nativeBaseline!.mappings, survivingPolicies: policies, localEpochIds: readTransitionLocalAncestors(f.db, f.candidate.predecessorEpochId), verification };
        const spy = vi.spyOn(projection, "projectHindsightApplicationRecord");
        const first = projectSurvivingLocalBank(input); const count = spy.mock.calls.length;
        expect(projectSurvivingLocalBank(input)).toBe(first); expect(spy).toHaveBeenCalledTimes(count);
        const record = f.candidate.state.records[0]!;
        const history = { table: "transition_initial_policy", rowJson: JSON.stringify({ proofHash: "synthetic-source" }) };
        const changed = new Map(policies).set("synthetic-policy-source", { record, history });
        projectSurvivingLocalBank({ ...input, survivingPolicies: changed }); expect(spy).toHaveBeenCalledTimes(count * 2);
        changed.set("synthetic-policy-source", { record, history: { ...history, rowJson: "changed-source" } });
        projectSurvivingLocalBank({ ...input, survivingPolicies: changed }); expect(spy).toHaveBeenCalledTimes(count * 3);
        changed.set("synthetic-policy-source", { record: { ...record, policy: { ...record.policy, policyVersion: record.policy.policyVersion + 1 } }, history });
        projectSurvivingLocalBank({ ...input, survivingPolicies: changed }); expect(spy).toHaveBeenCalledTimes(count * 4);
        const previous = structuredClone(input.previous); previous[0]!.semanticHash = "0".repeat(64);
        projectSurvivingLocalBank({ ...input, survivingPolicies: changed, previous }); expect(spy).toHaveBeenCalledTimes(count * 5);
      });
    } finally { await f.close(); }
  }, 30_000);

  it("opens a fresh emergency context for each full read and still checks mutable publication joins", async () => {
    const f = await createEmergencyCandidateFixture();
    try {
      const receipt = publishMemoryTransition(f.db, f.prove());
      const verify = vi.spyOn(surviving, "verifySurvivingBankEvidence");
      expect(readVerifiedEmergencyPublication(f.db, receipt.receiptId).candidateId).toBe(f.candidate.candidateId);
      expect(verify).toHaveBeenCalledTimes(2);
      expect(readVerifiedEmergencyPublication(f.db, receipt.receiptId).candidateId).toBe(f.candidate.candidateId);
      expect(verify).toHaveBeenCalledTimes(4);
      withTransitionEvidenceContext(f.db, (context) => {
        readVerifiedEmergencyPublication(f.db, receipt.receiptId, context);
        f.db.prepare("UPDATE memory_authority_selection SET provider_lineage_id='changed'").run();
        expect(() => readVerifiedEmergencyPublication(f.db, receipt.receiptId, context)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      });
    } finally { await f.close(); }
  }, 30_000);
});
