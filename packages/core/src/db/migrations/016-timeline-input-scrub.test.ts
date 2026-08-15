import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { timelineMigration001 } from "./001-timeline.ts";
import { timelinePartsMigration004 } from "./004-timeline-parts.ts";
import { timelineInputScrubMigration016 } from "./016-timeline-input-scrub.ts";

const SENTINEL = "SENTINEL-TIMELINE-INPUT-7c31";
const dbs: Database[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function open(path: ":memory:" | string): Database {
  const db = openDatabase({ path, migrations: [] });
  dbs.push(db);
  return db;
}

function seededTimeline(): { db: Database; insert: (parts: unknown) => void } {
  const db = open(":memory:");
  runMigrations(db, [timelineMigration001, timelinePartsMigration004]);
  const insert = (parts: unknown): void => {
    db.prepare(
      "INSERT INTO timeline_messages (id, character_id, role, content, parts, created_at) VALUES (:id, :character, :role, :content, :parts, :created)",
    ).run({
      id: `row-${Math.random().toString(36).slice(2)}`,
      character: "taki",
      role: "tool",
      content: "[tool-call: exec]",
      parts: JSON.stringify(parts),
      created: "2026-08-01T00:00:00.000Z",
    });
  };
  return { db, insert };
}

describe("timelineInputScrubMigration016", () => {
  it("removes persisted tool-call input and leaves every other part shape intact", () => {
    const { db, insert } = seededTimeline();
    insert([
      { type: "tool-call", toolCallId: "a", toolName: "exec", input: { command: SENTINEL } },
      { type: "tool-result", toolCallId: "a", toolName: "exec", output: { type: "json", value: { ok: true } } },
      { type: "text", text: "ordinary text" },
      { type: "image", mediaType: "image/png", ref: "attachments/x.png" },
    ]);
    expect(runMigrations(db, [timelineInputScrubMigration016])).toEqual([16]);

    const rows = db.prepare("SELECT parts FROM timeline_messages WHERE parts IS NOT NULL").all();
    expect(rows).toHaveLength(1);
    const parts = JSON.parse(String(rows[0]!.parts)) as unknown[];
    expect(parts).toEqual([
      { type: "tool-call", toolCallId: "a", toolName: "exec" },
      { type: "tool-result", toolCallId: "a", toolName: "exec", output: { type: "json", value: { ok: true } } },
      { type: "text", text: "ordinary text" },
      { type: "image", mediaType: "image/png", ref: "attachments/x.png" },
    ]);
    expect(JSON.stringify(rows)).not.toContain(SENTINEL);
  });

  it("is applied once and a reopen pass scrubs a newly seeded legacy row exactly the same", () => {
    const { db, insert } = seededTimeline();
    insert([{ type: "tool-call", toolCallId: "b", toolName: "exec", input: { command: SENTINEL } }]);
    expect(runMigrations(db, [timelineInputScrubMigration016])).toEqual([16]);
    expect(runMigrations(db, [timelineInputScrubMigration016])).toEqual([]);
    // Reopen evidence: a second connection scrubbing the same registry state changes nothing.
    const reopen = db;
    insert([{ type: "tool-call", toolCallId: "c", toolName: "exec", input: { command: SENTINEL } }]);
    const before = reopen.prepare("SELECT COUNT(*) AS n FROM timeline_messages").get();
    expect(before).toEqual({ n: 2 });
    reopen.exec(`
      UPDATE timeline_messages
      SET parts = (
        SELECT json_group_array(
          CASE WHEN json_type(value) = 'object' AND json_extract(value, '$.type') = 'tool-call'
            THEN json_remove(value, '$.input') ELSE value END)
        FROM json_each(timeline_messages.parts))
      WHERE parts IS NOT NULL AND json_valid(parts);
    `);
    const rows = reopen.prepare("SELECT parts FROM timeline_messages").all();
    for (const row of rows) expect(String(row.parts)).not.toContain(SENTINEL);
  });

  it("leaves non-JSON parts rows untouched (bounded scrub, no destructive guessing)", () => {
    const { db } = seededTimeline();
    db.prepare(
      "INSERT INTO timeline_messages (id, character_id, role, content, parts, created_at) VALUES ('legacy', 'taki', 'tool', 'x', :parts, '2026-08-01T00:00:00.000Z')",
    ).run({ parts: "not-json{{" });
    runMigrations(db, [timelineInputScrubMigration016]);
    expect(db.prepare("SELECT parts FROM timeline_messages WHERE id = 'legacy'").get()).toMatchObject({
      parts: "not-json{{",
    });
  });

  it("proves the sentinel absent from the SQLite file bytes after the scrub", () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-scrub-e2e-"));
    dirs.push(dir);
    const path = join(dir, "timeline.db");
    const db = open(path);
    runMigrations(db, [timelineMigration001, timelinePartsMigration004]);
    db.prepare(
      "INSERT INTO timeline_messages (id, character_id, role, content, parts, created_at) VALUES ('row', 'taki', 'tool', '[tool-call: exec]', :parts, '2026-08-01T00:00:00.000Z')",
    ).run({
      parts: JSON.stringify([{ type: "tool-call", toolCallId: "a", toolName: "exec", input: { command: SENTINEL } }]),
    });
    db.close();
    expect(readFileSync(path).toString("latin1")).toContain(SENTINEL);

    const reopen = openDatabase({ path, migrations: [] });
    dbs.push(reopen);
    runMigrations(reopen, [timelineInputScrubMigration016]);
    reopen.close();
    expect(readFileSync(path).toString("latin1")).not.toContain(SENTINEL);
  });
});
