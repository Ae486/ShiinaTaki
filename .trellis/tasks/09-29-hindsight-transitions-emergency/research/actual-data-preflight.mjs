/** Upgrade new private copies through current production migrations and compare all existing logical fields. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../packages/core/src/db/migrations/index-list.ts";
import { readHindsightLocalCoverageState } from "../../../../packages/core/src/db/hindsight-local-coverage-reader.ts";
import { canonicalJson, canonicalPayloadHash } from "../../../../packages/core/src/memory/legacy-migration/legacy-identities.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const baseline = join(repo, ".trellis/.runtime/stage4-conversion-source");
const root = join(baseline, `preflight-${randomUUID()}`);
mkdirSync(root); // Inherits the private baseline ACL; never overwrite or migrate baseline files.
const results = [];
for (const name of ["source-snapshot.sqlite", "validation.sqlite"]) {
  const source = join(baseline, name);
  assert(!existsSync(`${source}-wal`) || statSync(`${source}-wal`).size === 0, "baseline has live WAL; use online backup instead");
  const path = join(root, name);
  copyFileSync(source, path);
  let db = openDatabase({ path, migrations: [] });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map((row) => String(row.name)).filter((table) => table.startsWith("canonical_memory_") && !table.includes("fts")
      || table.startsWith("legacy_") || table.startsWith("memory_migration") || table === "taki_memory_blocks");
  const quoted = (name) => `"${name.replaceAll('"', '""')}"`;
  const columns = Object.fromEntries(tables.map((table) => [table, db.prepare(`PRAGMA table_info(${quoted(table)})`).all().map((row) => String(row.name))]));
  const snapshot = () => Object.fromEntries(tables.map((table) => {
    const rows = db.prepare(`SELECT ${columns[table].map(quoted).join(",")} FROM ${quoted(table)}`).all();
    return [table, { count: rows.length, hash: canonicalPayloadHash(rows.map(canonicalJson).sort()) }];
  }));
  const before = snapshot();
  const originalVersions = db.prepare("SELECT * FROM migrations ORDER BY version").all();
  db.close();
  let applied;
  db = openDatabase({ path, migrations: MIGRATIONS, onMigrated: (versions) => { applied = versions; } });
  try {
    assert.deepEqual(snapshot(), before, "existing logical values or historical evidence changed during migration");
    assert.deepEqual(db.prepare("SELECT * FROM migrations WHERE version <= :head ORDER BY version").all({ head: originalVersions.at(-1).version }), originalVersions);
    assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    const coverage = readHindsightLocalCoverageState(db);
    assert.equal(coverage.sourceCount, 722);
    assert.equal(coverage.bankIds.length, 2);
    results.push({ file: name, applied, originalFieldsUnchanged: true, originalMigrationReceiptsUnchanged: true,
      quickCheck: "ok", banks: coverage.bankIds.length, sourceCount: coverage.sourceCount,
      witnesses: coverage.records.length, contentDigest: coverage.contentDigest, tables: before });
  } finally { db.close(); }
}
writeFileSync(join(root, "result.json"), JSON.stringify({ root, migrationHead: MIGRATIONS.at(-1).version, results }, null, 2) + "\n");
console.log(JSON.stringify({ root, migrationHead: MIGRATIONS.at(-1).version,
  results: results.map(({ tables, ...summary }) => summary) }));
