import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import { createStructuredMemoryBlockRepo } from "./structured-memory-block-repo.ts";
import { createHindsightLocalCoverageRepo } from "./hindsight-local-coverage-repo.ts";
import { createHindsightCutoverRunRepo } from "./hindsight-cutover-run-repo.ts";
import { createLocalCoverageFixture, LOCAL_COVERAGE_NOW as now, LOCAL_COVERAGE_NEXT as next,
  retainNewLocalSource, seedLocalB2CoverageFixture } from "./hindsight-local-coverage-fixtures.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { normalizeLegacySource } from "../memory/legacy-migration/legacy-source-normalizer.ts";
import { convertLegacyEntry } from "../memory/legacy-migration/legacy-canonical-converter.ts";
import { createLegacyCanonicalImportRepo } from "../memory/legacy-migration/legacy-canonical-import-repo.ts";

const dbs: Database[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    const target = resolve(root);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("taki-local-coverage-")) {
      throw new Error("unsafe Local coverage fixture path");
    }
    rmSync(target, { recursive: true, force: true });
  }
});
function database(path = ":memory:"): Database { const db = openDatabase({ path, migrations: MIGRATIONS }); dbs.push(db); return db; }
function fixture() { return createLocalCoverageFixture(database()); }
function originalEvidence(db: Database): string {
  const rows = ["memory_migration_runs", "memory_migration_sources", "memory_migration_results", "memory_migration_activation_receipts"]
    .map((table) => db.prepare(`SELECT * FROM ${table}`).all());
  rows.push(db.prepare(`SELECT * FROM canonical_memory_operation_receipts WHERE request_id IN
    (SELECT operation_id FROM memory_migration_sources) ORDER BY request_id`).all());
  return JSON.stringify(rows);
}
function mutationInput(value: ReturnType<typeof fixture>, expectedRevision = 1) {
  return { epochId: value.epochId, bankId: value.bankId, memoryId: value.record.unit.memoryId,
    expectedRevision, requestId: `mutation-${expectedRevision}`, requestHash: "9".repeat(64), now: next, searchTerms: "current" };
}

describe("current Local coverage persistence and comparison", () => {
  it("freezes every Bank including an empty Bank and actual B2 record hashes without rewriting original evidence", () => {
    const db = database(); const value = seedLocalB2CoverageFixture(db);
    createCanonicalMemoryAuthorityRepo(db).createBank({ authorityEpochId: value.epochId, bankId: "empty-bank",
      scope: { kind: "character", characterId: "new-character" }, name: "Empty", disposition: { skepticism: 1, literalism: 2, empathy: 3 },
      mission: "empty Bank config", config: { sample: true }, createdAt: now, updatedAt: now });
    const before = originalEvidence(db); const runs = createHindsightCutoverRunRepo(db);
    runs.create({ runId: value.runId, expectedPredecessorEpochId: value.epochId, now });
    const coverage = createHindsightLocalCoverageRepo(db); const captured = coverage.selected(value.runId)!;
    expect(captured.bankIds).toEqual(["bank", "empty-bank"]);
    expect(captured.b2MatchingRecordCount).toBe(1);
    expect(captured.catchUp).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "source", reason: "b2-unproven" }),
      expect.objectContaining({ kind: "bank", objectId: "empty-bank", reason: "b2-unproven" }),
    ]));
    const sourceWitness = captured.records.find((item) => item.kind === "source")!;
    expect(sourceWitness.sourceHashes).toMatchObject({ declaredContentHash: value.source.contentHash,
      retainedTextSha256: createHash("sha256").update(value.source.retainedText!).digest("hex") });
    expect(sourceWitness.sourceHashes?.retainedTextSha256).not.toBe(value.source.contentHash);
    expect(JSON.stringify(captured)).not.toContain("Original retained source text");
    expect(captured.records.map((item) => item.key)).toEqual(captured.records.map((item) => item.key).sort());
    expect(coverage.compareCurrent(captured.manifestId)).toMatchObject({ matches: true, differences: [] });
    expect(originalEvidence(db)).toBe(before);
  });

  it("replays the same capture and reopens exact immutable JSON/hash bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-local-coverage-")); roots.push(root);
    const path = join(root, "owned.db"); const db = database(path); const value = createLocalCoverageFixture(db);
    const stored = db.prepare("SELECT * FROM hindsight_local_coverage_manifests").get();
    const before = originalEvidence(db);
    expect(value.coverage.capture({ runId: value.runId, expectedEpochId: value.epochId, capturedAt: now })).toEqual(value.manifest);
    expect(() => db.prepare("UPDATE hindsight_local_coverage_manifests SET captured_at=:at").run({ at: next }))
      .toThrow("HINDSIGHT_LOCAL_COVERAGE_IMMUTABLE");
    expect(() => db.exec("DELETE FROM hindsight_local_coverage_manifests")).toThrow("HINDSIGHT_LOCAL_COVERAGE_IMMUTABLE");
    db.close(); const reopened = database(path);
    expect(reopened.prepare("SELECT * FROM hindsight_local_coverage_manifests").get()).toEqual(stored);
    expect(createHindsightLocalCoverageRepo(reopened).read(value.manifest.manifestId)).toEqual(value.manifest);
    expect(originalEvidence(reopened)).toBe(before);
  });

  it.each(["manifest ID", "run/version", "capture identity"])("refuses INSERT OR REPLACE through the %s uniqueness boundary", (collision) => {
    const value = fixture(); value.db.exec("DELETE FROM hindsight_cutover_local_coverage");
    const original = value.db.prepare("SELECT * FROM hindsight_local_coverage_manifests").get()!;
    const before = originalEvidence(value.db);
    const replacement = { ...original, manifest_id: collision === "manifest ID" ? original.manifest_id! : "replacement-manifest",
      manifest_version: collision === "run/version" ? original.manifest_version! : 2,
      captured_at: collision === "capture identity" ? original.captured_at! : next };
    expect(() => value.db.prepare(`INSERT OR REPLACE INTO hindsight_local_coverage_manifests
      (manifest_id,run_id,local_epoch_id,manifest_version,schema_version,captured_at,content_digest,source_revision_fence,manifest_digest,manifest_json)
      VALUES (:manifest_id,:run_id,:local_epoch_id,:manifest_version,:schema_version,:captured_at,:content_digest,
        :source_revision_fence,:manifest_digest,:manifest_json)`).run(replacement)).toThrow("HINDSIGHT_LOCAL_COVERAGE_IMMUTABLE");
    expect(value.db.prepare("SELECT * FROM hindsight_local_coverage_manifests").get()).toEqual(original);
    expect(originalEvidence(value.db)).toBe(before);
  });

  it("detects unit edits even when the retained source revision/text are unchanged", () => {
    const value = fixture(); const repo = createCanonicalMemoryRepo(value.db);
    repo.edit({ ...mutationInput(value), patch: { text: "Edited current unit only." } });
    const result = value.coverage.compareCurrent(value.manifest.manifestId);
    expect(result).toMatchObject({ matches: false, currentSourceRevisionFence: value.manifest.sourceRevisionFence });
    expect(result.differences).toEqual([expect.objectContaining({ kind: "unit", change: "changed", previousRevision: 1, currentRevision: 2 })]);
    const nextManifest = value.runs.captureCoverage({ lease: value.lease, now: next });
    expect(nextManifest.catchUp).toContainEqual(expect.objectContaining({ kind: "unit", reason: "b2-changed", previousRevision: 1, currentRevision: 2 }));
    expect(nextManifest.b2MatchingRecordCount).toBe(0);
  });

  it("captures replacement retain's new source revision and every newly invalidated predecessor unit", () => {
    const value = fixture(); const repo = createCanonicalMemoryRepo(value.db);
    const unit = { ...value.record.unit, memoryId: "replacement-unit", text: "Replacement source unit.", createdAt: next, updatedAt: next };
    const source = { ...value.source, retainedText: "Replacement retained source.", updatedAt: next };
    repo.retain({ epochId: value.epochId, bankId: value.bankId, requestId: "replacement", requestHash: "7".repeat(64),
      source, unit, policy: { ...value.record.policy, memoryId: unit.memoryId }, searchTerms: unit.text });
    const captured = value.runs.captureCoverage({ lease: value.lease, now: next });
    expect(captured.sourceRevisionFence).not.toBe(value.manifest.sourceRevisionFence);
    expect(captured.records.filter((item) => item.kind === "unit")).toHaveLength(2);
    const prepared = value.coverage.readForPreparation({ runId: value.runId, manifestId: captured.manifestId,
      expectedEpochId: value.epochId, bankId: value.bankId, documentId: value.source.documentId });
    expect(prepared.source.revision).toBe(2);
    expect(prepared.records.map((record) => record.unit.state).sort()).toEqual(["invalidated", "valid"]);
  });

  it("canonicalizes JSON key order while preserving numeric/string distinctions and null source witnesses", () => {
    const value = fixture();
    value.db.prepare("UPDATE canonical_memory_sources SET metadata_json=:metadata WHERE document_id=:document")
      .run({ document: value.source.documentId, metadata: '{"numeric":1,"text":"1"}' });
    const captured = value.runs.captureCoverage({ lease: value.lease, now: next });
    value.db.prepare("UPDATE canonical_memory_sources SET metadata_json=:metadata WHERE document_id=:document")
      .run({ document: value.source.documentId, metadata: '{"text":"1","numeric":1}' });
    expect(value.coverage.compareCurrent(captured.manifestId)).toMatchObject({ matches: true, differences: [] });
    value.db.prepare("UPDATE canonical_memory_sources SET metadata_json=:metadata,retained_text=NULL,content_hash=NULL WHERE document_id=:document")
      .run({ document: value.source.documentId, metadata: '{"text":"1","numeric":"1"}' });
    expect(value.coverage.compareCurrent(captured.manifestId).differences)
      .toContainEqual(expect.objectContaining({ kind: "source", change: "changed", previousRevision: 1, currentRevision: 1 }));
    const missingText = value.runs.captureCoverage({ lease: value.lease, now: "2026-08-22T00:02:00.000Z" });
    expect(missingText.records.find((record) => record.kind === "source")?.sourceHashes)
      .toMatchObject({ declaredContentHash: null, retainedTextSha256: null });
    expect(value.coverage.readForPreparation({ runId: value.runId, manifestId: missingText.manifestId,
      expectedEpochId: value.epochId, bankId: value.bankId, documentId: value.source.documentId }).source.retainedText).toBeNull();
  });

  it("uses the real B2 zero-unit source receipt only for the full source representation it actually hashed", () => {
    const db = database(); const value = seedLocalB2CoverageFixture(db);
    const raw = new TextEncoder().encode(`---\nid: empty\nlayer: profile\nimportance: 1\ncreated: ${now}\nstatus: active\n---\n`);
    const normalized = normalizeLegacySource("entries/global/profile/empty.md", raw);
    if (!normalized.ok) throw new Error("TEST_NORMALIZATION_FAILED");
    const converted = convertLegacyEntry({ source: normalized.source, epochId: value.epochId, bankId: value.bankId });
    if (!converted.ok || converted.kind !== "zero") throw new Error("TEST_ZERO_SOURCE_FAILED");
    createLegacyCanonicalImportRepo(db).importZero(converted);
    db.prepare(`INSERT INTO memory_migration_sources
      (run_id,source_id,kind,relative_path,raw_sha256,byte_length,content_hash,phase,disposition,canonical_source_id,
        document_id,operation_id,result_count,updated_at)
      VALUES ('run',:source,'entry',:path,:raw,:bytes,:hash,'verified','converted-zero',:document,:document,:operation,0,:now)`)
      .run({ source: normalized.source.sourceId, path: normalized.source.relativePath, raw: normalized.source.rawSha256,
        bytes: raw.length, hash: converted.source.contentHash, document: converted.source.documentId, operation: converted.operationId, now });
    createHindsightCutoverRunRepo(db).create({ runId: "run", expectedPredecessorEpochId: value.epochId, now });
    const coverage = createHindsightLocalCoverageRepo(db); const captured = coverage.selected("run")!;
    expect(captured.catchUp.filter((item) => item.objectId === converted.source.documentId)).toEqual([]);
    expect(captured.sourceCount).toBe(2);
    db.prepare("UPDATE canonical_memory_sources SET context='' WHERE document_id=:document").run({ document: converted.source.documentId });
    expect(coverage.compareCurrent(captured.manifestId).differences)
      .toContainEqual(expect.objectContaining({ kind: "source", objectId: converted.source.documentId, change: "changed" }));
  });

  it("retains invalidated records and detects restore as a new current version", () => {
    const value = fixture(); const repo = createCanonicalMemoryRepo(value.db);
    repo.invalidate({ ...mutationInput(value), reason: "operator invalidated" });
    const invalidated = value.runs.captureCoverage({ lease: value.lease, now: next });
    expect(invalidated.records.filter((item) => item.kind === "unit")).toHaveLength(1);
    const prepared = value.coverage.readForPreparation({ runId: value.runId, manifestId: invalidated.manifestId,
      expectedEpochId: value.epochId, bankId: value.bankId, documentId: value.source.documentId });
    expect(prepared.records[0]?.unit).toMatchObject({ state: "invalidated", revision: 2 });
    repo.restore(mutationInput(value, 2));
    expect(value.coverage.compareCurrent(invalidated.manifestId).differences)
      .toContainEqual(expect.objectContaining({ kind: "unit", change: "changed", previousRevision: 2, currentRevision: 3 }));
    expect(() => value.coverage.readForPreparation({ runId: value.runId, manifestId: invalidated.manifestId,
      expectedEpochId: value.epochId, bankId: value.bankId, documentId: value.source.documentId })).toThrow("HINDSIGHT_LOCAL_COVERAGE_STALE");
  });

  it("detects real reclassification without mistaking policyVersion for a mutation counter", () => {
    const value = fixture(); const repo = createCanonicalMemoryRepo(value.db);
    repo.edit({ ...mutationInput(value), patch: {}, policy: { layerId: "activity", visibility: "hidden", retention: { kind: "rolling-window", days: 14 } } });
    expect(repo.record(value.epochId, value.bankId, value.record.unit.memoryId)?.policy.policyVersion).toBe(1);
    expect(value.coverage.compareCurrent(value.manifest.manifestId).differences)
      .toContainEqual(expect.objectContaining({ kind: "policy", change: "changed", previousRevision: 1, currentRevision: 1 }));
  });

  it("hashes independent policy/provenance payloads even without any source or unit revision advance", () => {
    const value = fixture();
    value.db.prepare("UPDATE canonical_memory_policy SET importance=2 WHERE memory_id=:memory").run({ memory: value.record.unit.memoryId });
    value.db.prepare("UPDATE canonical_memory_sources SET provenance_json=:json WHERE document_id=:document")
      .run({ document: value.source.documentId, json: JSON.stringify({ ...value.source.provenance, sourceRef: "changed-provenance" }) });
    const changes = value.coverage.compareCurrent(value.manifest.manifestId).differences;
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "policy", change: "changed", previousRevision: 1, currentRevision: 1 }),
      expect.objectContaining({ kind: "source-provenance", change: "changed" }),
    ]));
  });

  it("detects independent lineage and derived changes with stable source/unit revisions", () => {
    const value = fixture(); const other = retainNewLocalSource(value.db, value); const repo = createCanonicalMemoryRepo(value.db);
    const before = value.runs.captureCoverage({ lease: value.lease, now: next });
    repo.addLineage({ epochId: value.epochId, bankId: value.bankId, memoryId: value.record.unit.memoryId, sourceMemoryId: other.record.unit.memoryId });
    repo.saveDerived({ authorityEpochId: value.epochId, bankId: value.bankId, objectRevision: 1, payload: { kind: "directive",
      bankId: value.bankId, directiveId: "directive", name: "Current directive", content: "Preserve this full payload.", priority: 1,
      isActive: true, tags: [], createdAt: now, updatedAt: now } });
    const changes = value.coverage.compareCurrent(before.manifestId).differences;
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "lineage", change: "added", relatedId: other.record.unit.memoryId }),
      expect.objectContaining({ kind: "derived", change: "added", relatedId: "directive" }),
    ]));
    expect(repo.record(value.epochId, value.bankId, value.record.unit.memoryId)?.unit.revision).toBe(1);
    const derivedManifest = value.runs.captureCoverage({ lease: value.lease, now: "2026-08-22T00:02:00.000Z" });
    value.db.prepare("UPDATE canonical_memory_derived SET payload_json=json_set(payload_json,'$.content','Changed without revision')").run();
    expect(value.coverage.compareCurrent(derivedManifest.manifestId).differences)
      .toContainEqual(expect.objectContaining({ kind: "derived", change: "changed", previousRevision: 1, currentRevision: 1 }));
  });

  it("detects new and edited Banks and complete Memory Block state", () => {
    const value = fixture(); const authority = createCanonicalMemoryAuthorityRepo(value.db);
    authority.createBank({ authorityEpochId: value.epochId, bankId: "empty-bank", scope: { kind: "character", characterId: "new" },
      name: "Empty", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "", config: {}, createdAt: next, updatedAt: next });
    value.db.prepare("UPDATE canonical_memory_banks SET config_json=:config WHERE bank_id=:bank")
      .run({ config: JSON.stringify({ actual: { configuration: true } }), bank: value.bankId });
    createStructuredMemoryBlockRepo(value.db).replace({ blockId: "user-card", scope: { kind: "global", characterId: null },
      content: "Full block document", actor: "user", now: next });
    const changes = value.coverage.compareCurrent(value.manifest.manifestId).differences;
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "bank", objectId: "empty-bank", change: "added" }),
      expect.objectContaining({ kind: "bank", objectId: value.bankId, change: "changed", previousRevision: 1, currentRevision: 1 }),
      expect.objectContaining({ kind: "block", objectId: "user-card", change: "added" }),
    ]));
    const captured = value.runs.captureCoverage({ lease: value.lease, now: next });
    createStructuredMemoryBlockRepo(value.db).replace({ blockId: "user-card", scope: { kind: "global", characterId: null },
      content: "Edited block document", actor: "user", expectedRevision: 1, now: next });
    expect(value.coverage.compareCurrent(captured.manifestId).differences)
      .toContainEqual(expect.objectContaining({ kind: "block", change: "changed", currentRevision: 2 }));
  });

  it("records new current sources and missing B2 identities without manufacturing old ledger rows", () => {
    const value = fixture(); const before = originalEvidence(value.db);
    const added = retainNewLocalSource(value.db, value);
    const current = value.runs.captureCoverage({ lease: value.lease, now: next });
    expect(current.sourceCount).toBe(2);
    expect(current.catchUp).toContainEqual(expect.objectContaining({ kind: "source", objectId: added.source.documentId, reason: "b2-new" }));
    const b2BeforeDelete = JSON.stringify(value.db.prepare("SELECT * FROM memory_migration_results").all());
    value.db.prepare("DELETE FROM canonical_memory_units WHERE memory_id=:memory").run({ memory: value.record.unit.memoryId });
    value.db.prepare("DELETE FROM canonical_memory_sources WHERE document_id=:document").run({ document: value.source.documentId });
    const changes = value.coverage.compareCurrent(current.manifestId).differences;
    expect(changes).toContainEqual(expect.objectContaining({ kind: "source", objectId: value.source.documentId, change: "missing" }));
    const missing = value.runs.captureCoverage({ lease: value.lease, now: "2026-08-22T00:02:00.000Z" });
    expect(missing.catchUp).toContainEqual(expect.objectContaining({ kind: "unit", objectId: value.record.unit.memoryId, reason: "b2-missing" }));
    expect(missing.catchUp).toContainEqual(expect.objectContaining({ kind: "source", objectId: value.source.documentId, reason: "b2-missing" }));
    expect(JSON.stringify(value.db.prepare("SELECT * FROM memory_migration_results").all())).toBe(b2BeforeDelete);
    expect(originalEvidence(value.db)).toBe(before);
  });

  it("detects missing policy rows without hiding their units through an inner join", () => {
    const value = fixture();
    value.db.prepare("DELETE FROM canonical_memory_policy WHERE memory_id=:memory").run({ memory: value.record.unit.memoryId });
    expect(value.coverage.compareCurrent(value.manifest.manifestId).differences)
      .toContainEqual(expect.objectContaining({ kind: "policy", change: "missing", objectId: value.record.unit.memoryId }));
    const current = value.runs.captureCoverage({ lease: value.lease, now: next });
    expect(current.records.some((item) => item.kind === "unit" && item.objectId === value.record.unit.memoryId)).toBe(true);
    expect(() => value.coverage.readForPreparation({ runId: value.runId, manifestId: current.manifestId,
      expectedEpochId: value.epochId, bankId: value.bankId, documentId: value.source.documentId })).toThrow("HINDSIGHT_LOCAL_RECORD_INCOMPLETE");
  });

  it("refuses a capture that exceeds the record bound before publishing any partial evidence", () => {
    const value = fixture(); const before = value.db.prepare("SELECT * FROM hindsight_cutover_local_coverage").get();
    value.db.exec(`WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM n WHERE value<100001)
      INSERT INTO taki_memory_blocks (block_id,scope_kind,character_id,content,revision,updated_at)
      SELECT 'block-'||value,'global',NULL,'',1,'${now}' FROM n`);
    expect(() => value.runs.captureCoverage({ lease: value.lease, now: next })).toThrow("HINDSIGHT_LOCAL_COVERAGE_LIMIT_EXCEEDED");
    expect(value.db.prepare("SELECT count(*) AS n FROM hindsight_local_coverage_manifests").get()?.n).toBe(1);
    expect(value.db.prepare("SELECT * FROM hindsight_cutover_local_coverage").get()).toEqual(before);
  });
});
