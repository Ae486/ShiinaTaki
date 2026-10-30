import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { MIGRATIONS } from "./index-list.ts";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { createInitiativeOpportunityRepo } from "../initiative-opportunity-repo.ts";

const roots: string[] = []; const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-initiative-050-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});
function open(path: string, through = 50) {
  const db = openDatabase({ path, migrations: MIGRATIONS.filter((migration) => migration.version <= through) }); dbs.push(db); return db;
}

describe("initiative model-opportunity migration 050", () => {
  it("upgrades recorded 049 without changing receipts, Timeline or User Timezone, and reopens without replay", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-initiative-050-")); roots.push(root);
    const path = join(root, "taki.db"); const old = open(path, 49);
    old.exec(`INSERT INTO timeline_messages(id,character_id,role,content,created_at)
      VALUES('existing','taki','assistant','Existing speech','2026-09-26T12:00:00.000Z')`);
    old.exec("UPDATE user_timezone SET timezone='Asia/Shanghai',revision=4,source='operator'");
    const receipts = old.prepare("SELECT * FROM migrations ORDER BY version").all();
    const timeline = old.prepare("SELECT * FROM timeline_messages").all();
    const timezone = old.prepare("SELECT * FROM user_timezone").all(); old.close();
    const upgraded = open(path);
    expect(upgraded.prepare("SELECT * FROM migrations WHERE version<=49 ORDER BY version").all()).toEqual(receipts);
    expect(upgraded.prepare("SELECT * FROM timeline_messages").all()).toEqual(timeline);
    expect(upgraded.prepare("SELECT * FROM user_timezone").all()).toEqual(timezone);
    const repo = createInitiativeOpportunityRepo(upgraded, () => "2026-09-26T12:00:00.000Z");
    expect(repo.reserve({ key: "persisted", hourLimit: 1, expiresAt: "2026-09-26T12:01:00.000Z" })).toBe(true);
    upgraded.close();
    const reopened = open(path);
    expect(runMigrations(reopened, MIGRATIONS.filter((migration) => migration.version <= 50))).toEqual([]);
    const restored = createInitiativeOpportunityRepo(reopened, () => "2026-09-26T12:00:01.000Z");
    expect(restored.reserve({ key: "next", hourLimit: 1, expiresAt: "2026-09-26T12:01:00.000Z" })).toBe(false);
    expect(reopened.prepare("SELECT max(version) AS v FROM migrations").get()?.v).toBe(50);
  });

  it("rejects impossible charged rows and rolls back table creation if the migration receipt fails", () => {
    const db = open(":memory:");
    expect(() => db.exec(`INSERT INTO initiative_model_opportunities(opportunity_key,state,reserved_at,expires_at)
      VALUES('bad','charged','2026-09-26T12:00:00.000Z','2026-09-26T12:01:00.000Z')`)).toThrow(/CHECK/);
    const old = open(":memory:", 49);
    old.exec("CREATE TRIGGER reject_050 BEFORE INSERT ON migrations WHEN NEW.version=50 BEGIN SELECT RAISE(ABORT,'receipt refused'); END");
    expect(() => runMigrations(old, MIGRATIONS)).toThrow("migration 50 failed");
    expect(old.prepare("SELECT name FROM sqlite_schema WHERE name='initiative_model_opportunities'").get()).toBeUndefined();
    expect(old.prepare("SELECT max(version) AS v FROM migrations").get()?.v).toBe(49);
  });
});
