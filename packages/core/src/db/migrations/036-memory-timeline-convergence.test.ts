import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations, type Migration } from "../migration-runner.ts";
import { openDatabase, type Database, type SqlRow } from "../sqlite.ts";
import { MIGRATIONS } from "./index-list.ts";
import { memoryTimelineConvergenceMigration036 } from "./036-memory-timeline-convergence.ts";

const through034 = MIGRATIONS.filter((migration) => migration.version <= 34);
const main035 = MIGRATIONS.filter((migration) => migration.version <= 35);
// Pinned T4 commit 82e0a4a applied this SQL as 035; the main 035 export must not stand in for that history.
const t4Presentation035: Migration = {
  version: 35,
  sql: "ALTER TABLE timeline_messages ADD COLUMN presentation TEXT;",
};
const t4035 = [...through034, t4Presentation035];
const converged = [...main035, memoryTimelineConvergenceMigration036];
const dbs: Database[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    const resolved = resolve(root);
    if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith("taki-migration-036-")) {
      throw new Error("unsafe migration fixture path");
    }
    rmSync(resolved, { recursive: true, force: true });
  }
});

function filePath(): string {
  const root = mkdtempSync(join(tmpdir(), "taki-migration-036-"));
  roots.push(root);
  return join(root, "taki.db");
}

function open(path: string, migrations: Migration[], onMigrated?: (versions: number[]) => void): Database {
  const db = openDatabase({ path, migrations, onMigrated });
  dbs.push(db);
  return db;
}

function hasTable(db: Database, name: string): boolean {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=:name").get({ name }) !== undefined;
}

function hasPresentation(db: Database): boolean {
  return db.prepare("PRAGMA table_info(timeline_messages)").all().some((column) => column.name === "presentation");
}

function seedTimeline(db: Database): void {
  const insert = db.prepare(`INSERT INTO timeline_messages
    (seq,id,character_id,role,content,parts,created_at) VALUES (:seq,:id,'taki',:role,:content,:parts,:at)`);
  const at = "2026-08-30T01:02:03.456Z";
  insert.run({ seq: 7, id: "old-user", role: "user", content: "Original user text.\r\n", parts: null, at });
  insert.run({ seq: 19, id: "old-tool", role: "tool", content: "Original tool projection.",
    parts: '[ { "type": "text", "text": "café 🐈" } ]\r\n', at });
  insert.run({ seq: 28, id: "old-assistant", role: "assistant", content: "Original reply.", parts: "[]", at });
  // A deleted high row proves the bridge preserves the AUTOINCREMENT watermark, not just surviving row IDs.
  insert.run({ seq: 90, id: "deleted-tail", role: "assistant", content: "Deleted fixture row.", parts: null, at });
  db.prepare("DELETE FROM timeline_messages WHERE id='deleted-tail'").run();
  if (hasPresentation(db)) {
    db.prepare("UPDATE timeline_messages SET presentation=:presentation WHERE id='old-tool'")
      .run({ presentation: '{ "kind": "avatar", "value": "wave 🐈" }\r\n' });
    db.prepare("UPDATE timeline_messages SET presentation='' WHERE id='old-assistant'").run();
  }
}

function seedEpoch(db: Database): void {
  db.exec(`INSERT INTO canonical_memory_authority_epochs
    (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
    VALUES ('old-epoch','local','local-lineage','active',NULL,'2026-08-30T00:00:00.000Z',NULL,'initial-local')`);
}

function insertPending(db: Database, overrides: SqlRow = {}): number {
  // Historical state is opaque here: its original whitespace and typed wire witnesses must survive the bridge.
  const state = '{\n  "requestHash": "' + "b".repeat(64) + '",\n  "fields": { "number": 1, "string": "1", "null": null, "empty": "" }\n}\r\n';
  return db.prepare(`INSERT INTO pending_memory
    (sequence,authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash,phase,version,state_json)
    VALUES (:sequence,:authority_epoch_id,:bank_id,:operation_id,:operation_kind,:intent_hash,:phase,:version,:state_json)`)
    .run({ sequence: null, authority_epoch_id: "old-epoch", bank_id: "old-bank", operation_id: "old-operation",
      operation_kind: "retain", intent_hash: "a".repeat(64), phase: "outcome_unknown", version: 3, state_json: state,
      ...overrides }).lastInsertRowid;
}

function seedPending(db: Database): void {
  seedEpoch(db);
  insertPending(db, { sequence: 41 });
  insertPending(db, { sequence: 120, operation_id: "deleted-operation" });
  db.prepare("DELETE FROM pending_memory WHERE operation_id='deleted-operation'").run();
}

function snapshot(db: Database) {
  const timeline = hasTable(db, "timeline_messages")
    ? db.prepare("SELECT * FROM timeline_messages ORDER BY seq").all() : [];
  return {
    receipts: db.prepare("SELECT * FROM migrations ORDER BY version").all(),
    timeline,
    presentationBytes: hasPresentation(db)
      ? db.prepare("SELECT seq,hex(CAST(presentation AS BLOB)) AS bytes FROM timeline_messages ORDER BY seq").all() : null,
    pending: hasTable(db, "pending_memory")
      ? db.prepare("SELECT *,hex(CAST(state_json AS BLOB)) AS state_bytes FROM pending_memory ORDER BY sequence").all() : [],
    sequences: hasTable(db, "sqlite_sequence")
      ? db.prepare("SELECT name,seq FROM sqlite_sequence WHERE name IN ('timeline_messages','pending_memory') ORDER BY name").all() : [],
  };
}

function expectUnion(db: Database): void {
  expect(db.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(36);
  expect(db.prepare("PRAGMA table_xinfo(timeline_messages)").all().find((column) => column.name === "presentation"))
    .toMatchObject({ type: "TEXT", notnull: 0, dflt_value: null, pk: 0, hidden: 0 });
  expect(db.prepare("SELECT name,type FROM sqlite_schema WHERE name LIKE 'pending_memory%' ORDER BY name").all())
    .toEqual([
      { name: "pending_memory", type: "table" },
      { name: "pending_memory_identity_immutable", type: "trigger" },
      { name: "pending_memory_recovery", type: "index" },
    ]);
}

function expectPreserved(db: Database, before: ReturnType<typeof snapshot>): void {
  const after = snapshot(db);
  const historicalVersions = new Set(before.receipts.map((row) => row.version));
  expect(after.receipts.filter((row) => historicalVersions.has(row.version))).toEqual(before.receipts);
  expect(after.timeline).toEqual(before.timeline.map((row) => ({ ...row, presentation: row.presentation ?? null })));
  if (before.presentationBytes) expect(after.presentationBytes).toEqual(before.presentationBytes);
  expect(after.pending).toEqual(before.pending);
  // A new empty table may introduce a sequence row; every existing watermark must remain exact.
  for (const sequence of before.sequences) expect(after.sequences).toContainEqual(sequence);
}

describe("036 real-file applied-035 convergence", () => {
  const lineages = [
    { name: "fresh", history: [], expected: Array.from({ length: 36 }, (_, index) => index + 1), both: false },
    { name: "034", history: through034, expected: [35, 36], both: false },
    { name: "main 035 with Pending data", history: main035, expected: [36], both: false },
    { name: "T4 035 with presentation data", history: t4035, expected: [36], both: false },
    { name: "both schemas already present at max 035", history: main035, expected: [36], both: true },
  ];

  it.each(lineages)("preserves $name, then applies nothing on the second reopen", ({ history, expected, both }) => {
    const path = filePath();
    const first = open(path, history);
    if (both) first.exec(t4Presentation035.sql);
    if (hasTable(first, "timeline_messages")) seedTimeline(first);
    if (hasTable(first, "pending_memory")) seedPending(first);
    first.exec("UPDATE migrations SET applied_at=printf('2026-01-01T00:00:%02d.000Z',version)");
    const before = snapshot(first);
    first.close();

    const applied: number[][] = [];
    const upgraded = open(path, converged, (versions) => applied.push(versions));
    expect(applied).toEqual([expected]);
    expectUnion(upgraded);
    expectPreserved(upgraded, before);
    if (before.pending.length > 0) {
      expect(insertPending(upgraded, { operation_id: "after-036" })).toBe(121);
    }
    const committed = snapshot(upgraded);
    upgraded.close();

    const secondApplied: number[][] = [];
    const reopened = open(path, converged, (versions) => secondApplied.push(versions));
    expect(secondApplied).toEqual([[]]);
    expect(snapshot(reopened)).toEqual(committed);
    expectUnion(reopened);
  });
});

describe("036 Pending contract", () => {
  function fromT4(): Database {
    const db = open(":memory:", t4035);
    runMigrations(db, [memoryTimelineConvergenceMigration036]);
    seedPending(db);
    return db;
  }

  it("creates the exact historical 035 table, index, and trigger definitions", () => {
    const historical = open(":memory:", main035);
    const upgraded = fromT4();
    const definitions = (db: Database) => db.prepare(`SELECT type,name,sql FROM sqlite_schema
      WHERE tbl_name='pending_memory' ORDER BY type,name`).all().map((row) => ({
      ...row, sql: typeof row.sql === "string" ? row.sql.replaceAll(" IF NOT EXISTS", "") : row.sql,
    }));

    expect(definitions(upgraded)).toEqual(definitions(historical));
    expect(upgraded.prepare("PRAGMA index_info(pending_memory_recovery)").all().map((row) => row.name))
      .toEqual(["authority_epoch_id", "bank_id", "phase", "operation_kind", "sequence"]);
    expect(upgraded.prepare("PRAGMA table_list").all().find((row) => row.name === "pending_memory")?.strict).toBe(1);
  });

  it.each([
    ["missing epoch", { authority_epoch_id: "missing" }],
    ["empty bank", { bank_id: "" }],
    ["long bank", { bank_id: "b".repeat(257) }],
    ["empty operation", { operation_id: "" }],
    ["long operation", { operation_id: "o".repeat(257) }],
    ["unknown operation kind", { operation_kind: "replace" }],
    ["short hash", { intent_hash: "a".repeat(63) }],
    ["uppercase hash", { intent_hash: "A".repeat(64) }],
    ["unknown phase", { phase: "accepted" }],
    ["zero version", { version: 0 }],
    ["non-integer version", { version: "invalid" }],
    ["invalid JSON", { state_json: "invalid" }],
    ["non-object JSON", { state_json: "[]" }],
    ["oversized UTF-8 state", { state_json: JSON.stringify({ text: "é".repeat(1_048_576) }) }],
  ] as [string, SqlRow][])("preserves the %s rejection", (_name, overrides) => {
    const db = fromT4();
    const before = snapshot(db);

    expect(() => insertPending(db, { operation_id: "candidate", ...overrides })).toThrow();

    expect(snapshot(db)).toEqual(before);
  });

  it("preserves unique operation identity, immutable identity fields, and mutable recovery state", () => {
    const db = fromT4();
    expect(() => insertPending(db)).toThrow(/UNIQUE constraint failed/);
    for (const field of ["authority_epoch_id", "bank_id", "operation_id", "operation_kind", "intent_hash"]) {
      expect(() => db.prepare(`UPDATE pending_memory SET ${field}=${field} WHERE sequence=41`).run())
        .toThrow("pending memory identity is immutable");
    }
    db.prepare("UPDATE pending_memory SET phase='submitted',version=4 WHERE sequence=41").run();
    expect(db.prepare("SELECT phase,version FROM pending_memory WHERE sequence=41").get())
      .toEqual({ phase: "submitted", version: 4 });
  });
});

describe("036 atomic failure", () => {
  it.each([
    { name: "main 035", history: main035 },
    { name: "T4 035", history: t4035 },
  ])("rolls back both schemas and the receipt after a late SQL error from $name", ({ history }) => {
    const path = filePath();
    const db = open(path, history);
    seedTimeline(db);
    if (hasTable(db, "pending_memory")) seedPending(db);
    const before = snapshot(db);
    const schema = db.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name").all();
    const broken: Migration = { ...memoryTimelineConvergenceMigration036,
      sql: memoryTimelineConvergenceMigration036.sql + "\nNOT SQL;" };

    expect(() => runMigrations(db, [broken])).toThrowError(/migration 36 failed/);

    expect(snapshot(db)).toEqual(before);
    expect(db.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name").all()).toEqual(schema);
    db.close();
    const reopened = open(path, []);
    expect(snapshot(reopened)).toEqual(before);
    expect(reopened.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name").all()).toEqual(schema);
    expect(runMigrations(reopened, [memoryTimelineConvergenceMigration036])).toEqual([36]);
    expectPreserved(reopened, before);
    expectUnion(reopened);
  });

  it("refuses an incompatible existing presentation without changing Pending or historical receipts", () => {
    const path = filePath();
    const db = open(path, main035);
    db.exec("ALTER TABLE timeline_messages ADD COLUMN presentation INTEGER");
    seedPending(db);
    db.exec(`INSERT INTO timeline_messages (id,character_id,role,content,created_at,presentation)
      VALUES ('incompatible','taki','assistant','Historical row.','2026-08-30T00:00:00.000Z',123)`);
    const before = snapshot(db);

    expect(() => runMigrations(db, [memoryTimelineConvergenceMigration036])).toThrowError(/migration 36 failed/);

    expect(snapshot(db)).toEqual(before);
    db.close();
    const reopened = open(path, []);
    expect(snapshot(reopened)).toEqual(before);
    expect(reopened.prepare("PRAGMA table_info(timeline_messages)").all().find((column) => column.name === "presentation")?.type)
      .toBe("INTEGER");
  });
});
