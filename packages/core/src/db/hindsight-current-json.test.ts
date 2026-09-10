import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./sqlite.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { currentStateFixture, currentImportFixture, currentMaintenanceFixture, CURRENT_REPLICA } from "./hindsight-current-fixtures.ts";
import { LOCAL_COVERAGE_NOW as now, LOCAL_COVERAGE_NEXT as next } from "./hindsight-local-coverage-fixtures.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import { readHindsightCurrentCaptureByManifest } from "./hindsight-current-capture-repo.ts";
import { readHindsightCurrentPreparation } from "./hindsight-current-preparation-repo.ts";
import { saveHindsightCurrentImport } from "./hindsight-current-import-repo.ts";
import { saveCurrentVerificationCandidate } from "./hindsight-current-candidate-repo.ts";
import { readHindsightCurrentVerification, saveHindsightCurrentVerification } from "./hindsight-current-verification-repo.ts";
import { createHindsightCutoverRunRepo } from "./hindsight-cutover-run-repo.ts";

const databases: Database[] = []; const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    const path = resolve(directory);
    if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith("taki-current-json-")) throw new Error("unsafe test cleanup");
    rmSync(path, { recursive: true, force: true });
  }
});
function open(path: string) { const db = openDatabase({ path, migrations: MIGRATIONS }); databases.push(db); return db; }

describe("D78 complete own-key JSON fidelity", () => {
  it("keeps source/unit/Bank/derived own keys through raw capture, native request, snapshot publication and file reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "taki-current-json-")); directories.push(directory);
    const path = join(directory, "memory.db"); const db = open(path); const f = currentStateFixture(db);
    const sourceJson = '{"__proto__":{"source":1},"constructor":"source","nested":[{"__proto__":{"typed":true},"constructor":{"prototype":"data"}}]}';
    const unitJson = '{"__proto__":{"unit":2},"constructor":"unit","nested":{"__proto__":"ordinary"}}';
    const source = JSON.parse(sourceJson) as Record<string, unknown>; const unit = JSON.parse(unitJson) as Record<string, unknown>;
    db.prepare("UPDATE canonical_memory_sources SET metadata_json=:json WHERE document_id=:id").run({ json: sourceJson, id: f.source.documentId });
    db.prepare("UPDATE canonical_memory_units SET metadata_json=:json WHERE memory_id=:id").run({ json: unitJson, id: f.record.unit.memoryId });
    db.prepare("UPDATE canonical_memory_banks SET config_json=:json WHERE bank_id=:id").run({ json: sourceJson, id: f.bankId });
    const derived = { kind: "mental_model" as const, bankId: f.bankId, mentalModelId: "own-key-model", subtype: "pinned", name: "Typed Model",
      sourceQuery: null, content: null, tags: [], maxTokens: null, trigger: null, lastRefreshedAt: null, createdAt: now,
      reflectResponse: null, structuredContent: null };
    createCanonicalMemoryRepo(db).saveDerived({ authorityEpochId: f.epochId, bankId: f.bankId, objectRevision: 2, payload: derived });
    db.prepare("UPDATE canonical_memory_derived SET payload_json=:json WHERE object_id=:id")
      .run({ json: JSON.stringify({ ...derived, trigger: source, reflectResponse: unit, structuredContent: { nested: source } }), id: derived.mentalModelId });
    const manifest = f.runs.captureCoverage({ lease: f.lease, now: next }); const prepared = f.prepare();
    const capture = readHindsightCurrentCaptureByManifest(db, manifest.manifestId)!;
    expect(capture.sources[0]?.metadata).toEqual(source); expect(capture.records[0]?.unit.metadata).toEqual(unit);
    expect(capture.banks[0]?.config).toEqual(source);
    expect(prepared.gaps).toEqual([]); expect(prepared.request?.documents[0]?.metadata).toEqual(source);
    expect(prepared.request?.memory_units[0]?.metadata).toEqual(unit);
    expect(prepared.request?.mental_models[0]).toMatchObject({ trigger: source, reflect_response: unit, structured_content: { nested: source } });
    expect(JSON.parse(capture.dispositions.find((item) => item.witness.kind === "source")!.payloadJson).metadata_json).toEqual(source);
    const native = currentImportFixture(prepared, f.baselineRecords);
    const imported = saveHindsightCurrentImport(db, { preparationId: prepared.preparationId, ...native });
    const proof = currentMaintenanceFixture(imported, native);
    saveCurrentVerificationCandidate(db, { preparationId: prepared.preparationId, request: proof.request, status: proof.candidate });
    const evidence = saveHindsightCurrentVerification(db, { lease: f.lease, ...proof, replicaEpochId: CURRENT_REPLICA, now });
    f.runs.markReady({ lease: f.lease, configFingerprint: "a".repeat(64), checkpointSetDigest: "b".repeat(64), now });
    db.close(); const reopened = open(path);
    expect(readHindsightCurrentCaptureByManifest(reopened, manifest.manifestId)).toEqual(capture);
    expect(readHindsightCurrentPreparation(reopened, prepared.preparationId)).toEqual(prepared);
    expect(readHindsightCurrentVerification(reopened, { preparationId: prepared.preparationId,
      snapshotId: proof.status.certificate!.snapshot.snapshot_id, now: next })).toEqual(evidence);
    const rawUnit = reopened.prepare("SELECT payload_json FROM hindsight_replica_records WHERE object_kind='memory_unit'").get();
    expect(JSON.parse(String(rawUnit?.payload_json)).metadata).toEqual(unit);
    expect(createHindsightCutoverRunRepo(reopened).verify({ runId: f.runId, expectedRevision: 0, expectedEpochId: f.epochId }).eligible).toBe(true);
    expect(Object.hasOwn(Object.prototype, "source")).toBe(false); expect(Object.hasOwn(Object.prototype, "unit")).toBe(false);
  });
});
