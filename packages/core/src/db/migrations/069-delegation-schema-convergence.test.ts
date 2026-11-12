import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations, type Migration } from "../migration-runner.ts";
import { MIGRATIONS } from "./index-list.ts";
import { T4_HISTORICAL_MIGRATIONS } from "./historical-t4.ts";
import { delegationSchemaConvergenceMigration069 } from "./069-delegation-schema-convergence.ts";
import { delegationAnchors069, delegationContextSchema069, delegationFrontierSchema069 } from "./069-delegation-schema.ts";
import { subagentFixture } from "../../testing/subagent-fixture.ts";
import { scriptedModel } from "../../testing/mock-language-model.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { createRecoveryCoordinator } from "../../harness/recovery-coordinator.ts";
import { createSubagentService } from "../../harness/subagent-service.ts";

const through069 = T4_HISTORICAL_MIGRATIONS.filter(({ version }) => version <= 69);

const databases: Database[] = [];
const directories: string[] = [];
const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
const restartedServices: ReturnType<typeof createSubagentService>[] = [];
afterEach(async () => {
  for (const service of restartedServices.splice(0)) await service.close();
  for (const f of fixtures.splice(0)) await f.close();
  for (const db of databases.splice(0)) db.close();
  for (const dir of directories.splice(0)) {
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith("taki-delegation-069-")) throw new Error("Unsafe fixture path");
    rmTempDir(dir);
  }
});

function historical(context: boolean, frontier: boolean): Migration[] {
  return T4_HISTORICAL_MIGRATIONS.filter(({ version }) => version <= 68).map((migration) => {
    if (migration.version === 58 && !context) {
      const start = migration.sql.indexOf("CREATE TABLE subagent_speech_publications");
      const end = migration.sql.indexOf("INSERT INTO subagent_events(");
      if (start < 0 || end <= start) throw new Error("Historical 058 fixture boundary changed");
      return { ...migration, sql: migration.sql.slice(0, start) + migration.sql.slice(end) };
    }
    if (migration.version === 60 && !frontier) {
      const start = migration.sql.indexOf("CREATE TABLE subagent_event_frontiers");
      if (start < 0) throw new Error("Historical 060 fixture boundary changed");
      return { ...migration, sql: migration.sql.slice(0, start) };
    }
    return migration;
  });
}

function open(migrations: Migration[], path = ":memory:") {
  const db = openDatabase({ path, migrations }); databases.push(db); return db;
}
function path() {
  const dir = mkdtempSync(join(tmpdir(), "taki-delegation-069-")); directories.push(dir); return join(dir, "state.db");
}
function snapshot(db: Database) {
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all();
  const data = Object.fromEntries(schema.filter((row) => row.type === "table").map((row) => {
    const name = String(row.name); return [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()];
  }));
  return { schema, data };
}
function expectPreserved(db: Database, before: ReturnType<typeof snapshot>) {
  const after = snapshot(db);
  expect(after.schema.filter((row) => before.schema.some((old) => old.name === row.name))).toEqual(before.schema);
  for (const [table, rows] of Object.entries(before.data)) {
    expect(table === "migrations" ? after.data[table]!.filter((row) => Number(row.version) < 69) : after.data[table]).toEqual(rows);
  }
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
}

describe("069 exact early/current delegation convergence", () => {
  it.each([[false, false], [false, true], [true, false], [true, true]])("preserves applied history for context=%s frontier=%s and reopens idempotently", (context, frontier) => {
    const file = path();
    const db = open(historical(context!, frontier!), file);
    db.exec("INSERT INTO timeline_messages(id,character_id,role,content,created_at) VALUES('kept','taki','user','Exact old evidence','2026-11-01T00:00:00Z')");
    const before = snapshot(db);
    // The max-version runner cannot repair missing objects by reopening its old 068 registry.
    expect(runMigrations(db, historical(context!, frontier!))).toEqual([]);
    if (!context) expect(() => db.prepare("SELECT * FROM subagent_context_summaries")).toThrow("no such table");
    expect(runMigrations(db, [delegationSchemaConvergenceMigration069])).toEqual([69]);
    expectPreserved(db, before);
    const canonical = open(historical(true, true));
    expect(snapshot(db).schema).toEqual(snapshot(canonical).schema);
    const completed = snapshot(db); db.close();
    const reopened = open(through069, file);
    expect(snapshot(reopened)).toEqual(completed);
    expect(runMigrations(reopened, through069)).toEqual([]);
  });

  it("opens early 058 through current 060 before the forward repair", () => {
    const versions = historical(false, true);
    const db = open(versions.filter(({ version }) => version < 60));
    expect(runMigrations(db, versions)).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 68]);
    expect(() => db.prepare("SELECT * FROM subagent_context_summaries")).toThrow("no such table");
    expect(db.prepare("SELECT * FROM subagent_event_frontiers").all()).toEqual([]);
    expect(runMigrations(db, [delegationSchemaConvergenceMigration069])).toEqual([69]);
    expect(db.prepare("SELECT * FROM subagent_context_summaries").all()).toEqual([]);
  });

  it("keeps frozen definitions equal to the canonical full 068 schema", () => {
    const db = open(historical(true, true));
    for (const object of [...delegationAnchors069, ...delegationContextSchema069, ...delegationFrontierSchema069]) {
      expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name=:name AND type=:type").get({ name: object.name, type: object.type })?.sql)
        .toBe(object.sql.slice(0, -1));
    }
    const fresh = open(through069);
    expect(fresh.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(69);
  });

  it.each([
    ["partial context group", "DROP TRIGGER subagent_summary_immutable"],
    ["partial frontier group", "DROP TRIGGER subagent_event_frontier_immutable"],
    ["unknown anchor index", "CREATE INDEX unknown_input_index ON subagent_inputs(direction_text)"],
    ["unknown anchor trigger", "CREATE TRIGGER unknown_event_trigger AFTER INSERT ON subagent_events BEGIN SELECT 1; END"],
    ["changed frontier constraint", "DROP TABLE subagent_event_frontiers; CREATE TABLE subagent_event_frontiers(event_id TEXT PRIMARY KEY REFERENCES subagent_events(event_id),through_work_seq INTEGER CHECK(through_work_seq>=0)) STRICT; CREATE TRIGGER subagent_event_frontier_immutable BEFORE UPDATE ON subagent_event_frontiers BEGIN SELECT RAISE(ABORT,'SUBAGENT_EVENT_FRONTIER_IMMUTABLE'); END"],
  ])("refuses %s without schema, row or receipt changes", (_name, sql) => {
    const db = open(historical(true, true)); db.exec(sql!);
    const before = snapshot(db);
    expect(() => runMigrations(db, [delegationSchemaConvergenceMigration069])).toThrow("migration 69 failed");
    expect(snapshot(db)).toEqual(before);
  });

  it("refuses one prematurely added member of an otherwise missing group", () => {
    const db = open(historical(false, false)); db.exec(delegationContextSchema069[0]!.sql);
    const before = snapshot(db);
    expect(() => runMigrations(db, [delegationSchemaConvergenceMigration069])).toThrow("migration 69 failed");
    expect(snapshot(db)).toEqual(before);
  });

  it.each(["SQL", "receipt", "COMMIT"])("rolls back every addition after %s failure and remains usable", (failure) => {
    const file = path(); const db = open(historical(false, false), file);
    let migration = delegationSchemaConvergenceMigration069;
    if (failure === "SQL") migration = { ...migration, sql: "NOT SQL" };
    if (failure === "receipt") db.exec("CREATE TRIGGER refuse_069 BEFORE INSERT ON migrations WHEN NEW.version=69 BEGIN SELECT RAISE(ABORT,'refused'); END");
    if (failure === "COMMIT") {
      db.exec("CREATE TABLE late_parent(id INTEGER PRIMARY KEY); CREATE TABLE late_child(parent_id INTEGER REFERENCES late_parent(id) DEFERRABLE INITIALLY DEFERRED)");
      migration = { ...migration, sql: "INSERT INTO late_child VALUES(1)" };
    }
    const before = snapshot(db);
    expect(() => runMigrations(db, [migration])).toThrow("migration 69 failed");
    expect(snapshot(db)).toEqual(before); db.close();
    const reopened = open([], file); expect(snapshot(reopened)).toEqual(before);
    if (failure === "receipt") reopened.exec("DROP TRIGGER refuse_069");
    expect(runMigrations(reopened, [delegationSchemaConvergenceMigration069])).toEqual([69]);
    expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

async function orphan(f: Awaited<ReturnType<typeof subagentFixture>>, label: string) {
  const child = f.children.create({ characterId: "taki", createdByRunId: f.parent.run.runId, label, initialContext: { kind: "fresh" } });
  const work = f.inputs.accept({ subagentId: child.subagentId, operationKey: label, sender: { kind: "parent", runId: f.parent.run.runId },
    direction: "Preserved unfinished task", materials: [], input: { kind: "work", completionPolicy: "record_only" } }).input;
  f.db.prepare("INSERT INTO subagent_work_routes(work_input_id,parent_run_id,route_kind,parent_tools_json) VALUES(:work,:parent,'generic','[]')")
    .run({ work: work.inputId, parent: f.parent.run.runId });
  const run = await f.runs.admitLinked({ triggerRequestId: randomUUID(), idempotencyKey: randomUUID(), characterId: "taki",
    initiator: "subagent", deliveryClass: "internal", contextMode: "autonomous", provenance: { provider: "core.subagent", parentRunId: f.parent.run.runId },
    payloadRef: work.inputId }, { linked: { kind: "subagent", triggerInputId: work.inputId,
      token: { subagentId: child.subagentId, workInputId: work.inputId, throughWorkSeq: 1, controlVersion: 0 }, validateTx() {} } });
  f.runs.start(run.run.runId, run.attempt.attemptId);
  return { child, work, run };
}

function runtimeTables(db: Database) {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
    .map(({ name }) => String(name)).filter((name) => /^(?:runs$|run_|subagent_|timeline_messages$)/.test(name));
}

function runtimeHistory(source: Database, context: boolean) {
  const file = path();
  const db = open(historical(context, false), file);
  const tables = runtimeTables(db);
  const triggers = db.prepare("SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all()
    .filter((trigger) => tables.includes(String(trigger.tbl_name)));
  // Copy actual synthetic producer receipts using only columns declared in the historical schema.
  // Current repositories are composed against the file only after all canonical convergence groups finish.
  db.transaction(() => {
    db.exec("PRAGMA defer_foreign_keys=ON");
    // A stopped-copy restore must retain source ordering, not emit new order rows while importing its evidence.
    for (const trigger of triggers) db.exec(`DROP TRIGGER "${String(trigger.name).replaceAll('"', '""')}"`);
    for (const table of tables) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => String(name));
      const selected = columns.join(",");
      const statement = db.prepare(`INSERT INTO ${table}(${selected}) VALUES(${columns.map((column) => `:${column}`).join(",")})`);
      for (const row of source.prepare(`SELECT ${selected} FROM ${table}`).all()) statement.run(row);
    }
    for (const trigger of triggers) db.exec(String(trigger.sql));
  });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  return { db, file };
}

function upgradeRuntimeHistory(db: Database) {
  const before = snapshot(db);
  expect(runMigrations(db, MIGRATIONS)).toEqual([73, 74, 75, 76, 77]);
  expect(db.prepare("SELECT * FROM migrations WHERE version<=68 ORDER BY version").all()).toEqual(before.data.migrations);
  expect(db.prepare("SELECT version FROM migrations WHERE version=69").get()).toBeUndefined();
  for (const table of runtimeTables(db)) {
    const rows = before.data[table];
    if (!rows) continue;
    const columns = Object.keys(rows[0] ?? {});
    expect(db.prepare(`SELECT ${columns.length ? columns.join(",") : "*"} FROM ${table}`).all()).toEqual(rows);
  }
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
}

it("075 preserves the 069 exact terminal and interaction backfill for genuine early T4 history, leaving unproved keys unknown", async () => {
  const f = await subagentFixture(scriptedModel([])); fixtures.push(f);
  const { child, work, run } = await orphan(f, "frontier");
  const consume = (inputIds: string[], stepNumber: number) => {
    const token = { ...f.executions.token(run.run.runId), throughWorkSeq: f.inputs.latestWorkSeq(work.inputId) };
    const effect = f.effects.prepare({ runId: run.run.runId, attemptId: run.attempt.attemptId, kind: "model", replayPosture: "never",
      sourceRef: { type: "model", provider: "fixture", modelId: "fixture" }, inputDigest: "a".repeat(64),
      onCommitIntent: (effect) => f.messages.recordModelInputs({ effect, token, stepNumber, inputIds }) });
    f.effects.settle({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId, expectedVersion: effect.version, outcome: "completed" });
  };
  consume([work.inputId], 0);
  const next = f.inputs.accept({ subagentId: child.subagentId, operationKey: "later", sender: { kind: "user" }, direction: "Later correction", materials: [],
    input: { kind: "message", workInputId: work.inputId, expectedControlVersion: f.children.get(child.subagentId).controlVersion } }).input;
  consume([next.inputId], 5);
  f.runRepo.settle({ runId: run.run.runId, attemptId: run.attempt.attemptId, outcome: "cancelled", retryability: "not_retryable" });
  for (const key of ["interaction:0:call", "interaction:4:call", "interaction:5:call", "interaction:x:call", "interaction:01:call", "interaction:5:", "checkin:0", "unknown"]) {
    f.db.prepare(`INSERT INTO subagent_events(event_id,character_id,subagent_id,work_input_id,kind,producer_run_id,producer_attempt_id,producer_key,
      body,body_digest,source_context_json,eligible,suppression_reason,accepted_at) VALUES(:key,'taki',:child,:work,'message',:run,:attempt,:key,NULL,'digest','{}',0,'record_only','2026-11-06T00:00:00Z')`)
      .run({ key, child: child.subagentId, work: work.inputId, run: run.run.runId, attempt: run.attempt.attemptId });
  }
  f.db.prepare(`INSERT INTO subagent_events(event_id,character_id,subagent_id,work_input_id,kind,producer_run_id,producer_attempt_id,producer_key,
    body,body_digest,source_context_json,eligible,suppression_reason,accepted_at)
    SELECT 'wrong-attempt-terminal',character_id,subagent_id,work_input_id,kind,producer_run_id,:attempt,producer_key,
    body,body_digest,source_context_json,eligible,suppression_reason,accepted_at FROM subagent_events WHERE producer_key='terminal'`)
    .run({ attempt: f.parent.attempt.attemptId });
  f.db.prepare(`INSERT INTO subagent_context_summaries(work_input_id,revision,subagent_id,source_from_seq,through_seq,source_digest,summary_text,run_id,attempt_id,created_at)
    VALUES(:work,1,:child,1,1,'retained-digest','Retained prior summary',:run,:attempt,'2026-11-01T00:00:00Z')`)
    .run({ work: work.inputId, child: child.subagentId, run: run.run.runId, attempt: run.attempt.attemptId });
  f.db.prepare("INSERT INTO subagent_tool_results(run_id,attempt_id,step_number,tool_call_id,tool_name,output_json,materials_json) VALUES(:run,:attempt,0,'retained','read_file','{\"evidence\":\"exact retained bytes\"}','[]')")
    .run({ run: run.run.runId, attempt: run.attempt.attemptId });
  const { db, file } = runtimeHistory(f.db, true);
  expect(() => db.prepare("SELECT * FROM subagent_event_frontiers")).toThrow("no such table");
  upgradeRuntimeHistory(db);
  const frontiers = Object.fromEntries(db.prepare("SELECT event_id,through_work_seq FROM subagent_event_frontiers").all().map((row) => [String(row.event_id), row.through_work_seq]));
  expect(frontiers).toMatchObject({ "interaction:0:call": 1, "interaction:4:call": 1, "interaction:5:call": 2,
    "interaction:x:call": null, "interaction:01:call": null, "interaction:5:": null, "checkin:0": null, unknown: null, "wrong-attempt-terminal": null });
  const terminal = db.prepare("SELECT event_id FROM subagent_events WHERE producer_key='terminal' AND producer_attempt_id=:attempt").get({ attempt: run.attempt.attemptId })!;
  expect(frontiers[String(terminal.event_id)]).toBe(2);
  expect(() => db.exec("UPDATE subagent_event_frontiers SET through_work_seq=99")).toThrow("SUBAGENT_EVENT_FRONTIER_IMMUTABLE");
  const completed = snapshot(db); db.close();
  const reopened = open(MIGRATIONS, file);
  expect(runMigrations(reopened, MIGRATIONS)).toEqual([]);
  expect(snapshot(reopened)).toEqual(completed);
});

it("repairs the old schema before zero-dispatch recovery, preserves user Stop/unknown primary intents, then supports explicit Continue and new work", async () => {
  const model = scriptedModel(Array.from({ length: 2 }, (_, index) => ({ kind: "tool" as const, toolCallId: `done-${index}`,
    toolName: "complete_subagent", input: { text: "Explicit work completed", materials: [] } })));
  const source = await subagentFixture(model); fixtures.push(source);
  const children = [await orphan(source, "stopped-a"), await orphan(source, "stopped-b")];
  for (const { child, work, run } of children) source.children.stop({ origin: "user", target: { subagentId: child.subagentId,
    workInputId: work.inputId, expectedControlVersion: source.children.get(child.subagentId).controlVersion, expectedRunId: run.run.runId },
    cancelRunTx: (id) => { source.runRepo.cancel(id, "User stop before process loss"); } });
  const primaryEffect = source.effects.prepare({ runId: source.parent.run.runId, attemptId: source.parent.attempt.attemptId,
    kind: "model", replayPosture: "never", sourceRef: { type: "model", provider: "fixture", modelId: "fixture" } });
  const { db, file } = runtimeHistory(source.db, false);
  expect(() => db.prepare("SELECT * FROM subagent_context_summary_intents")).toThrow("no such table");
  expect(model.doStreamCalls).toHaveLength(0);
  upgradeRuntimeHistory(db);
  const completed = snapshot(db); db.close();
  const reopened = open(MIGRATIONS, file); expect(snapshot(reopened)).toEqual(completed); reopened.close();
  const f = await subagentFixture(model, { dbPath: file }); fixtures.push(f);
  const coordinator = () => createRecoveryCoordinator({ db: f.db, runs: f.runRepo, effects: f.effects });
  expect(model.doStreamCalls).toHaveLength(0);
  await coordinator().scan();
  expect(model.doStreamCalls).toHaveLength(0);
  for (const { child, run } of children) {
    expect(f.children.get(child.subagentId)).toMatchObject({ stopOrigin: "user", activeRunId: null });
    expect(f.executions.result(run.run.runId)?.child).toMatchObject({ outcome: "cancelled", outputKind: "none" });
    expect(f.effects.list?.(run.run.runId)).toEqual([]);
  }
  expect(f.effects.get(primaryEffect.effectId)).toMatchObject({ state: "intent_committed", outcome: undefined });
  expect(f.runs.status(source.parent.run.runId).run.state).toBe("recovering");
  expect(f.db.prepare("SELECT event_id FROM subagent_events WHERE eligible=1").all()).toEqual([]);
  await coordinator().scan();
  expect(model.doStreamCalls).toHaveLength(0);
  expect(f.db.prepare("SELECT count(*) AS n FROM subagent_executions WHERE settled_at IS NOT NULL").get()?.n).toBe(2);
  await f.service.close();
  const restarted = createSubagentService(f.service.state.deps); restartedServices.push(restarted);
  const first = children[0]!;
  const target = { subagentId: first.child.subagentId, workInputId: first.work.inputId,
    expectedControlVersion: f.children.get(first.child.subagentId).controlVersion, expectedRunId: null };
  expect(() => restarted.continue({ characterId: "taki", target, operationKey: "parent-refused", direction: "Continue", materials: [] },
    { kind: "parent", runId: f.parent.run.runId })).toThrow("USER_CONTINUE_REQUIRED");
  restarted.continue({ characterId: "taki", target, operationKey: "user-continue", direction: "Continue", materials: [] }, { kind: "user" });
  await vi.waitFor(() => expect(f.executions.list({ subagentId: first.child.subagentId }).filter((row) => row.result)).toHaveLength(2));
  expect(f.children.get(first.child.subagentId).stopOrigin).toBeNull();
  expect(f.executions.result(first.run.run.runId)?.child).toMatchObject({ outcome: "cancelled" });
  const freshParent = await f.runs.admit({ triggerRequestId: randomUUID(), idempotencyKey: randomUUID(), characterId: "taki",
    initiator: "primary", deliveryClass: "class_a", contextMode: "primary", provenance: { provider: "chat" } });
  f.runs.start(freshParent.run.runId, freshParent.attempt.attemptId);
  const fresh = await restarted.delegate({ parentRunId: freshParent.run.runId, parentToolNames: [] }, { characterId: "taki", operationKey: "new-work",
    label: "New work", direction: "Finish the new task", initialContext: { kind: "fresh" }, materials: [], completionPolicy: "record_only" });
  await vi.waitFor(() => expect(f.executions.list({ subagentId: fresh.conversation.subagentId })[0]?.result).toMatchObject({ outcome: "completed", outputKind: "validated" }));
  const freshView = restarted.summary(fresh.conversation.subagentId);
  restarted.stop({ characterId: "taki", target: { subagentId: freshView.subagentId, workInputId: fresh.input!.inputId,
    expectedControlVersion: freshView.controlVersion, expectedRunId: null } }, "user");
  expect(f.children.get(freshView.subagentId).stopOrigin).toBe("user");
  expect(model.doStreamCalls).toHaveLength(2);
  expect(f.effects.get(primaryEffect.effectId)).toMatchObject({ state: "intent_committed" });
  expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
}, 15_000);
