import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { RunSnapshotSchema, TriggerRequestSchema } from "@taki/shared";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { createRunRepo } from "../run-repo.ts";
import { createRunServiceStub } from "../../testing/run-service-stub.ts";
import { T4_HISTORICAL_MIGRATIONS as MIGRATIONS } from "./historical-t4.ts";
import { initiativeBackoffMigration055 } from "./055-initiative-backoff.ts";

const dbs: Database[] = []; const roots: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-backoff-055-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});
function before() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS.filter((migration) => migration.version < 55) });
  dbs.push(db); return db;
}
describe("additive backoff migration 055", () => {
  it("preserves recorded predecessors and adds only reset fences and nullable canonical admission metadata", () => {
    const db = before(); const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all();
    expect(runMigrations(db, [initiativeBackoffMigration055])).toEqual([55]);
    expect(db.prepare("SELECT * FROM migrations WHERE version<55 ORDER BY version").all()).toEqual(receipts);
    expect(db.prepare("PRAGMA table_info(runs)").all().find((row) => row.name === "initiative_timezone"))
      .toMatchObject({ type: "TEXT", notnull: 0, dflt_value: null });
    expect(db.prepare("SELECT * FROM initiative_backoff_resets").all()).toEqual([]);
    expect(runMigrations(db, [initiativeBackoffMigration055])).toEqual([]);
  });
  it("upgrades populated 054 on disk and reopens with original admission, Timeline, quota and timezone intact", async () => {
    const root = mkdtempSync(join(tmpdir(), "taki-backoff-055-")); roots.push(root); const path = join(root, "upgrade.db");
    const old = openDatabase({ path, migrations: MIGRATIONS.filter((migration) => migration.version < 55) }); dbs.push(old);
    const request = TriggerRequestSchema.parse({ triggerRequestId: "old-request", idempotencyKey: "old-key",
      characterId: "taki", initiator: "heartbeat", provenance: { provider: "test" }, deliveryClass: "class_b", contextMode: "autonomous" });
    const template = await createRunServiceStub().admit(request);
    const snapshot = RunSnapshotSchema.omit({ snapshotId: true, runId: true, capturedAt: true, manifestDigest: true }).strip().parse(template.snapshot);
    createRunRepo(old).admit({ runId: template.run.runId, request, snapshot, provider: "test", modelId: "test" });
    old.exec(`INSERT INTO timeline_messages(id,character_id,role,content,created_at)
      VALUES('existing','taki','assistant','Retained speech','2026-09-28T12:00:00.000Z');
      UPDATE user_timezone SET timezone='Asia/Shanghai',revision=4,source='operator';
      INSERT INTO initiative_model_opportunities(opportunity_key,state,reserved_at,expires_at)
      VALUES('reserved-before-055','reserved','2026-09-28T12:00:00.000Z','2026-09-28T12:01:00.000Z')`);
    const receipts = old.prepare("SELECT * FROM migrations ORDER BY version").all();
    const runs = old.prepare("SELECT * FROM runs").all();
    const tables = ["timeline_messages", "user_timezone", "initiative_model_opportunities", "run_snapshots", "run_events"];
    const contents = tables.map((table) => old.prepare(`SELECT * FROM ${table}`).all()); old.close();
    const migrations = [...MIGRATIONS.filter((migration) => migration.version < 55), initiativeBackoffMigration055];
    const upgraded = openDatabase({ path, migrations }); dbs.push(upgraded);
    expect(upgraded.prepare("SELECT * FROM migrations WHERE version<55 ORDER BY version").all()).toEqual(receipts);
    expect(upgraded.prepare("SELECT * FROM runs").all()).toEqual(runs.map((run) => ({ ...run, initiative_timezone: null })));
    expect(tables.map((table) => upgraded.prepare(`SELECT * FROM ${table}`).all())).toEqual(contents);
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]); upgraded.close();
    const reopened = openDatabase({ path, migrations }); dbs.push(reopened);
    expect(runMigrations(reopened, migrations)).toEqual([]);
    expect(reopened.prepare("SELECT initiative_timezone FROM runs").get()?.initiative_timezone).toBeNull();
    expect(tables.map((table) => reopened.prepare(`SELECT * FROM ${table}`).all())).toEqual(contents);
    expect(reopened.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(55);
  });
  it.each(["receipt", "commit"])("rolls schema and metadata back after %s failure", (failure) => {
    const db = before();
    if (failure === "receipt") db.exec("CREATE TRIGGER reject_055 BEFORE INSERT ON migrations WHEN NEW.version=55 BEGIN SELECT RAISE(ABORT,'receipt refused'); END");
    else db.exec(`CREATE TABLE backoff_parent(id INTEGER PRIMARY KEY);
      CREATE TABLE backoff_child(parent INTEGER REFERENCES backoff_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER fail_055_commit AFTER INSERT ON migrations WHEN NEW.version=55 BEGIN INSERT INTO backoff_child(parent) VALUES(1); END`);
    expect(() => runMigrations(db, [initiativeBackoffMigration055])).toThrow("migration 55 failed");
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'initiative_backoff_%'").all()).toEqual([]);
    expect(db.prepare("PRAGMA table_info(runs)").all().some((row) => row.name === "initiative_timezone")).toBe(false);
  });
});
