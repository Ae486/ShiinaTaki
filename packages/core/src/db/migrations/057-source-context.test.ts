import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunSnapshotSchema, type TriggerRequest } from "@taki/shared";
import { createRunServiceStub } from "../../testing/run-service-stub.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { createRunEventRepo } from "../run-event-repo.ts";
import { createRunRepo } from "../run-repo.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations, type Migration } from "../migration-runner.ts";
import { createTimelineRepo } from "../timeline-repo.ts";
import { createRunDeliveryRepo } from "../run-delivery-repo.ts";
import { MIGRATIONS } from "./index-list.ts";
import { sourceContextMigration057 } from "./057-source-context.ts";

const databases: Database[] = [];
const directories: string[] = [];
const through056 = MIGRATIONS.filter(({ version }) => version <= 56);
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    const path = resolve(directory);
    if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith("taki-source-057-")) throw new Error("unsafe fixture path");
    rmTempDir(path);
  }
});
function open(path = ":memory:", migrations: Migration[] = MIGRATIONS) {
  const db = openDatabase({ path, migrations }); databases.push(db); return db;
}
function columns(db: Database, table: string) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}
async function seedDelivery(db: Database) {
  const request: TriggerRequest = { triggerRequestId: "source-fixture", idempotencyKey: "source-fixture", characterId: "taki",
    initiator: "scheduled", provenance: { provider: "test" }, contextMode: "autonomous", deliveryClass: "class_a" };
  const captured = await createRunServiceStub().admit(request);
  const snapshot = RunSnapshotSchema.omit({ snapshotId: true, runId: true, capturedAt: true, manifestDigest: true }).strip().parse(captured.snapshot);
  const runs = createRunRepo(db, createRunEventRepo(db));
  const { run, attempt } = runs.admit({ runId: "source-fixture-run", request, snapshot, provider: "test", modelId: "test" });
  db.prepare(`INSERT INTO run_deliveries(delivery_id,run_id,attempt_id,character_id,delivery_class,decision_json,
    expires_at,state,continuation,primary_version,timeline_seq,charged_at,created_at)
    VALUES('delivery',:runId,:attemptId,'taki','class_a',:decision,'2026-10-23T00:00:00.000Z','unknown','none',0,7,
      '2026-10-22T00:00:00.000Z','2026-10-22T00:00:00.000Z')`).run({ runId: run.runId, attemptId: attempt.attemptId,
    decision: '{ "outcome":"speak", "selectedCandidateIds":["original"], "text":"Original speech", "presentation":null, "responseExpectation":"none" }' });
}

describe("source context migration 057", () => {
  it("creates guarded nullable columns on a fresh install and reopens without work", () => {
    const db = open();
    for (const table of ["timeline_messages", "run_deliveries"]) {
      expect(columns(db, table).find((column) => column.name === "source_context_json"))
        .toMatchObject({ type: "TEXT", notnull: 0, dflt_value: null, pk: 0 });
    }
    expect(runMigrations(db, MIGRATIONS)).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("upgrades populated 056 records without changing original speech, delivery truth, sequence or receipts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "taki-source-057-")); directories.push(directory);
    const path = join(directory, "state.db");
    const old = open(path, through056);
    old.exec(`INSERT INTO timeline_messages(seq,id,character_id,role,content,created_at)
      VALUES(7,'550e8400-e29b-41d4-a716-446655440000','taki','assistant','Original speech','2026-10-22T00:00:00.000Z');
      INSERT INTO timeline_messages(seq,id,character_id,role,content,created_at)
      VALUES(90,'550e8400-e29b-41d4-a716-446655440001','taki','user','Deleted tail','2026-10-22T00:00:00.000Z');
      DELETE FROM timeline_messages WHERE seq=90;`);
    await seedDelivery(old);
    const timeline = old.prepare("SELECT * FROM timeline_messages").get();
    const delivery = old.prepare("SELECT * FROM run_deliveries").get();
    const receipts = old.prepare("SELECT * FROM migrations ORDER BY version").all();
    old.close();
    const upgraded = open(path);
    expect(upgraded.prepare("SELECT * FROM timeline_messages").get()).toEqual({ ...timeline, source_context_json: null });
    expect(upgraded.prepare("SELECT * FROM run_deliveries").get()).toEqual({ ...delivery, source_context_json: null });
    expect(upgraded.prepare("SELECT * FROM migrations WHERE version<=56 ORDER BY version").all()).toEqual(receipts);
    const repo = createTimelineRepo(upgraded);
    expect(repo.latestAscending("taki", 10)[0]).not.toHaveProperty("sourceContext");
    expect(createRunDeliveryRepo({ db: upgraded, events: createRunEventRepo(upgraded) }).get("source-fixture-run"))
      .toMatchObject({ state: "unknown", timelineSeq: 7 });
    expect(repo.append({ characterId: "taki", role: "user", content: "Next" }).seq).toBe(91);
    upgraded.close();
    const reopened = open(path);
    expect(runMigrations(reopened, MIGRATIONS)).toEqual([]);
    expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it.each(["timeline_messages", "run_deliveries"])("refuses constrained pre-existing source columns on %s atomically", (table) => {
    const db = open(":memory:", through056);
    db.exec(`ALTER TABLE ${table} ADD COLUMN source_context_json TEXT DEFAULT NULL`);
    expect(() => runMigrations(db, [sourceContextMigration057])).toThrow("migration 57 failed");
    const other = table === "timeline_messages" ? "run_deliveries" : "timeline_messages";
    expect(columns(db, other).some((column) => column.name === "source_context_json")).toBe(false);
    expect(db.prepare("SELECT version FROM migrations WHERE version=57").get()).toBeUndefined();
  });

  it("preserves a recognized pre-existing bare source column and its bytes", () => {
    const db = open(":memory:", through056);
    db.exec(`ALTER TABLE timeline_messages ADD COLUMN source_context_json TEXT;
      INSERT INTO timeline_messages(id,character_id,role,content,source_context_json,created_at)
      VALUES('old','taki','assistant','Original','{ "materials": [{ "label": "Known" }] }','2026-10-22T00:00:00.000Z');`);
    expect(runMigrations(db, [sourceContextMigration057])).toEqual([57]);
    expect(db.prepare("SELECT source_context_json FROM timeline_messages").get()?.source_context_json)
      .toBe('{ "materials": [{ "label": "Known" }] }');
    expect(() => db.exec("UPDATE timeline_messages SET source_context_json=NULL"))
      .toThrow("timeline source context is immutable");
  });

  it("rolls both columns and triggers back when migration receipt insertion fails", () => {
    const db = open(":memory:", through056);
    db.exec("CREATE TRIGGER refuse_source_receipt BEFORE INSERT ON migrations WHEN NEW.version=57 BEGIN SELECT RAISE(ABORT,'receipt failure'); END;");
    expect(() => runMigrations(db, [sourceContextMigration057])).toThrow("migration 57 failed");
    for (const table of ["timeline_messages", "run_deliveries"]) {
      expect(columns(db, table).some((column) => column.name === "source_context_json")).toBe(false);
    }
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE '%source_context_immutable'").all()).toEqual([]);
    expect(db.prepare("SELECT version FROM migrations WHERE version=57").get()).toBeUndefined();
  });

  it("rolls schema and receipt back on actual deferred-constraint COMMIT failure", () => {
    const db = open(":memory:", through056);
    const failed: Migration = { ...sourceContextMigration057, sql: sourceContextMigration057.sql + `
      CREATE TABLE source_commit_parent(id TEXT PRIMARY KEY);
      CREATE TABLE source_commit_child(id TEXT REFERENCES source_commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
      INSERT INTO source_commit_child(id) VALUES('missing');` };
    expect(() => runMigrations(db, [failed])).toThrow("migration 57 failed");
    for (const table of ["timeline_messages", "run_deliveries"]) {
      expect(columns(db, table).some((column) => column.name === "source_context_json")).toBe(false);
    }
    expect(db.prepare("SELECT version FROM migrations WHERE version=57").get()).toBeUndefined();
    expect(runMigrations(db, [sourceContextMigration057])).toEqual([57]);
  });
});
