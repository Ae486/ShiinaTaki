import { afterEach, describe, expect, it } from "vitest";
import { createLocalCoverageFixture, LOCAL_COVERAGE_NOW as now, LOCAL_COVERAGE_NEXT as next,
  retainNewLocalSource } from "./hindsight-local-coverage-fixtures.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  return createLocalCoverageFixture(db);
}
function readyInput(value: ReturnType<typeof fixture>) {
  return { lease: value.lease, configFingerprint: "a".repeat(64), checkpointSetDigest: "b".repeat(64), now };
}
function runState(db: Database) { return db.prepare("SELECT * FROM hindsight_cutover_runs WHERE run_id='run'").get(); }

describe("B4 run current Local coverage guard", () => {
  it("captures current Local at creation but refuses readiness without comparable full import evidence", () => {
    const value = fixture(); const before = runState(value.db);
    expect(value.manifest).toMatchObject({ runId: "run", localEpochId: value.epochId, sourceCount: 1, b2MatchingRecordCount: 1 });
    expect(value.runs.status("run")).toMatchObject({ sourceCount: 1,
      localCoverage: { state: "current", currentSourceCount: 1, frozenSourceCount: 1, catchUpCount: 2 } });
    expect(() => value.runs.markReady(readyInput(value))).toThrow("HINDSIGHT_LOCAL_COVERAGE_UNPROVEN");
    expect(runState(value.db)).toEqual(before);
    expect(value.runs.verify({ runId: "run", expectedRevision: 0, expectedEpochId: value.epochId }))
      .toMatchObject({ eligible: false, blockingCodes: expect.arrayContaining(["HINDSIGHT_LOCAL_COVERAGE_UNPROVEN"]) });
  });

  it("refuses missing and stale coverage before changing readiness or original resumable mappings", () => {
    const value = fixture(); seedMappedOperation(value);
    const operation = value.db.prepare("SELECT * FROM hindsight_import_operations").get();
    const before = runState(value.db);
    value.db.exec("DELETE FROM hindsight_cutover_local_coverage");
    expect(() => value.runs.markReady(readyInput(value))).toThrow("HINDSIGHT_LOCAL_COVERAGE_MISSING");
    expect(runState(value.db)).toEqual(before);
    expect(value.runs.verify({ runId: "run", expectedRevision: 0, expectedEpochId: value.epochId }))
      .toMatchObject({ eligible: false, blockingCodes: expect.arrayContaining(["HINDSIGHT_LOCAL_COVERAGE_MISSING"]) });
    value.runs.captureCoverage({ lease: value.lease, now: next });
    const currentState = runState(value.db);
    retainNewLocalSource(value.db, value);
    expect(value.runs.status("run")).toMatchObject({ sourceCount: 2, operationCounts: { mapped: 1 },
      localCoverage: { state: "stale", currentSourceCount: 2, frozenSourceCount: 1 } });
    expect(() => value.runs.markReady(readyInput(value))).toThrow("HINDSIGHT_LOCAL_COVERAGE_STALE");
    expect(runState(value.db)).toEqual(currentState);
    expect(value.db.prepare("SELECT * FROM hindsight_import_operations").get()).toEqual(operation);
  });

  it("requires new proof for an explicitly selected catch-up version while preserving every old operation byte", () => {
    const value = fixture(); seedMappedOperation(value);
    const operation = value.db.prepare("SELECT * FROM hindsight_import_operations").get();
    retainNewLocalSource(value.db, value);
    const current = value.runs.captureCoverage({ lease: value.lease, now: next });
    expect(current.manifestVersion).toBe(2);
    expect(current.manifestId).not.toBe(value.manifest.manifestId);
    expect(value.coverage.read(value.manifest.manifestId)).toEqual(value.manifest);
    expect(value.runs.status("run")).toMatchObject({ sourceCount: 2, phase: "importing", status: "running",
      localCoverage: { state: "current", currentSourceCount: 2, frozenSourceCount: 2 } });
    expect(() => value.runs.markReady(readyInput(value))).toThrow("HINDSIGHT_LOCAL_CATCH_UP_REQUIRED");
    expect(value.runs.verify({ runId: "run", expectedRevision: 0, expectedEpochId: value.epochId }))
      .toMatchObject({ eligible: false, blockingCodes: expect.arrayContaining(["HINDSIGHT_LOCAL_CATCH_UP_REQUIRED"]) });
    expect(value.db.prepare("SELECT * FROM hindsight_import_operations").get()).toEqual(operation);
    expect(value.db.prepare("SELECT count(*) AS n FROM memory_migration_sources").get()?.n).toBe(1);
    expect(value.db.prepare("SELECT ready_manifest_id FROM hindsight_cutover_local_coverage").get()?.ready_manifest_id).toBeNull();
  });

  it("rejects a previous manifest selection even when a new version captured identical Local bytes", () => {
    const value = fixture(); const current = value.runs.captureCoverage({ lease: value.lease, now: next });
    expect(current.contentDigest).toBe(value.manifest.contentDigest);
    expect(current.manifestId).not.toBe(value.manifest.manifestId);
    expect(() => value.coverage.readForPreparation({ runId: "run", manifestId: value.manifest.manifestId,
      expectedEpochId: value.epochId, bankId: value.bankId, documentId: value.source.documentId }))
      .toThrow("HINDSIGHT_LOCAL_COVERAGE_SELECTION_STALE");
    expect(() => value.runs.markReady(readyInput(value))).toThrow("HINDSIGHT_LOCAL_COVERAGE_UNPROVEN");
  });

  it("requires the current B4 lease for selection changes and readiness", () => {
    const value = fixture(); const stale = { ...value.lease, fence: value.lease.fence + 1 };
    const before = value.db.prepare("SELECT * FROM hindsight_cutover_local_coverage").get();
    expect(() => value.runs.captureCoverage({ lease: stale, now: next })).toThrow("LEASE_LOST");
    expect(() => value.runs.markReady({ ...readyInput(value), lease: stale })).toThrow("LEASE_LOST");
    expect(value.db.prepare("SELECT * FROM hindsight_cutover_local_coverage").get()).toEqual(before);
    expect(value.db.prepare("SELECT count(*) AS n FROM hindsight_local_coverage_manifests").get()?.n).toBe(1);
  });

  it("revalidates actual authority lineage inside the current coverage check", () => {
    const value = fixture();
    value.db.prepare("UPDATE canonical_memory_authority_epochs SET provider_lineage_id='changed' WHERE epoch_id=:epoch").run({ epoch: value.epochId });
    expect(value.coverage.compareCurrent(value.manifest.manifestId).differences)
      .toContainEqual(expect.objectContaining({ kind: "epoch", change: "changed" }));
    expect(() => value.runs.markReady(readyInput(value))).toThrow("HINDSIGHT_LOCAL_COVERAGE_STALE");
  });
});

function seedMappedOperation(value: ReturnType<typeof fixture>): void {
  value.db.prepare(`INSERT INTO hindsight_import_operations
    (run_id,source_id,bank_id,document_id,operation_identity,remote_operation_id,content_identity,provider_content_hash,
      lease_fence,attempt_no,status,derived_unit_count,mapping_complete,updated_at)
    VALUES ('run',:source,:bank,:document,'old-operation','old-remote',:content,:hash,1,1,'mapped',1,1,:now)`)
    .run({ source: value.sourceId, bank: value.bankId, document: value.source.documentId,
      content: value.source.contentHash, hash: "c".repeat(64), now });
  value.db.prepare(`INSERT INTO hindsight_import_facts (run_id,source_id,fact_ordinal,fact_id,revision,payload_hash)
    VALUES ('run',:source,0,'old-fact',1,:hash)`).run({ source: value.sourceId, hash: "d".repeat(64) });
}
