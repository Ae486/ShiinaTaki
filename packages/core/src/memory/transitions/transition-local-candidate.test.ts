import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTransitionCandidateFixture, W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { persistTransitionNativeEvidence, readTransitionCandidate } from "../../db/memory-transition-candidate-repo.ts";
import { buildTransitionLocalCandidate } from "./transition-local-candidate.ts";
import { readVerifiedTransitionCandidate } from "./transition-final-mapping.ts";
import { installTransitionLocalCandidate } from "../../db/memory-transition-local-staging.ts";
import { createCanonicalMemoryRepo } from "../../db/canonical-memory-repo.ts";
import { sealTransitionNativeEvidence } from "./transition-native-evidence.ts";
import { captureTransitionLocal, discoverTransitionLocal } from "../../db/memory-transition-local-capture.ts";
import { readHindsightLocalCoverageState } from "../../db/hindsight-local-coverage-reader.ts";
import { compileTransitionNativeDelta } from "./transition-delta-rows.ts";
import { transitionDocumentHash } from "../../db/memory-transition-document-repo.ts";
import { MemoryTransitionLocalCaptureSchema } from "@taki/shared";

function setup(path = ":memory:") {
  const db = openDatabase({ path, migrations: MIGRATIONS }); const fixture = createTransitionCandidateFixture(db);
  for (const evidence of fixture.proofs) persistTransitionNativeEvidence(db, { ...fixture.input, evidence });
  const build = () => buildTransitionLocalCandidate(db, { ...fixture.input, evidenceIds: fixture.proofs.map((entry) => entry.evidenceId) });
  return { db, fixture, build };
}
function installForTest(input: ReturnType<typeof setup>, id: string) {
  const candidate = readTransitionCandidate(input.db, id);
  // A fixture-only W4 transaction: this proves the row installer and normal Local restore, not full custody/queue COMMIT.
  input.db.transaction(() => {
    input.db.prepare("INSERT INTO canonical_memory_authority_epochs VALUES(:id,'local',:lineage,'closed',:prior,:at,:at,'planned-switch')")
      .run({ id: candidate.targetEpochId, prior: candidate.predecessorEpochId,
        lineage: input.fixture.intent.request.expected.targetLineageId, at: W3_AT });
    installTransitionLocalCandidate(input.db, id);
    input.db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at=:at WHERE epoch_id=:id")
      .run({ id: candidate.predecessorEpochId, at: W3_AT });
    input.db.prepare("UPDATE canonical_memory_authority_epochs SET status='active',ended_at=NULL WHERE epoch_id=:id")
      .run({ id: candidate.targetEpochId });
    input.db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id=:id WHERE singleton=1").run({ id: candidate.targetEpochId });
  });
  return candidate;
}
describe("W3 complete Local candidate", () => {
  it("preserves three Banks, typed originals, independent Local/native IDs and invalidated unbound records without selecting authority", () => {
    const test = setup();
    try {
      const before = test.db.prepare("SELECT * FROM canonical_memory_authority_state").all();
      const candidate = test.build();
      expect(candidate.state.banks.map((row) => row.bankId).sort()).toEqual(["a-bank", "b-bank", "global"]);
      expect(candidate.state.records).toHaveLength(3);
      const original = candidate.state.records.find((row) => row.unit.memoryId === "logical-unit")!;
      expect(original.unit.metadata).toEqual(test.fixture.seed.unit.metadata);
      expect(Object.hasOwn(original.unit.metadata, "__proto__")).toBe(true);
      expect(original.policy.visibility).toBe("hidden"); expect(original.policy.policyVersion).toBe(7);
      expect(original.provenance).toEqual(test.fixture.seed.record.provenance);
      const source = candidate.state.sources.find((row) => row.documentId === "document-logical-unit")!;
      expect(source).toMatchObject({ retainedText: "", context: null, contentHash: "original-declared-hash" });
      expect(candidate.mappings.find((row) => row.localId === "logical-unit")?.native.object_id).toBe("native-logical-unit");
      const derived = candidate.state.records.find((row) => row.unit.factType === "observation")!;
      expect(derived.unit.memoryId).not.toBe("native-derived"); expect(derived.unit.state).toBe("invalidated");
      expect(derived.unit.sourceMemoryIds).toEqual(["logical-unit"]); expect(derived.policy.layerId).toBe("unclassified");
      expect(test.db.prepare("SELECT * FROM canonical_memory_authority_state").all()).toEqual(before);
      expect(test.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(0);
      expect(test.build()).toEqual(candidate); expect(readVerifiedTransitionCandidate(test.db, candidate.candidateId)).toEqual(candidate);
    } finally { test.db.close(); }
  });
  it("persists candidate/scope identities over reopen and refuses immutable replacement", () => {
    const path = join(mkdtempSync(join(tmpdir(), "taki-w3-")), "candidate.sqlite");
    const test = setup(path); const candidate = test.build(); test.db.close();
    const reopened = openDatabase({ path, migrations: MIGRATIONS });
    try {
      expect(readVerifiedTransitionCandidate(reopened, candidate.candidateId)).toEqual(candidate);
      expect(() => reopened.exec("UPDATE memory_transition_candidates SET body=x'00'")).toThrow("immutable");
      expect(() => reopened.exec("DELETE FROM memory_transition_scope_ids")).toThrow("immutable");
      expect(() => reopened.prepare("INSERT OR REPLACE INTO memory_transition_candidates SELECT * FROM memory_transition_candidates").run()).toThrow("immutable");
    } finally { reopened.close(); }
  });
  it("installs real canonical rows with exact provenance, keeps first-activation guards, and restores a previously unbound invalidated unit", () => {
    const test = setup();
    try {
      const candidate = installForTest(test, test.build().candidateId);
      const derived = candidate.state.records.find((row) => row.unit.factType === "observation")!;
      const repo = createCanonicalMemoryRepo(test.db);
      expect(repo.record(candidate.targetEpochId, derived.unit.bankId, derived.unit.memoryId)).toEqual(derived);
      expect(() => readHindsightLocalCoverageState(test.db, candidate.targetEpochId)).toThrow("HINDSIGHT_PREDECESSOR_STALE");
      expect(discoverTransitionLocal(test.db, candidate.targetEpochId).state.records).toHaveLength(3);
      expect(test.db.prepare("SELECT count(*) AS n FROM canonical_memory_fts WHERE authority_epoch_id=:epoch").get({ epoch: candidate.targetEpochId })?.n).toBe(0);
      const restored = repo.restore({ epochId: candidate.targetEpochId, bankId: derived.unit.bankId, memoryId: derived.unit.memoryId,
        expectedRevision: derived.unit.revision, requestId: "restore-derived", requestHash: "b".repeat(64), now: W3_AT, searchTerms: "fixture" });
      expect(restored.record.unit.state).toBe("valid"); expect(restored.record.provenance).toEqual(derived.provenance);
      expect(restored.record.unit.memoryId).toBe(derived.unit.memoryId);
    } finally { test.db.close(); }
  });
  it("rolls back every installed row on a canonical policy insertion failure", () => {
    const test = setup();
    try {
      const candidate = test.build();
      test.db.exec("CREATE TRIGGER fail_w3_policy BEFORE INSERT ON canonical_memory_policy BEGIN SELECT RAISE(ABORT,'owned failure'); END");
      expect(() => installForTest(test, candidate.candidateId)).toThrow("owned failure");
      expect(test.db.prepare("SELECT count(*) AS n FROM canonical_memory_banks WHERE authority_epoch_id=:epoch").get({ epoch: candidate.targetEpochId })?.n).toBe(0);
      expect(test.db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state").get()?.active_epoch_id).toBe(candidate.predecessorEpochId);
      test.db.exec("DROP TRIGGER fail_w3_policy"); expect(() => installForTest(test, candidate.candidateId)).not.toThrow();
    } finally { test.db.close(); }
  });
  it.each(["native-page", "app-page", "body", "auxiliary", "maintenance", "foreign"])("refuses incomplete or foreign %s closure", (fault) => {
    const test = setup();
    try {
      const raw = structuredClone(test.fixture.proofs[0]!); delete (raw as Partial<typeof raw>).evidenceId;
      if (fault === "native-page") raw.nativePages.pop();
      if (fault === "app-page") raw.applicationPages.reverse();
      if (fault === "body") raw.bodies.pop();
      if (fault === "auxiliary") raw.auxiliaryPages.push(raw.auxiliaryPages[0]!);
      if (fault === "maintenance") raw.maintenancePages = [];
      if (fault === "foreign") raw.status.bank_id = "foreign";
      expect(() => sealTransitionNativeEvidence(raw)).toThrow();
    } finally { test.db.close(); }
  });
  it("refuses a missing admitted empty Bank and rolls back scope assignments", () => {
    const test = setup();
    try {
      expect(() => buildTransitionLocalCandidate(test.db, { ...test.fixture.input,
        evidenceIds: test.fixture.proofs.slice(0, 2).map((entry) => entry.evidenceId) })).toThrow();
      expect(test.db.prepare("SELECT count(*) AS n FROM memory_transition_scope_ids").get()?.n).toBe(0);
      expect(test.db.prepare("SELECT count(*) AS n FROM memory_transition_candidates").get()?.n).toBe(0);
    } finally { test.db.close(); }
  });
  it("compiles unchanged native reuse across epoch relocation and refuses omission without real retirement history", () => {
    const test = setup();
    try {
      const candidate = installForTest(test, test.build().candidateId);
      const current = discoverTransitionLocal(test.db, candidate.targetEpochId);
      const body = { version: 1 as const, transitionId: test.fixture.intent.transitionId, epochId: candidate.targetEpochId, capturedAt: W3_AT, ...current };
      const capture = MemoryTransitionLocalCaptureSchema.parse({ ...body, captureId: transitionDocumentHash("captures", body) });
      const input = { capture, baseline: candidate, localBankId: "global", nativeBankId: "native-global",
        mappings: candidate.mappings.filter((row) => row.localBankId === "global") };
      expect(compileTransitionNativeDelta(input).native.every((row) => row.disposition === "reuse")).toBe(true);
      capture.state.records = capture.state.records.filter((row) => row.unit.memoryId !== "logical-unit");
      expect(() => compileTransitionNativeDelta(input)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(() => captureTransitionLocal(test.db, test.fixture.input)).toThrow("MEMORY_TRANSITION_STALE");
    } finally { test.db.close(); }
  });
});
