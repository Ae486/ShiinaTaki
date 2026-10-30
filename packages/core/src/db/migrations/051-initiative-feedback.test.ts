import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { MIGRATIONS } from "./index-list.ts";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";

const through051 = MIGRATIONS.filter((migration) => migration.version <= 51);
const roots: string[] = []; const databases: Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-feedback-051-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});
function open(path: string, through = 51) {
  const db = openDatabase({ path, migrations: MIGRATIONS.filter((migration) => migration.version <= through) }); databases.push(db); return db;
}

describe("initiative feedback migration 051", () => {
  it("applies both additive tails after a recorded 049 without rewriting its receipt or old rows", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-feedback-051-")); roots.push(root); const path = join(root, "from-049.db");
    const old = open(path, 49);
    old.exec(`INSERT INTO timeline_messages(seq,id,character_id,role,content,created_at)
      VALUES(17,'before-feedback','taki','assistant','Retained 049 text','2026-09-27T00:00:00.000Z')`);
    const receipts = old.prepare("SELECT * FROM migrations ORDER BY version").all(); old.close();
    const upgraded = open(path);
    expect(upgraded.prepare("SELECT * FROM migrations WHERE version<=49 ORDER BY version").all()).toEqual(receipts);
    expect(upgraded.prepare("SELECT version FROM migrations WHERE version>49 ORDER BY version").all()).toEqual([{ version: 50 }, { version: 51 }]);
    expect(upgraded.prepare("SELECT seq,content FROM timeline_messages").get()).toMatchObject({ seq: 17, content: "Retained 049 text" });
    expect(upgraded.prepare("SELECT * FROM initiative_model_opportunities").all()).toEqual([]);
    expect(upgraded.prepare("SELECT * FROM initiative_feedback").all()).toEqual([]);
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    upgraded.close(); expect(runMigrations(open(path), through051)).toEqual([]);
  });

  it("preserves populated 050 Timeline, timezone and receipts on file-backed upgrade and reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-feedback-051-")); roots.push(root); const path = join(root, "taki.db");
    const old = open(path, 50);
    old.exec(`INSERT INTO timeline_messages(id,character_id,role,content,created_at)
      VALUES('retained','taki','assistant','Existing content','2026-09-27T00:00:00.000Z')`);
    old.exec("UPDATE user_timezone SET timezone='Asia/Shanghai',revision=3,source='operator'");
    const receipts = old.prepare("SELECT * FROM migrations ORDER BY version").all();
    const timeline = old.prepare("SELECT * FROM timeline_messages").all(); const timezone = old.prepare("SELECT * FROM user_timezone").all(); old.close();
    const upgraded = open(path);
    expect(upgraded.prepare("SELECT * FROM migrations WHERE version<=50 ORDER BY version").all()).toEqual(receipts);
    expect(upgraded.prepare("SELECT * FROM timeline_messages").all()).toEqual(timeline);
    expect(upgraded.prepare("SELECT * FROM user_timezone").all()).toEqual(timezone);
    expect(upgraded.prepare("SELECT * FROM initiative_feedback").all()).toEqual([]);
    expect(upgraded.prepare("SELECT * FROM delivery_presentations").all()).toEqual([]); upgraded.close();
    const reopened = open(path); expect(runMigrations(reopened, through051)).toEqual([]);
    expect(reopened.prepare("SELECT max(version) AS v FROM migrations").get()?.v).toBe(51);
    expect(reopened.prepare("SELECT name FROM sqlite_schema WHERE name LIKE '%presence%'").all()).toEqual([]);
  });

  it("rolls additive tables and indexes back if the migration receipt fails", () => {
    const old = open(":memory:", 50);
    old.exec("CREATE TRIGGER reject_feedback_receipt BEFORE INSERT ON migrations WHEN NEW.version=51 BEGIN SELECT RAISE(ABORT,'receipt refused'); END");
    expect(() => runMigrations(old, through051)).toThrow("migration 51 failed");
    expect(old.prepare("SELECT name FROM sqlite_schema WHERE name IN ('initiative_feedback','delivery_presentations','run_deliveries_feedback')").all()).toEqual([]);
    expect(old.prepare("SELECT max(version) AS v FROM migrations").get()?.v).toBe(50);
  });

  it("rolls the entire 051 schema and receipt back when COMMIT fails and allows a clean retry", () => {
    const old = open(":memory:", 50);
    old.exec(`CREATE TABLE feedback_test_parent(id INTEGER PRIMARY KEY);
      CREATE TABLE feedback_test_child(parent INTEGER REFERENCES feedback_test_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER fail_feedback_commit AFTER INSERT ON migrations WHEN NEW.version=51
      BEGIN INSERT INTO feedback_test_child(parent) VALUES(1); END`);
    expect(() => runMigrations(old, through051)).toThrow("migration 51 failed");
    expect(old.prepare("SELECT name FROM sqlite_schema WHERE name IN ('initiative_feedback','delivery_presentations','initiative_feedback_pending','initiative_feedback_character','run_deliveries_feedback')").all()).toEqual([]);
    expect(old.prepare("SELECT max(version) AS v FROM migrations").get()?.v).toBe(50);
    expect(old.prepare("SELECT * FROM feedback_test_child").all()).toEqual([]);
    old.exec("DROP TRIGGER fail_feedback_commit");
    expect(runMigrations(old, through051)).toEqual([51]);
    expect(old.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
