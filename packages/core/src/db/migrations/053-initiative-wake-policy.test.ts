import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { T4_HISTORICAL_MIGRATIONS as MIGRATIONS } from "./historical-t4.ts";
import { initiativeWakePolicyMigration053 } from "./053-initiative-wake-policy.ts";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { createWakePolicyRepo } from "../../initiative/wake/wake-policy-repo.ts";

const dbs: Database[] = []; const roots: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-wake-053-")) throw new Error("unsafe fixture cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
const before = () => MIGRATIONS.filter((migration) => migration.version < 53);
function open(path: string, migrated = true) {
  const db = openDatabase({ path, migrations: migrated ? [...before(), initiativeWakePolicyMigration053] : before() }); dbs.push(db); return db;
}

describe("wake source policy migration 053", () => {
  it("preserves prior receipts and source tombstones across an actual file reopen without rebuilding lost context", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-wake-053-")); roots.push(root); const path = join(root, "wake.db");
    const old = open(path, false);
    old.exec("INSERT INTO timeline_messages(id,character_id,role,content,created_at) VALUES('existing','taki','user','Existing','2026-09-28T10:00:00.000Z')");
    const receipts = old.prepare("SELECT * FROM migrations ORDER BY version").all(); old.close();
    const upgraded = open(path);
    upgraded.exec(`INSERT INTO initiative_wake_claims(source_key,opportunity_id,canonical_key,character_id,pattern_refs_json,
      created_at,expires_at,disposition) VALUES('source','opportunity','canonical','taki','[{"patternId":"p","revisionId":"r"}]',
      '2026-09-28T12:00:00.000Z','2026-09-28T12:01:00.000Z','pending')`);
    upgraded.close();
    const reopened = open(path); const repo = createWakePolicyRepo(reopened, () => Date.parse("2026-09-28T12:00:30.000Z"));
    repo.reconcile();
    expect(repo.claimed("source")).toBe(true);
    expect(reopened.prepare("SELECT disposition,run_id FROM initiative_wake_claims").get()).toEqual({ disposition: "retired", run_id: null });
    expect(reopened.prepare("SELECT * FROM migrations WHERE version<53 ORDER BY version").all()).toEqual(receipts);
    expect(reopened.prepare("SELECT content FROM timeline_messages").get()?.content).toBe("Existing");
    expect(reopened.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
    expect(runMigrations(reopened, [initiativeWakePolicyMigration053])).toEqual([]);
  });
  it("rolls back the entire additive schema on receipt failure", () => {
    const old = open(":memory:", false);
    old.exec("CREATE TRIGGER reject_053 BEFORE INSERT ON migrations WHEN NEW.version=53 BEGIN SELECT RAISE(ABORT,'receipt refused'); END");
    expect(() => runMigrations(old, [initiativeWakePolicyMigration053])).toThrow("migration 53 failed");
    expect(old.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'initiative_wake_%'").all()).toEqual([]);
  });
  it("enforces claim linkage, bounded payload and diagnostic count constraints", () => {
    const db = open(":memory:");
    expect(() => db.exec(`INSERT INTO initiative_wake_claims(source_key,opportunity_id,canonical_key,character_id,pattern_refs_json,
      created_at,expires_at,disposition) VALUES('source','opportunity','canonical','taki','[]','2026-09-28','2026-09-29','admitted')`)).toThrow(/CHECK/);
    expect(() => db.exec("INSERT INTO initiative_wake_evaluations(character_id,reason,source,matched_count,occurred_at) VALUES('taki','admitted','clock',5,'2026-09-28')")).toThrow(/CHECK/);
  });
});
