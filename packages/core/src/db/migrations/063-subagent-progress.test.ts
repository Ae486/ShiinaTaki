import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { MIGRATIONS } from "./index-list.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";

const databases: Database[] = []; const directories: string[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const dir of directories.splice(0)) rmTempDir(dir); });
it("upgrades and reopens T4 062 without rewriting old receipts/evidence or emitting work", () => {
  const dir = mkdtempSync(join(tmpdir(), "taki-progress-")); directories.push(dir);
  const path = join(dir, "state.db");
  const before = openDatabase({ path, migrations: MIGRATIONS.filter((entry) => entry.version < 63) }); databases.push(before);
  before.exec("INSERT INTO timeline_messages(id,character_id,role,content,created_at) VALUES ('retained','taki','user','Original historical evidence','2026-10-01T00:00:00Z')");
  const receipts = before.prepare("SELECT * FROM migrations ORDER BY version").all();
  const original = before.prepare("SELECT * FROM timeline_messages").all(); before.close();
  const upgraded = openDatabase({ path, migrations: MIGRATIONS }); databases.push(upgraded);
  expect(upgraded.prepare("SELECT * FROM migrations WHERE version<63 ORDER BY version").all()).toEqual(receipts);
  expect(upgraded.prepare(`SELECT ${Object.keys(original[0]!).join(",")} FROM timeline_messages`).all()).toEqual(original);
  for (const table of ["subagent_work_progress", "subagent_task_steps", "subagent_checkins", "subagent_events", "run_effects"]) {
    expect(upgraded.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
  }
  expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]); upgraded.close();
  const reopened = openDatabase({ path, migrations: MIGRATIONS }); databases.push(reopened);
  expect(runMigrations(reopened, MIGRATIONS)).toEqual([]);
});
