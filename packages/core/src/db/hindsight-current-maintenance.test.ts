import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./sqlite.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { currentStateFixture, currentImportFixture, currentMaintenanceFixture, currentSnapshotFixture, CURRENT_REPLICA } from "./hindsight-current-fixtures.ts";
import { saveHindsightCurrentImport } from "./hindsight-current-import-repo.ts";
import { saveCurrentVerificationCandidate } from "./hindsight-current-candidate-repo.ts";
import { readHindsightCurrentVerification, saveHindsightCurrentVerification } from "./hindsight-current-verification-repo.ts";
import { createHindsightReplicaRepo } from "./hindsight-replica-repo.ts";
import { hindsightCheckpointSetDigest, promoteHindsightAuthority } from "./hindsight-authority-repo.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import { LOCAL_COVERAGE_NOW as now, LOCAL_COVERAGE_NEXT as next, retainNewLocalSource } from "./hindsight-local-coverage-fixtures.ts";
import { currentStateFieldsWithout, hindsightCurrentStateHash } from "../memory/hindsight/hindsight-current-state-hash.ts";
import { currentActionKey, currentInputManifestHash } from "../memory/hindsight/hindsight-current-maintenance-hash.ts";
import { verifyLogicalSnapshot } from "../memory/hindsight/hindsight-snapshot-validator.ts";
import { normalizeSnapshotMetadata, normalizeSnapshotPage } from "../memory/hindsight/hindsight-snapshot-contracts.ts";
import type { HindsightCutoverEvidenceRecord } from "@taki/shared";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() { const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db); return currentStateFixture(db); }
function proofFixture(f = fixture()) {
  const prepared = f.prepare(); const native = currentImportFixture(prepared, f.baselineRecords);
  const imported = saveHindsightCurrentImport(f.db, { preparationId: prepared.preparationId, ...native });
  const proof = currentMaintenanceFixture(imported, native);
  saveCurrentVerificationCandidate(f.db, { preparationId: prepared.preparationId, request: proof.request, status: proof.candidate });
  return { f, prepared, native, imported, proof };
}
function publish(value: ReturnType<typeof proofFixture>) {
  return saveHindsightCurrentVerification(value.f.db, { lease: value.f.lease, ...value.proof, replicaEpochId: CURRENT_REPLICA, now });
}
function reseal(proof: ReturnType<typeof currentMaintenanceFixture>) {
  const certificate = proof.status.certificate!; const records = proof.pages.flatMap((page) => page.records);
  for (const page of proof.pages) {
    page.page_hash = hindsightCurrentStateHash({ page_number: page.page_number, records: page.records });
    certificate.evidence.page_hashes[page.page_number] = page.page_hash;
  }
  certificate.evidence.records_hash = hindsightCurrentStateHash(records);
  certificate.certificate_hash = hindsightCurrentStateHash(currentStateFieldsWithout(certificate, ["certificate_hash"]));
  proof.pages.forEach((page) => { page.certificate_hash = certificate.certificate_hash; });
}

describe("D78 finite maintenance acceptance", () => {
  it("imports observations, independent source links, standalone units and nullable derived state structurally", () => {
    const f = fixture(); const other = retainNewLocalSource(f.db, f); const repo = createCanonicalMemoryRepo(f.db);
    repo.edit({ epochId: f.epochId, bankId: f.bankId, memoryId: other.record.unit.memoryId, expectedRevision: 1,
      requestId: "observation", requestHash: "a".repeat(64), now: next, searchTerms: "", patch: { factType: "observation" } });
    repo.addLineage({ epochId: f.epochId, bankId: f.bankId, memoryId: other.record.unit.memoryId, sourceMemoryId: f.record.unit.memoryId });
    f.db.prepare("UPDATE canonical_memory_units SET document_id=NULL WHERE memory_id=:id").run({ id: other.record.unit.memoryId });
    repo.saveDerived({ authorityEpochId: f.epochId, bankId: f.bankId, objectRevision: 3,
      payload: { kind: "mental_model", bankId: f.bankId, mentalModelId: "local-model", subtype: "pinned", name: "Local",
        sourceQuery: null, content: null, tags: [], maxTokens: null, trigger: null, lastRefreshedAt: null, createdAt: now,
        reflectResponse: { source: ["original-id"] }, structuredContent: null } });
    f.db.prepare(`INSERT INTO taki_memory_blocks (block_id,scope_kind,character_id,content,revision,updated_at)
      VALUES ('notes','global',NULL,'This is a Local Block.',1,:now)`).run({ now });
    f.runs.captureCoverage({ lease: f.lease, now: next }); const prepared = f.prepare();
    expect(prepared.request?.memory_units.find((unit) => unit.source.source_id === other.record.unit.memoryId))
      .toMatchObject({ fact_type: "observation", document_id: null, source_memory_ids: [f.record.unit.memoryId] });
    expect(prepared.request?.mental_models[0]).toMatchObject({ source_query: null, content: null, max_tokens: null,
      trigger: null, reflect_response: { source: ["original-id"] }, source: { source_revision: 3 } });
    expect(prepared.request?.documents.some((document) => document.original_text === "This is a Local Block.")).toBe(false);
  });

  it("accepts an explicit empty current Bank while retaining mandatory B3 controls and their model proof", () => {
    const f = fixture();
    f.db.exec(`DELETE FROM canonical_memory_unit_sources; DELETE FROM canonical_memory_policy;
      DELETE FROM canonical_memory_fts; DELETE FROM canonical_memory_revision_snapshots;
      DELETE FROM canonical_memory_units; DELETE FROM canonical_memory_sources;`);
    f.runs.captureCoverage({ lease: f.lease, now: next }); const value = proofFixture(f); const evidence = publish(value);
    expect(value.prepared.request).toMatchObject({ documents: [], memory_units: [], mental_models: [], directives: [] });
    expect(value.native.result).toMatchObject({ native_before_cursor: 10, native_through_cursor: 10, native_batch_id: null,
      manifest: { total_records: 1 } });
    expect(evidence.status.certificate).toMatchObject({ source_scope_count: 0, model_count: 1 });
    const checkpoint = createHindsightReplicaRepo(f.db).checkpoint(f.nativeBankId)!;
    f.runs.markReady({ lease: f.lease, configFingerprint: "a".repeat(64),
      checkpointSetDigest: hindsightCheckpointSetDigest([{ bankId: f.nativeBankId, templateDigest: f.templateDigest, checkpoint }]), now });
    expect(f.runs.verify({ runId: f.runId, expectedRevision: 0, expectedEpochId: f.epochId }).eligible).toBe(true);
  });

  it.each(["namespace", "missing-page", "input-group", "model-input", "snapshot-content"] as const)("rejects %s without partial evidence or replica", (caseName) => {
    const value = proofFixture(); const changed = structuredClone(value.proof);
    if (caseName === "namespace") changed.status.bank_generation = CURRENT_REPLICA;
    if (caseName === "missing-page") changed.pages = [];
    if (caseName === "input-group") {
      const record = changed.pages[0]!.records.find((item) => item.record_kind === "input")!;
      if (record.record_kind === "input") record.input_manifest_hash = "f".repeat(64); reseal(changed);
    }
    if (caseName === "model-input") {
      const record = changed.pages[0]!.records.find((item) => item.record_kind === "model")!;
      if (record.record_kind === "model") record.eligible_hash = "f".repeat(64); reseal(changed);
    }
    if (caseName === "snapshot-content") changed.snapshotPages[0]!.records[0]!.payload.name = "tampered";
    expect(() => saveHindsightCurrentVerification(value.f.db, { lease: value.f.lease, ...changed, replicaEpochId: CURRENT_REPLICA, now })).toThrow();
    expect(value.f.db.prepare("SELECT count(*) AS n FROM hindsight_current_verification_evidence").get()?.n).toBe(0);
    expect(createHindsightReplicaRepo(value.f.db).checkpoint(value.f.nativeBankId)).toBeUndefined();
    expect(value.f.db.prepare("SELECT mode FROM memory_authority_selection").get()?.mode).toBe("canonical-local");
  });

  it("binds verification to the original required set and preserves the first candidate on replay", () => {
    const value = proofFixture(); const first = saveCurrentVerificationCandidate(value.f.db, { preparationId: value.prepared.preparationId,
      request: value.proof.request, status: value.proof.candidate });
    expect(saveCurrentVerificationCandidate(value.f.db, { preparationId: value.prepared.preparationId,
      request: value.proof.request, status: value.proof.status })).toEqual(first);
    const changed = structuredClone(value.proof.status); changed.required_set_hash = "f".repeat(64);
    expect(() => saveCurrentVerificationCandidate(value.f.db, { preparationId: value.prepared.preparationId,
      request: value.proof.request, status: changed })).toThrow("HINDSIGHT_CURRENT_CANDIDATE_CONFLICT");
  });

  it("uses a sealed retained snapshot after its diagnostic TTL for read-back, readiness and promotion", () => {
    const value = proofFixture(); const { f, proof } = value; const certificate = proof.status.certificate!;
    certificate.snapshot.expires_at = "2026-08-22T00:00:30.000Z"; reseal(proof);
    expect(() => verifyLogicalSnapshot({ metadata: normalizeSnapshotMetadata(certificate.snapshot),
      pages: proof.snapshotPages.map(normalizeSnapshotPage), expectedBankId: f.nativeBankId,
      expectedProviderLineage: proof.request.provider_lineage, now: next })).toThrow("HINDSIGHT_SNAPSHOT_EXPIRED");
    const saved = saveHindsightCurrentVerification(f.db, { lease: f.lease, ...proof, replicaEpochId: CURRENT_REPLICA, now: next });
    expect(readHindsightCurrentVerification(f.db, { preparationId: value.prepared.preparationId,
      snapshotId: certificate.snapshot.snapshot_id, now: "2100-01-01T00:00:00.000Z" })).toEqual(saved);
    const checkpoint = createHindsightReplicaRepo(f.db).checkpoint(f.nativeBankId)!;
    expect(checkpoint.snapshotExpiresAt).toBe(certificate.snapshot.expires_at);
    const banks = [{ bankId: f.nativeBankId, templateDigest: f.templateDigest, checkpoint }];
    const digest = hindsightCheckpointSetDigest(banks);
    f.runs.markReady({ lease: f.lease, configFingerprint: "a".repeat(64), checkpointSetDigest: digest, now: next });
    expect(f.runs.verify({ runId: f.runId, expectedRevision: 0, expectedEpochId: f.epochId }).eligible).toBe(true);
    f.db.prepare("UPDATE hindsight_connection_state SET phase='configured',config_fingerprint=:config,compatibility_json=:json WHERE singleton=1")
      .run({ config: "a".repeat(64), json: JSON.stringify({ providerLineage: proof.request.provider_lineage }) });
    expect(promoteHindsightAuthority(f.db, { lease: f.lease, predecessorEpochId: f.epochId, hindsightEpochId: "retained-hindsight",
      transactionId: "retained-promotion", configFingerprint: "a".repeat(64), checkpointSetDigest: digest, banks, now: next }))
      .toMatchObject({ selection: { mode: "hindsight" } });
  });

  it.each(["bare-retention", "unsealed-expiry", "swapped-snapshot"] as const)("rejects %s as a retention exception", (caseName) => {
    const value = proofFixture(); const certificate = value.proof.status.certificate!;
    if (caseName === "bare-retention") {
      for (const key of Object.keys(certificate)) if (key !== "snapshot_retained") Reflect.deleteProperty(certificate, key);
    }
    if (caseName === "unsealed-expiry") certificate.snapshot.expires_at = "2026-08-22T00:00:30.000Z";
    if (caseName === "swapped-snapshot") {
      certificate.snapshot.expires_at = "2026-08-22T00:00:30.000Z"; reseal(value.proof);
      value.proof.snapshotPages.forEach((page) => { page.snapshot_id = CURRENT_REPLICA; });
    }
    expect(() => saveHindsightCurrentVerification(value.f.db, { lease: value.f.lease, ...value.proof,
      replicaEpochId: CURRENT_REPLICA, now: next })).toThrow();
    expect(value.f.db.prepare("SELECT count(*) AS n FROM hindsight_current_verification_evidence").get()?.n).toBe(0);
    expect(createHindsightReplicaRepo(value.f.db).checkpoint(value.f.nativeBankId)).toBeUndefined();
  });

  it("keeps earlier committed input groups without assigning them to the final model outcome", () => {
    const value = proofFixture(); const certificate = value.proof.status.certificate!; const records = value.proof.pages[0]!.records;
    const model = records.find((record) => record.record_kind === "model")!;
    if (model.record_kind !== "model") throw new Error("TEST_MODEL_MISSING");
    const requirement = records.find((record) => record.record_kind === "requirement"
      && record.requirement.requirement_key === model.requirement_key)!;
    if (requirement.record_kind !== "requirement") throw new Error("TEST_REQUIREMENT_MISSING");
    const earlier: Extract<HindsightCutoverEvidenceRecord, { record_kind: "input" }> = { ordinal: records.length,
      record_kind: "input", requirement_key: model.requirement_key, input_manifest_hash: "0".repeat(64), role: "retrieved",
      witness: { ...requirement.requirement.input, object_id: "previous-native-input" }, lifecycle: null };
    earlier.input_manifest_hash = currentInputManifestHash([earlier]); records.push(earlier);
    const action: Extract<HindsightCutoverEvidenceRecord, { record_kind: "action" }> = { ordinal: records.length,
      record_kind: "action", action_key: "0".repeat(64), step_key: "a".repeat(64), plan_id: CURRENT_REPLICA, action_index: 0,
      requirement_keys: [model.requirement_key], action: "native_decision", disposition: "no_op", reason: "native_no_action",
      verified_cursor: certificate.candidate_cursor, journal_batch: null, outputs: [], input_manifest_hash: earlier.input_manifest_hash };
    action.action_key = currentActionKey(certificate.verification_id, action); records.push(action);
    const outcome = records.find((record) => record.record_kind === "outcome" && record.requirement_key === model.requirement_key)!;
    if (outcome.record_kind !== "outcome") throw new Error("TEST_OUTCOME_MISSING");
    outcome.action_keys.push(action.action_key);
    certificate.evidence.total_records = records.length; certificate.evidence.counts.inputs++; certificate.evidence.counts.actions++;
    reseal(value.proof); expect(publish(value).status.state).toBe("complete");
  });

  it("rolls back raw replica publication and proof together on SQLite publication failure", () => {
    const value = proofFixture();
    value.f.db.exec(`CREATE TRIGGER reject_d78_checkpoint BEFORE INSERT ON hindsight_replica_checkpoints
      BEGIN SELECT RAISE(ABORT,'fixture publication failure'); END;`);
    expect(() => publish(value)).toThrow("fixture publication failure");
    expect(value.f.db.prepare("SELECT count(*) AS n FROM hindsight_current_verification_evidence").get()?.n).toBe(0);
    expect(value.f.db.prepare("SELECT count(*) AS n FROM hindsight_replica_records").get()?.n).toBe(0);
  });

  it("rebuilds a discarded raw replica from the same immutable certificate without another import", () => {
    const value = proofFixture(); const first = publish(value); const { f } = value;
    const proofRows = f.db.prepare("SELECT * FROM hindsight_current_verification_evidence").all();
    const imports = f.db.prepare("SELECT * FROM hindsight_current_import_evidence").all();
    expect(publish(value)).toEqual(first);
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_replica_staging_runs").get()?.n).toBe(1);
    f.db.prepare("DELETE FROM hindsight_replica_records WHERE bank_id=:bank").run({ bank: f.nativeBankId });
    f.db.prepare("DELETE FROM hindsight_replica_checkpoints WHERE bank_id=:bank").run({ bank: f.nativeBankId });
    expect(publish(value)).toEqual(first);
    expect(createHindsightReplicaRepo(f.db).visibleRecords(f.nativeBankId)).toHaveLength(value.native.records.length);
    expect(f.db.prepare("SELECT * FROM hindsight_current_verification_evidence").all()).toEqual(proofRows);
    expect(f.db.prepare("SELECT * FROM hindsight_current_import_evidence").all()).toEqual(imports);
  });

  it("refuses a late older certificate after a higher native cursor is already published", () => {
    const value = proofFixture(); const { f } = value; const replica = createHindsightReplicaRepo(f.db);
    const newer = currentSnapshotFixture(value.native.records, f.nativeBankId, value.native.result.native_through_cursor + 10);
    const metadata = normalizeSnapshotMetadata(newer.metadata);
    const stage = replica.stage({ runId: f.runId, replicaEpochId: CURRENT_REPLICA, metadata,
      pages: newer.pages.map(normalizeSnapshotPage), now });
    const checkpoint = replica.publish({ stagingId: stage.stagingId, capturedAt: metadata.createdAt, publishedAt: now });
    expect(() => publish(value)).toThrow("HINDSIGHT_CURRENT_REPLICA_STALE");
    expect(replica.checkpoint(f.nativeBankId)).toEqual(checkpoint);
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_current_verification_evidence").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT mode FROM memory_authority_selection").get()?.mode).toBe("canonical-local");
  });

  it("keeps Local active when a writer changes the frozen state or a promotion receipt fails", () => {
    const value = proofFixture(); publish(value); const { f } = value;
    const checkpoint = createHindsightReplicaRepo(f.db).checkpoint(f.nativeBankId)!;
    const banks = [{ bankId: f.nativeBankId, templateDigest: f.templateDigest, checkpoint }];
    const digest = hindsightCheckpointSetDigest(banks);
    f.runs.markReady({ lease: f.lease, configFingerprint: "a".repeat(64), checkpointSetDigest: digest, now });
    f.db.prepare("UPDATE hindsight_connection_state SET phase='configured',config_fingerprint=:config,compatibility_json=:json WHERE singleton=1")
      .run({ config: "a".repeat(64), json: JSON.stringify({ providerLineage: value.proof.request.provider_lineage }) });
    const input = { lease: f.lease, predecessorEpochId: f.epochId, hindsightEpochId: "new-hindsight", transactionId: "d78-promotion",
      configFingerprint: "a".repeat(64), checkpointSetDigest: digest, banks, now };
    f.db.exec(`CREATE TRIGGER reject_d78_promotion BEFORE INSERT ON hindsight_authority_bank_receipts
      BEGIN SELECT RAISE(ABORT,'fixture promotion failure'); END;`);
    expect(() => promoteHindsightAuthority(f.db, input)).toThrow("fixture promotion failure");
    expect(f.db.prepare("SELECT mode FROM memory_authority_selection").get()?.mode).toBe("canonical-local");
    f.db.exec("DROP TRIGGER reject_d78_promotion"); retainNewLocalSource(f.db, f);
    expect(() => promoteHindsightAuthority(f.db, input)).toThrow("HINDSIGHT_LOCAL_COVERAGE_STALE");
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(0);
  });
});
