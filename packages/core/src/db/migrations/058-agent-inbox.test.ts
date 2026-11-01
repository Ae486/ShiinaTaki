import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { MIGRATIONS } from "./index-list.ts";
import { subagentFixture } from "../../testing/subagent-fixture.ts";
import { scriptedModel } from "../../testing/mock-language-model.ts";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
const dbs: Database[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); for (const db of dbs.splice(0)) db.close(); });

async function legacy() {
  const f = await subagentFixture(scriptedModel(Array.from({ length: 3 }, (_, index) => ({ kind: "tool" as const,
    toolCallId: `final-${index}`, toolName: "complete_subagent", input: { text: `Original result ${index}`, materials: [] } }))));
  fixtures.push(f); f.queue.tryAcquireBackground("taki");
  for (let index = 0; index < 3; index++) await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, {
    characterId: "taki", operationKey: `work-${index}`, label: `Child ${index}`, initialContext: { kind: "fresh" },
    direction: `Original immutable input ${index}`, materials: [], completionPolicy: index === 1 ? "record_only" : "request_parent", lifetimeMinutes: 30 });
  await vi.waitFor(() => expect(f.db.prepare("SELECT count(*) AS n FROM subagent_executions WHERE settled_at IS NOT NULL").get()?.n).toBe(3));
  const stopped = f.children.list({ characterId: "taki" }).find((child) => child.label === "Child 2")!;
  const work = f.inputs.list({ subagentId: stopped.subagentId })[0]!;
  f.service.stop({ characterId: "taki", target: { subagentId: stopped.subagentId, workInputId: work.inputId,
    expectedControlVersion: stopped.controlVersion, expectedRunId: null } }, "user");
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS.filter((migration) => migration.version < 58) }); dbs.push(db);
  const tables = ["runs", "run_snapshots", "run_attempts", "run_effects", "run_receipts", "run_events",
    "subagent_conversations", "subagent_inputs", "subagent_executions", "run_messages"];
  db.transaction(() => {
    db.exec("PRAGMA defer_foreign_keys=ON");
    for (const table of tables) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name));
      for (const row of f.db.prepare(`SELECT * FROM ${table}`).all()) {
        const values = Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
        db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map((column) => `:${column}`).join(",")})`).run(values);
      }
    }
  });
  return { db, tables };
}

describe("forward inbox migration with legacy private evidence", () => {
  it("preserves all historical bytes/receipts, removes only generic age authority and bridges only eligible notifications", async () => {
    const { db, tables } = await legacy();
    const before = new Map(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
    const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all();
    expect(runMigrations(db, MIGRATIONS)).toEqual([58, 60, 61, 62, 63, 64, 65, 66]);
    for (const table of tables) {
      const old = before.get(table)!;
      const columns = Object.keys(old[0] ?? {});
      if (columns.length) expect(db.prepare(`SELECT ${columns.join(",")} FROM ${table}`).all()).toEqual(old);
    }
    expect(db.prepare("SELECT * FROM migrations WHERE version<58 ORDER BY version").all()).toEqual(receipts);
    expect(db.prepare("SELECT DISTINCT validity_json FROM subagent_inputs").all()).toEqual([{ validity_json: '{"kind":"until_cancelled"}' }]);
    expect(db.prepare("SELECT event_id FROM subagent_events").all()).toHaveLength(1);
    expect(db.prepare("SELECT * FROM subagent_inbox_consumers").all()).toEqual([]);
    expect(db.prepare("SELECT DISTINCT historical_order FROM subagent_conversation_order").all()).toEqual([{ historical_order: 1 }]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(runMigrations(db, MIGRATIONS)).toEqual([]);
  });

  it.each(["unknown_index", "receipt_failure"] as const)("refuses %s atomically without losing legacy evidence", async (failure) => {
    const { db } = await legacy();
    const before = db.prepare("SELECT * FROM subagent_inputs ORDER BY input_id").all();
    if (failure === "unknown_index") db.exec("CREATE INDEX unknown_private_index ON subagent_inputs(direction_text)");
    else db.exec("CREATE TRIGGER reject_058 BEFORE INSERT ON migrations WHEN NEW.version=58 BEGIN SELECT RAISE(ABORT,'receipt refused'); END;");
    expect(() => runMigrations(db, MIGRATIONS)).toThrow("migration 58 failed");
    expect(db.prepare("SELECT * FROM subagent_inputs ORDER BY input_id").all()).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='subagent_events'").get()).toBeUndefined();
    expect(db.prepare("SELECT version FROM migrations WHERE version>=58").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
