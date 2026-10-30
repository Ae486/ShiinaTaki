import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createCanonicalMemoryRepo } from "../../db/canonical-memory-repo.ts";
import { createHindsightSourceEvidenceRepo } from "../../db/hindsight-source-evidence-repo.ts";
import {
  createLocalCoverageFixture, retainNewLocalSource, LOCAL_COVERAGE_NEXT,
} from "../../db/hindsight-local-coverage-fixtures.ts";
import { prepareCurrentLocalHindsightSource } from "./hindsight-current-local-source.ts";

const roots: string[] = [];
const databases: Database[] = [];
const nextCapture = "2026-08-22T00:02:00.000Z";

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-b4-source-integration-")) {
      throw new Error("unsafe source integration fixture path");
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function open(path = ":memory:"): Database {
  const db = openDatabase({ path, migrations: MIGRATIONS });
  databases.push(db);
  return db;
}

function filePath(): string {
  const root = mkdtempSync(join(tmpdir(), "taki-b4-source-integration-"));
  roots.push(root);
  return join(root, "source.db");
}

function currentFixture(db: Database) {
  const fixture = createLocalCoverageFixture(db);
  const current = retainNewLocalSource(db, fixture);
  const manifest = fixture.runs.captureCoverage({ lease: fixture.lease, now: LOCAL_COVERAGE_NEXT });
  const input = { runId: fixture.runId, manifestId: manifest.manifestId, expectedEpochId: fixture.epochId,
    bankId: fixture.bankId, documentId: current.source.documentId };
  return { ...fixture, current, manifest, input };
}

function b2Evidence(db: Database) {
  return {
    sources: db.prepare("SELECT * FROM memory_migration_sources ORDER BY source_id").all(),
    results: db.prepare("SELECT * FROM memory_migration_results ORDER BY source_id,result_ordinal").all(),
    receipts: db.prepare("SELECT * FROM memory_migration_activation_receipts ORDER BY run_id").all(),
  };
}

describe("current Local coverage to Hindsight source preparation", () => {
  it("persists actual post-B2 typed source/unit fields, replays identically and survives reopen without changing B2", () => {
    const path = filePath(); const db = open(path); const fixture = currentFixture(db);
    const originalB2 = b2Evidence(db);
    const prepared = prepareCurrentLocalHindsightSource(db, fixture.input);

    expect(prepared.gaps).toEqual([]);
    expect(prepared.source.metadata).toEqual({ numeric: 1, text: "1" });
    expect(prepared.units[0]?.record.unit.metadata).toEqual({ numeric: 2, text: "2" });
    expect(prepared.source.context).toBe(fixture.current.source.context);
    expect(prepared.source.provenance).toEqual(fixture.current.source.provenance);
    expect(prepared.units[0]?.record.policy).toEqual(fixture.current.record.policy);
    expect(prepared.nativeItem?.metadata).toEqual({ numeric: "1", text: "1" });
    expect(prepared.nativeItem?.content).toBe(fixture.current.source.retainedText);
    expect(prepared.units[0]?.record.unit.text).toBe(fixture.current.record.unit.text);
    expect(prepared.nativeItem?.content).not.toBe(prepared.units[0]?.record.unit.text);
    expect(prepareCurrentLocalHindsightSource(db, fixture.input)).toEqual(prepared);
    expect(db.prepare("SELECT count(*) AS n FROM hindsight_source_evidence").get()?.n).toBe(1);
    expect(b2Evidence(db)).toEqual(originalB2);
    db.close();

    const reopened = open(path);
    expect(createHindsightSourceEvidenceRepo(reopened).getPrepared(prepared.evidenceId)).toEqual(prepared);
    expect(prepareCurrentLocalHindsightSource(reopened, fixture.input)).toEqual(prepared);
    expect(b2Evidence(reopened)).toEqual(originalB2);
  });

  it("rejects a real unit edit after capture even though source revision and retained text did not change", () => {
    const db = open(); const fixture = currentFixture(db); const originalB2 = b2Evidence(db);
    const frozen = fixture.coverage.read(fixture.manifest.manifestId);
    createCanonicalMemoryRepo(db).edit({ epochId: fixture.epochId, bankId: fixture.bankId,
      memoryId: fixture.current.record.unit.memoryId, expectedRevision: 1, requestId: "edit-after-freeze",
      requestHash: "b".repeat(64), now: nextCapture, searchTerms: "edited current unit",
      patch: { text: "Edited current unit after the source was frozen." } });

    expect(db.prepare("SELECT revision,retained_text FROM canonical_memory_sources WHERE document_id=:document")
      .get({ document: fixture.current.source.documentId })).toEqual({ revision: 1, retained_text: fixture.current.source.retainedText });
    expect(() => prepareCurrentLocalHindsightSource(db, fixture.input)).toThrow("HINDSIGHT_LOCAL_COVERAGE_STALE");
    expect(db.prepare("SELECT count(*) AS n FROM hindsight_source_evidence").get()?.n).toBe(0);
    expect(fixture.coverage.read(fixture.manifest.manifestId)).toEqual(frozen);
    expect(b2Evidence(db)).toEqual(originalB2);
  });

  it("refuses an old selected manifest even when a newer capture has identical Local content", () => {
    const db = open(); const fixture = currentFixture(db);
    const next = fixture.runs.captureCoverage({ lease: fixture.lease, now: nextCapture });
    expect(next.contentDigest).toBe(fixture.manifest.contentDigest);
    expect(next.manifestId).not.toBe(fixture.manifest.manifestId);
    expect(() => prepareCurrentLocalHindsightSource(db, fixture.input)).toThrow("HINDSIGHT_LOCAL_COVERAGE_SELECTION_STALE");
    expect(db.prepare("SELECT count(*) AS n FROM hindsight_source_evidence").get()?.n).toBe(0);
    expect(prepareCurrentLocalHindsightSource(db, { ...fixture.input, manifestId: next.manifestId }).source.documentId)
      .toBe(fixture.current.source.documentId);
  });

  it("keeps invalidated Local units in prepared provenance after an explicit fresh capture", () => {
    const db = open(); const fixture = currentFixture(db);
    createCanonicalMemoryRepo(db).invalidate({ epochId: fixture.epochId, bankId: fixture.bankId,
      memoryId: fixture.current.record.unit.memoryId, expectedRevision: 1, requestId: "invalidate-before-capture",
      requestHash: "c".repeat(64), now: nextCapture, searchTerms: fixture.current.record.unit.text,
      reason: "Corrected by the user" });
    const manifest = fixture.runs.captureCoverage({ lease: fixture.lease, now: nextCapture });
    const prepared = prepareCurrentLocalHindsightSource(db, { ...fixture.input, manifestId: manifest.manifestId });
    expect(prepared.units).toHaveLength(1);
    expect(prepared.units[0]?.record.unit).toMatchObject({ state: "invalidated", revision: 2,
      invalidationReason: "Corrected by the user", metadata: { numeric: 2, text: "2" } });
  });

  it("persists a missing-retained-source gap without inventing native content or dropping typed fields", () => {
    const db = open(); const fixture = currentFixture(db);
    db.prepare("UPDATE canonical_memory_sources SET retained_text=NULL,revision=revision+1 WHERE document_id=:document")
      .run({ document: fixture.current.source.documentId });
    const manifest = fixture.runs.captureCoverage({ lease: fixture.lease, now: nextCapture });
    const prepared = prepareCurrentLocalHindsightSource(db, { ...fixture.input, manifestId: manifest.manifestId });
    expect(prepared.nativeItem).toBeNull();
    expect(prepared.retainedTextHash).toBeNull();
    expect(prepared.gaps).toContainEqual({ code: "source_text_missing", objectKind: "document", objectId: fixture.input.documentId });
    expect(prepared.source.metadata).toEqual({ numeric: 1, text: "1" });
    expect(prepared.units[0]?.record.unit.metadata).toEqual({ numeric: 2, text: "2" });
    expect(createHindsightSourceEvidenceRepo(db).getPrepared(prepared.evidenceId)).toEqual(prepared);
  });

  it("rolls back source and unit evidence together when the unit insert fails", () => {
    const db = open(); const fixture = currentFixture(db); const originalB2 = b2Evidence(db);
    db.exec("CREATE TRIGGER fail_source_unit_insert BEFORE INSERT ON hindsight_source_unit_evidence BEGIN SELECT RAISE(ABORT,'unit evidence failure'); END");
    expect(() => prepareCurrentLocalHindsightSource(db, fixture.input)).toThrow("unit evidence failure");
    expect(db.prepare("SELECT count(*) AS n FROM hindsight_source_evidence").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM hindsight_source_unit_evidence").get()?.n).toBe(0);
    expect(b2Evidence(db)).toEqual(originalB2);
    expect(fixture.coverage.assertCurrent(fixture.manifest.manifestId)).toEqual(fixture.manifest);
    db.exec("DROP TRIGGER fail_source_unit_insert");
    expect(prepareCurrentLocalHindsightSource(db, fixture.input).gapCount).toBe(0);
  });

  it("holds the Local writer reservation through evidence persistence against a second actual connection", () => {
    const path = filePath(); const db = open(path); const fixture = currentFixture(db);
    const other = open(path); other.exec("PRAGMA busy_timeout=0");
    let blockedAttempts = 0;
    const update = () => other.prepare("UPDATE canonical_memory_sources SET revision=revision+1 WHERE document_id=:document")
      .run({ document: fixture.input.documentId });
    const observed: Database = { ...db, prepare: (sql) => {
      if (sql.includes("INSERT INTO hindsight_source_evidence")) {
        expect(update).toThrow(/locked|busy/i);
        blockedAttempts += 1;
      }
      return db.prepare(sql);
    } };
    const prepared = prepareCurrentLocalHindsightSource(observed, fixture.input);
    expect(blockedAttempts).toBe(1);
    expect(prepared.source.revision).toBe(1);
    expect(createHindsightSourceEvidenceRepo(other).getPrepared(prepared.evidenceId)).toEqual(prepared);
    expect(update().changes).toBe(1);
    expect(() => prepareCurrentLocalHindsightSource(db, fixture.input)).toThrow("HINDSIGHT_LOCAL_COVERAGE_STALE");
    expect(createHindsightSourceEvidenceRepo(db).getPrepared(prepared.evidenceId)).toEqual(prepared);
  });
});
