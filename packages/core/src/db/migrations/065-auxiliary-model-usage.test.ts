import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { MIGRATIONS } from "./index-list.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

function open(path: string, migrations = MIGRATIONS): Database {
  const db = openDatabase({ path, migrations }); cleanup.push(() => db.close()); return db;
}

it("reopens migration 064 data without modifying existing values or receipts", () => {
  const root = mkdtempSync(join(tmpdir(), "taki-migration-065-")); cleanup.push(() => rmTempDir(root));
  const path = join(root, "state.db");
  const old = open(path, MIGRATIONS.filter(({ version }) => version < 65));
  const bytes = '{ "preserve": [1, 2], "nested": {"value": true} }\r\n';
  old.prepare("INSERT INTO config (key,value,updated_at) VALUES ('preserved',:bytes,:at)")
    .run({ bytes, at: "2026-10-31T00:00:00.000Z" });
  const receipts = old.prepare("SELECT * FROM migrations ORDER BY version").all(); old.close();

  const upgraded = open(path);
  expect(upgraded.prepare("SELECT * FROM config WHERE key='preserved'").get()?.value).toBe(bytes);
  expect(upgraded.prepare("SELECT * FROM migrations WHERE version<65 ORDER BY version").all()).toEqual(receipts);
  expect(upgraded.prepare("SELECT * FROM auxiliary_model_calls").all()).toEqual([]);
  expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  upgraded.close();

  const reopened = open(path);
  expect(reopened.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(69);
  expect(reopened.prepare("SELECT * FROM auxiliary_model_calls").all()).toEqual([]);
});

it("rejects negative or unsafe persisted usage counters", () => {
  const db = open(":memory:");
  const sql = `INSERT INTO auxiliary_model_calls
    (call_id,source,label,provider,model_id,started_at,updated_at,status,total_tokens)
    VALUES (:callId,'utility','label','provider','model',:at,:at,'completed',:tokens)`;
  const statement = db.prepare(sql); const at = "2026-11-01T00:00:00.000Z";
  expect(() => statement.run({ callId: "negative", at, tokens: -1 })).toThrow();
  expect(() => statement.run({ callId: "unsafe", at, tokens: BigInt(Number.MAX_SAFE_INTEGER) + 1n })).toThrow();
  statement.run({ callId: "zero", at, tokens: 0 });
  expect(db.prepare("SELECT total_tokens FROM auxiliary_model_calls WHERE call_id='zero'").get()?.total_tokens).toBe(0);
});
