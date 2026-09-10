import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import { captureHindsightCurrentLocal, readHindsightCurrentCaptureByManifest } from "./hindsight-current-capture-repo.ts";
import { readHindsightCurrentPreparation } from "./hindsight-current-preparation-repo.ts";
import { readHindsightCurrentImport, saveHindsightCurrentImport } from "./hindsight-current-import-repo.ts";
import { saveCurrentVerificationCandidate } from "./hindsight-current-candidate-repo.ts";
import { saveHindsightCurrentVerification } from "./hindsight-current-verification-repo.ts";
import { currentStateFixture, currentImportFixture, currentMaintenanceFixture, CURRENT_REPLICA } from "./hindsight-current-fixtures.ts";
import { LOCAL_COVERAGE_NOW as now, LOCAL_COVERAGE_NEXT as next, retainNewLocalSource } from "./hindsight-local-coverage-fixtures.ts";
import { hindsightCheckpointSetDigest, promoteHindsightAuthority } from "./hindsight-authority-repo.ts";
import { createHindsightReplicaRepo } from "./hindsight-replica-repo.ts";
import { currentStateFieldsWithout, hindsightCurrentStateHash } from "../memory/hindsight/hindsight-current-state-hash.ts";
import type { JsonValue } from "@taki/shared";

const databases: Database[] = []; const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("taki-current-state-")) throw new Error("unsafe test cleanup");
    rmSync(target, { recursive: true, force: true });
  }
});
function open(path = ":memory:") { const db = openDatabase({ path, migrations: MIGRATIONS }); databases.push(db); return db; }

describe("D78 complete current Local import evidence", () => {
  it("captures every witness and transfers current edited/invalidated state with independent typed source/unit fields", () => {
    const db = open(); const f = currentStateFixture(db); const memory = createCanonicalMemoryRepo(db);
    const unit = f.record.unit;
    memory.edit({ epochId: f.epochId, bankId: f.bankId, memoryId: unit.memoryId, expectedRevision: 1,
      requestId: "edit", requestHash: "a".repeat(64), now: next, searchTerms: "new", patch: { text: "Current edited fact.", context: "", entities: ["Alice", "ProjectA"] } });
    memory.invalidate({ epochId: f.epochId, bankId: f.bankId, memoryId: unit.memoryId, expectedRevision: 2,
      requestId: "invalidate", requestHash: "b".repeat(64), now: next, searchTerms: "", reason: "retired" });
    db.prepare("UPDATE canonical_memory_sources SET retained_text=NULL,context='' WHERE document_id=:id").run({ id: f.source.documentId });
    const manifest = f.runs.captureCoverage({ lease: f.lease, now: next }); const prepared = f.prepare();
    expect(prepared.gaps).toEqual([]);
    expect(prepared.request?.memory_units[0]).toMatchObject({ text: "Current edited fact.", state: "invalidated", context: "",
      entities: ["Alice", "ProjectA"], source: { source_revision: 3 }, invalidation_reason: "retired" });
    expect(prepared.request?.documents[0]).toMatchObject({ original_text: null, context: "", source: { source_revision: 1 } });
    expect(prepared.request?.documents[0]?.metadata).not.toEqual(prepared.request?.memory_units[0]?.metadata);
    const capture = readHindsightCurrentCaptureByManifest(db, manifest.manifestId)!;
    expect(capture.dispositions.map((item) => item.witness)).toEqual(manifest.records);
    expect(capture.records[0]?.policy).toEqual(memory.record(f.epochId, f.bankId, unit.memoryId)?.policy);
    expect(capture.records[0]?.provenance.origin).toBe("legacy-import");
  });

  it("keeps unknown chunks as an explicit gap while entity names remain ordinary native input", () => {
    const db = open(); const f = currentStateFixture(db);
    db.prepare("UPDATE canonical_memory_units SET chunk_id='old-chunk',entities_json='[\"Alice\"]'").run();
    f.runs.captureCoverage({ lease: f.lease, now: next });
    const prepared = f.prepare(); expect(prepared.request).toBeNull();
    expect(prepared.gaps).toEqual([{ code: "chunk_evidence_unavailable", objectKind: "memory_unit", objectId: f.record.unit.memoryId }]);
  });

  it.each(["nul-text", "nul-key", "depth"] as const)("retains valid Canonical %s bytes and reports the native gap before dispatch", (kind) => {
    const db = open(); const f = currentStateFixture(db); let nested: JsonValue = "leaf";
    for (let level = 0; level < 61; level++) nested = { child: nested };
    const metadata: Record<string, JsonValue> = kind === "depth" ? { nested }
      : kind === "nul-key" ? { "key\u0000end": "value" } : { text: "before\u0000after" };
    const source = { ...f.source, documentId: `source-${kind}`, metadata };
    const unit = { ...f.record.unit, memoryId: `memory-${kind}`, documentId: source.documentId };
    createCanonicalMemoryRepo(db).retain({ epochId: f.epochId, bankId: f.bankId, source, unit,
      policy: { ...f.record.policy, memoryId: unit.memoryId }, requestId: `retain-${kind}`, requestHash: "b".repeat(64), searchTerms: unit.text });
    const manifest = f.runs.captureCoverage({ lease: f.lease, now: next }); const prepared = f.prepare();
    expect(prepared.request).toBeNull();
    expect(prepared.gaps).toContainEqual({ code: kind === "depth" ? "native_json_depth" : "native_text_nul",
      objectKind: "bank", objectId: f.bankId });
    expect(readHindsightCurrentCaptureByManifest(db, manifest.manifestId)?.sources.find((item) => item.documentId === source.documentId)?.metadata)
      .toEqual(metadata);
  });

  it("keeps an unsupported Local model subtype as complete evidence and a pre-dispatch representation gap", () => {
    const db = open(); const f = currentStateFixture(db);
    createCanonicalMemoryRepo(db).saveDerived({ authorityEpochId: f.epochId, bankId: f.bankId, objectRevision: 1,
      payload: { kind: "mental_model", bankId: f.bankId, mentalModelId: "local-subtype", subtype: "local-only",
        name: "Existing Local Model", sourceQuery: null, content: null, tags: [], maxTokens: null, trigger: null,
        lastRefreshedAt: null, createdAt: now, reflectResponse: null, structuredContent: null } });
    const manifest = f.runs.captureCoverage({ lease: f.lease, now: next }); const prepared = f.prepare();
    expect(prepared.request).toBeNull();
    expect(prepared.gaps).toEqual([{ code: "native_model_subtype", objectKind: "mental_model", objectId: "local-subtype" }]);
    expect(readHindsightCurrentCaptureByManifest(db, manifest.manifestId)?.derived[0]?.payload).toMatchObject({ kind: "mental_model", subtype: "local-only" });
  });

  it("reopens immutable captures, requests and full native mappings without rewriting B2 evidence", () => {
    const directory = mkdtempSync(join(tmpdir(), "taki-current-state-")); directories.push(directory);
    const path = join(directory, "memory.db"); const db = open(path); const f = currentStateFixture(db);
    const oldRows = db.prepare("SELECT * FROM memory_migration_sources").all(); const prepared = f.prepare();
    const native = currentImportFixture(prepared, f.baselineRecords);
    const saved = saveHindsightCurrentImport(db, { preparationId: prepared.preparationId, ...native });
    expect(saveHindsightCurrentImport(db, { preparationId: prepared.preparationId, ...native })).toEqual(saved);
    expect(() => db.prepare("UPDATE hindsight_current_import_evidence SET result_hash=result_hash").run()).toThrow("IMMUTABLE");
    expect(() => db.exec("INSERT OR REPLACE INTO hindsight_current_import_evidence SELECT * FROM hindsight_current_import_evidence")).toThrow("IMMUTABLE");
    db.close(); const reopened = open(path);
    expect(readHindsightCurrentPreparation(reopened, prepared.preparationId)).toEqual(prepared);
    expect(readHindsightCurrentImport(reopened, prepared.preparationId)).toEqual(saved);
    expect(reopened.prepare("SELECT * FROM memory_migration_sources").all()).toEqual(oldRows);
  });

  it("rejects foreign namespace, altered mappings and missing pages without partial result rows", () => {
    const db = open(); const f = currentStateFixture(db); const prepared = f.prepare();
    const native = currentImportFixture(prepared, f.baselineRecords);
    for (const mutate of [
      (value: typeof native) => { value.result.bank_generation = CURRENT_REPLICA; },
      (value: typeof native) => { value.pages[0]!.mappings[1]!.source.source_payload_hash = "f".repeat(64); },
      (value: typeof native) => { value.pages = []; },
    ]) {
      const changed = structuredClone(native); mutate(changed);
      expect(() => saveHindsightCurrentImport(db, { preparationId: prepared.preparationId, ...changed })).toThrow();
      expect(readHindsightCurrentImport(db, prepared.preparationId)).toBeUndefined();
    }
  });

  it("accepts the unchanged Bank's historical cursor and rejects a rehashed new-write cursor", () => {
    const db = open(); const f = currentStateFixture(db); const prepared = f.prepare();
    const native = currentImportFixture(prepared, f.baselineRecords);
    const seal = () => {
      const page = native.pages[0]!;
      page.page_hash = hindsightCurrentStateHash({ page_number: 0, mappings: page.mappings });
      native.result.manifest.page_hashes = [page.page_hash]; native.result.manifest.mappings_hash = hindsightCurrentStateHash(page.mappings);
      native.result.result_hash = hindsightCurrentStateHash(currentStateFieldsWithout(native.result, ["result_hash"]));
      page.result_hash = native.result.result_hash;
    };
    native.pages[0]!.mappings[0]!.journal_cursor = native.result.native_through_cursor; seal();
    expect(() => saveHindsightCurrentImport(db, { preparationId: prepared.preparationId, ...native })).toThrow("HINDSIGHT_CURRENT_IMPORT_PROOF_INVALID");
    native.pages[0]!.mappings[0]!.journal_cursor = 1; seal();
    expect(saveHindsightCurrentImport(db, { preparationId: prepared.preparationId, ...native }).mappings[0]?.journal_cursor).toBe(1);
  });

  it("requires current proof after capture and detects a new Local write without replacing frozen state", () => {
    const db = open(); const f = currentStateFixture(db); const prepared = f.prepare();
    expect(() => f.runs.markReady({ lease: f.lease, configFingerprint: "a".repeat(64), checkpointSetDigest: "b".repeat(64), now }))
      .toThrow("HINDSIGHT_CURRENT_IMPORT_MISSING");
    retainNewLocalSource(db, f);
    expect(() => captureHindsightCurrentLocal(db, { lease: f.lease, manifestId: f.manifest.manifestId, expectedEpochId: f.epochId, now }))
      .toThrow("HINDSIGHT_LOCAL_COVERAGE_STALE");
    expect(readHindsightCurrentPreparation(db, prepared.preparationId)).toEqual(prepared);
  });

  it("publishes a complete certificate snapshot and permits B4 readiness without historical native B2 mapping rows", () => {
    const db = open(); const f = currentStateFixture(db); const prepared = f.prepare();
    const native = currentImportFixture(prepared, f.baselineRecords);
    const imported = saveHindsightCurrentImport(db, { preparationId: prepared.preparationId, ...native });
    const proof = currentMaintenanceFixture(imported, native);
    saveCurrentVerificationCandidate(db, { preparationId: prepared.preparationId, request: proof.request, status: proof.candidate });
    const evidence = saveHindsightCurrentVerification(db, { lease: f.lease, ...proof, replicaEpochId: CURRENT_REPLICA, now });
    expect(evidence.status.certificate?.snapshot_records_hash).toBe(proof.status.certificate?.snapshot_records_hash);
    expect(db.prepare("SELECT count(*) AS n FROM hindsight_import_operations").get()?.n).toBe(0);
    const checkpoint = createHindsightReplicaRepo(db).checkpoint(f.nativeBankId)!;
    const banks = [{ bankId: f.nativeBankId, templateDigest: f.templateDigest, checkpoint }];
    const digest = hindsightCheckpointSetDigest(banks);
    f.runs.markReady({ lease: f.lease, configFingerprint: "a".repeat(64), checkpointSetDigest: digest, now });
    expect(f.runs.verify({ runId: f.runId, expectedRevision: 0, expectedEpochId: f.epochId }).eligible).toBe(true);
    db.prepare("UPDATE hindsight_connection_state SET phase='configured',config_fingerprint=:config,compatibility_json=:json WHERE singleton=1")
      .run({ config: "a".repeat(64), json: JSON.stringify({ providerLineage: proof.request.provider_lineage }) });
    expect(promoteHindsightAuthority(db, { lease: f.lease, predecessorEpochId: f.epochId, hindsightEpochId: "new-hindsight",
      transactionId: "d78-promotion", configFingerprint: "a".repeat(64), checkpointSetDigest: digest, banks, now }).selection.mode).toBe("hindsight");
  });

  it("reserves the real SQLite writer through readiness and refuses a later competing Local edit", () => {
    const directory = mkdtempSync(join(tmpdir(), "taki-current-state-")); directories.push(directory);
    const path = join(directory, "memory.db"); const db = open(path); const f = currentStateFixture(db); const prepared = f.prepare();
    const native = currentImportFixture(prepared, f.baselineRecords);
    const imported = saveHindsightCurrentImport(db, { preparationId: prepared.preparationId, ...native });
    const proof = currentMaintenanceFixture(imported, native);
    saveCurrentVerificationCandidate(db, { preparationId: prepared.preparationId, request: proof.request, status: proof.candidate });
    saveHindsightCurrentVerification(db, { lease: f.lease, ...proof, replicaEpochId: CURRENT_REPLICA, now });
    const other = open(path); other.exec("PRAGMA busy_timeout=0"); let attempted = false;
    const actualPrepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, "prepare").mockImplementation((sql) => {
      if (!attempted && sql.includes("SELECT * FROM hindsight_current_preparations")) {
        attempted = true;
        expect(() => createCanonicalMemoryRepo(other).edit({ epochId: f.epochId, bankId: f.bankId,
          memoryId: f.record.unit.memoryId, expectedRevision: 1, requestId: "racing-edit", requestHash: "f".repeat(64),
          now: next, searchTerms: "edit", patch: { text: "A racing Local edit." } })).toThrow();
      }
      return actualPrepare(sql);
    });
    f.runs.markReady({ lease: f.lease, configFingerprint: "a".repeat(64), checkpointSetDigest: "b".repeat(64), now });
    expect(attempted).toBe(true); spy.mockRestore();
    createCanonicalMemoryRepo(other).edit({ epochId: f.epochId, bankId: f.bankId, memoryId: f.record.unit.memoryId,
      expectedRevision: 1, requestId: "later-edit", requestHash: "e".repeat(64), now: next, searchTerms: "later", patch: { text: "Later edit." } });
    expect(f.runs.verify({ runId: f.runId, expectedRevision: 0, expectedEpochId: f.epochId }))
      .toMatchObject({ eligible: false, blockingCodes: expect.arrayContaining(["HINDSIGHT_LOCAL_COVERAGE_STALE"]) });
    expect(db.prepare("SELECT mode FROM memory_authority_selection").get()?.mode).toBe("canonical-local");
  });
});
