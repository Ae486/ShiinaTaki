/** Real historical corpus structural checks only, on fresh private copies. No conversion, model or authority write. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { discoverTransitionLocal } from "../../../../packages/core/src/db/memory-transition-local-capture.ts";
import { readHindsightCurrentPreparation } from "../../../../packages/core/src/db/hindsight-current-preparation-repo.ts";
import { readHindsightCurrentImport } from "../../../../packages/core/src/db/hindsight-current-import-repo.ts";
import { readHindsightCurrentCaptureByManifest } from "../../../../packages/core/src/db/hindsight-current-capture-repo.ts";
import { readHindsightApplicationBootstrapEvidence } from "../../../../packages/core/src/db/hindsight-application-bootstrap-evidence.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../../../packages/core/src/db/canonical-memory-authority-repo.ts";
import { canonicalPayloadHash } from "../../../../packages/core/src/memory/legacy-migration/legacy-identities.ts";
import { transitionLocalHash } from "../../../../packages/core/src/memory/transitions/transition-local-encoding.ts";

const baseline = resolve(".trellis/.runtime/stage4-conversion-source");
const root = join(baseline, `w3-${randomUUID()}`); mkdirSync(root);
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const results = [];
for (const name of ["source-snapshot.sqlite", "validation.sqlite"]) {
  const source = join(baseline, name); const beforeHash = hash(source); const path = join(root, name);
  assert(!existsSync(`${source}-wal`) || statSync(`${source}-wal`).size === 0);
  copyFileSync(source, path);
  let db = openDatabase({ path, migrations: [] });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => String(row.name))
    .filter((name) => (name.startsWith("canonical_memory_") && !name.includes("fts")) || name === "taki_memory_blocks" || name.startsWith("hindsight_"));
  const columns = Object.fromEntries(tables.map((table) => [table, db.prepare(`PRAGMA table_info("${table}")`).all().map((row) => `"${row.name}"`).join(",")]));
  const snapshots = (database) => Object.fromEntries(tables.map((table) => [table,
    transitionLocalHash(Number(database.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n) === 0 ? []
      : database.prepare(`SELECT ${columns[table]} FROM "${table}"`).all().map((row) => JSON.stringify(row)).sort())]));
  const before = snapshots(db); db.close();
  db = openDatabase({ path, migrations: MIGRATIONS });
  try {
    assert.deepEqual(snapshots(db), before); assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    const epoch = createCanonicalMemoryAuthorityRepo(db).activeEpoch();
    let current;
    db.transaction(() => {
      db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id=active_epoch_id WHERE singleton=1").run();
      current = discoverTransitionLocal(db, epoch.epochId);
    });
    assert.equal(current.state.sources.length, 722); assert.equal(current.state.records.length, 722);
    assert.equal(current.state.banks.length, 2); assert.equal(current.state.blocks.length, 2);
    assert.equal(current.state.records.filter((record) => record.unit.state === "invalidated").length, 21);
    assert.equal(current.state.sourceSets.length, current.state.records.length);
    assert.equal(current.state.sourceAliases.length, 0);
    for (const record of current.state.records) {
      const set = current.state.sourceSets.find((row) => row.bankId === record.unit.bankId && row.memoryId === record.unit.memoryId); assert(set);
      if (record.unit.documentId !== null) assert(set.references.some((ref) => ref.documentId === record.unit.documentId));
      for (const ref of set.references) {
        const source = current.state.sources.find((row) => row.bankId === set.bankId && row.documentId === ref.documentId); assert(source);
        assert.deepEqual(ref.source, source); assert.equal(ref.intent, "local"); assert.equal(ref.artifact, null);
      }
    }
    for (const source of current.state.sources) {
      const row = db.prepare("SELECT metadata_json,retained_text,context,content_hash,provenance_json FROM canonical_memory_sources WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:id")
        .get({ epoch: epoch.epochId, bank: source.bankId, id: source.documentId });
      assert.deepEqual(source.metadata, JSON.parse(row.metadata_json)); assert.equal(source.retainedText, row.retained_text);
      assert.equal(source.context, row.context); assert.equal(source.contentHash, row.content_hash); assert.deepEqual(source.provenance, JSON.parse(row.provenance_json));
    }
    let mappings = 0;
    for (const row of db.prepare("SELECT preparation_id FROM hindsight_current_preparations").all()) {
      const prepared = readHindsightCurrentPreparation(db, String(row.preparation_id));
      const capture = readHindsightCurrentCaptureByManifest(db, prepared.manifestId); const imported = readHindsightCurrentImport(db, prepared.preparationId);
      assert(capture && imported);
      for (const mapping of imported.mappings) {
        const id = mapping.source.source_id;
        const record = mapping.target_kind === "bank" ? capture.banks.find((bank) => bank.bankId === id)
          : mapping.target_kind === "document" ? capture.sources.find((source) => source.bankId === prepared.sourceBankId && source.documentId === id)
            : capture.records.find((record) => record.unit.bankId === prepared.sourceBankId && record.unit.memoryId === id);
        assert(record); assert.equal(canonicalPayloadHash(record), mapping.source.source_payload_hash); mappings++;
      }
    }
    assert.deepEqual(snapshots(db), before);
    results.push({ name, banks: 2, sources: 722, records: 722, invalidated: 21, blocks: 2, mappings,
      sourceSets: current.state.sourceSets.length, sourceReferences: current.state.sourceSets.reduce((n, set) => n + set.references.length, 0),
      contentHash: current.contentHash, completeStateRoundtrip: transitionLocalHash(JSON.parse(JSON.stringify(current))) === transitionLocalHash(current),
      originalRowsUnchanged: true, originalFileUnchanged: hash(source) === beforeHash, migrationHead: MIGRATIONS.at(-1).version });
  } finally { db.close(); }
}
const activatedSource = join(baseline, "proof-89f9a26b-f575-42a7-8984-d07e0e1dc1a5/validation.sqlite");
assert(existsSync(activatedSource)); const activatedHash = hash(activatedSource); const activatedCopy = join(root, "activated.sqlite");
assert(!existsSync(`${activatedSource}-wal`)); copyFileSync(activatedSource, activatedCopy);
const db = openDatabase({ path: activatedCopy, migrations: MIGRATIONS });
let originalSources = 0; let originalPolicies = 0; let originalInvalidated = 0;
try {
  const epoch = createCanonicalMemoryAuthorityRepo(db).authorityEpoch(); assert.equal(epoch.providerId, "hindsight");
  for (const row of db.prepare("SELECT preparation_id FROM hindsight_current_preparations").all()) {
    const prepared = readHindsightCurrentPreparation(db, String(row.preparation_id)); assert(prepared.request);
    const original = readHindsightApplicationBootstrapEvidence(db, { authorityEpochId: epoch.epochId, bankId: prepared.bankId,
      bankScope: prepared.bankScope, namespace: { application_id: "taki", provider_lineage: prepared.request.provider_lineage,
        bank_generation: prepared.request.bank_generation } }); assert(original);
    originalSources += original.sources.size; originalPolicies += original.memories.size;
    originalInvalidated += [...original.memories.values()].filter(({ value }) => value.unit.state === "invalidated").length;
  }
  assert.equal(originalSources, 722); assert.equal(originalPolicies, 722); assert.equal(originalInvalidated, 21);
} finally { db.close(); }
assert.equal(hash(activatedSource), activatedHash);
const report = { root, results, bootstrap: { originalSources, originalPolicies, originalInvalidated, sourceUnchanged: true },
  conversionRequests: 0, modelRequests: 0, nativeRequests: 0, authorityWrites: 0,
  boundary: "Full real Local/original structural evidence only. Current native transition proof and real journey are W5 gates." };
writeFileSync(join(root, "result.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
