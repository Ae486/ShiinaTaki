import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { T4_HISTORICAL_MIGRATIONS as MIGRATIONS } from "./historical-t4.ts";
import { interactionPatternsMigration052 } from "./052-interaction-patterns.ts";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { createInteractionPatternService } from "../../initiative/patterns/pattern-service.ts";
import type { InteractionPatternDefinition } from "@taki/shared";

const databases: Database[] = [];
const roots: string[] = [];
const through52 = [...MIGRATIONS.filter((m) => m.version < 52), interactionPatternsMigration052];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-pattern-052-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});
function open(path = ":memory:", through = 52) {
  const db = openDatabase({ path, migrations: through52.filter((m) => m.version <= through) });
  databases.push(db);
  return db;
}
const definition: InteractionPatternDefinition = {
  title: "Reflection", purpose: "Consider a check-in", conditions: { all: [{ kind: "presence_present" }] },
  contextSelectors: [], allowedOutcomes: ["silent", "speak"], timing: { minimumGapMinutes: 60, chance: 0.5 },
  lifetime: { startsAt: null, expiresAt: null },
};
const operator = { kind: "operator", operatorId: "owner" } as const;
function accepted(db: Database) {
  const service = createInteractionPatternService({ db });
  const candidate = service.propose({ characterId: "taki", commandId: "propose", patternId: null, expectedVersion: 0, definition }, operator);
  if (candidate.status === "refused") throw new Error(candidate.reason);
  const result = service.confirm({ characterId: "taki", patternId: candidate.pattern.patternId, commandId: "accept",
    expectedVersion: candidate.pattern.version, candidateRevisionId: candidate.pattern.candidateRevision!.revisionId }, operator);
  if (result.status === "refused") throw new Error(result.reason);
  return result.pattern;
}

describe("Pattern migration 052", () => {
  it("upgrades recorded 051 without rewriting receipts/Timeline/timezone and preserves active data on reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-pattern-052-")); roots.push(root);
    const path = join(root, "db.sqlite");
    const old = open(path, 51);
    old.exec(`INSERT INTO timeline_messages(id,character_id,role,content,created_at)
      VALUES('retained','taki','assistant','Existing delivery','2026-09-27T00:00:00.000Z')`);
    old.exec("UPDATE user_timezone SET timezone='Asia/Shanghai',revision=4,source='operator'");
    const receipts = old.prepare("SELECT * FROM migrations ORDER BY version").all();
    const timeline = old.prepare("SELECT * FROM timeline_messages").all();
    const timezone = old.prepare("SELECT * FROM user_timezone").all();
    old.close();
    const db = open(path);
    expect(db.prepare("SELECT * FROM migrations WHERE version<=51 ORDER BY version").all()).toEqual(receipts);
    expect(db.prepare("SELECT * FROM timeline_messages").all()).toEqual(timeline);
    expect(db.prepare("SELECT * FROM user_timezone").all()).toEqual(timezone);
    const pattern = accepted(db);
    db.close();
    const reopened = open(path);
    expect(runMigrations(reopened, through52)).toEqual([]);
    expect(createInteractionPatternService({ db: reopened }).listActive("taki")).toEqual([pattern]);
    expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("applies fresh with strict foreign scoped pointers and immutable revisions, reviews and command evidence", () => {
    const db = open();
    const pattern = accepted(db);
    expect(() => db.exec("UPDATE interaction_pattern_revisions SET definition_json='{}'" )).toThrow("immutable Pattern revision");
    expect(() => db.exec("DELETE FROM interaction_pattern_revisions")).toThrow("immutable Pattern revision");
    expect(() => db.exec("UPDATE interaction_pattern_reviews SET accepted_at='other'" )).toThrow("immutable Pattern review");
    expect(() => db.exec("DELETE FROM interaction_pattern_reviews")).toThrow("immutable Pattern review");
    expect(() => db.exec("UPDATE interaction_pattern_commands SET created_at='other'" )).toThrow("immutable Pattern command");
    expect(() => db.exec("DELETE FROM interaction_pattern_commands")).toThrow("immutable Pattern command");
    expect(() => db.exec("UPDATE interaction_patterns SET character_id='foreign'")).toThrow("immutable Pattern identity");
    const other = createInteractionPatternService({ db }).propose({ characterId: "other", commandId: "second", patternId: null, expectedVersion: 0, definition }, operator);
    if (other.status === "refused") throw new Error(other.reason);
    expect(() => db.prepare("UPDATE interaction_patterns SET effective_revision_id=:revision WHERE pattern_id=:pattern")
      .run({ revision: other.pattern.candidateRevision!.revisionId, pattern: other.pattern.patternId })).toThrow("unreviewed effective Pattern revision");
    expect(() => db.prepare("UPDATE interaction_patterns SET candidate_revision_id=:revision WHERE pattern_id=:pattern")
      .run({ revision: other.pattern.candidateRevision!.revisionId, pattern: pattern.patternId })).toThrow("foreign Pattern revision");
  });

  it("rolls schema and receipt back on migration receipt failure", () => {
    const db = open(":memory:", 51);
    db.exec("CREATE TRIGGER refuse_052 BEFORE INSERT ON migrations WHEN NEW.version=52 BEGIN SELECT RAISE(ABORT,'receipt failed'); END");
    expect(() => runMigrations(db, through52)).toThrow("migration 52 failed");
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'interaction_pattern%'").all()).toEqual([]);
    expect(db.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(51);
  });

  it("rolls schema and receipt back when the migration COMMIT fails, then retries cleanly", () => {
    const db = open(":memory:", 51);
    db.exec(`CREATE TABLE test_pattern_migration_parent(id INTEGER PRIMARY KEY);
      CREATE TABLE test_pattern_migration_child(parent INTEGER REFERENCES test_pattern_migration_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER fail_pattern_migration_commit AFTER INSERT ON migrations WHEN NEW.version=52
      BEGIN INSERT INTO test_pattern_migration_child(parent) VALUES(1); END`);
    expect(() => runMigrations(db, through52)).toThrow("migration 52 failed");
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'interaction_pattern%'").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM test_pattern_migration_child").all()).toEqual([]);
    db.exec("DROP TRIGGER fail_pattern_migration_commit");
    expect(runMigrations(db, through52)).toEqual([52]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
