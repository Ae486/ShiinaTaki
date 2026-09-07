import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type Database } from "../sqlite.ts";
import { createTimelineRepo } from "../timeline-repo.ts";
import { MIGRATIONS } from "./index-list.ts";

const databases: Database[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("taki-live-migration-")) throw new Error("unsafe fixture path");
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Timeline presentation migration 035", () => {
  it("upgrades 034 additively, preserves canonical bytes, and reopens without applying again", () => {
    const directory = mkdtempSync(join(tmpdir(), "taki-live-migration-")); directories.push(directory);
    const path = join(directory, "fixture.db");
    const old = openDatabase({ path, migrations: MIGRATIONS.filter((migration) => migration.version <= 34) });
    old.exec(`INSERT INTO timeline_messages (id,character_id,role,content,parts,created_at)
      VALUES ('550e8400-e29b-41d4-a716-446655440000','taki','assistant','canonical',NULL,'2026-09-07T00:00:00.000Z')`);
    const canonical = old.prepare("SELECT seq,id,character_id,role,content,parts,created_at FROM timeline_messages").all();
    old.close();
    const applied: number[][] = [];
    const upgraded = openDatabase({ path, migrations: MIGRATIONS, onMigrated: (versions) => applied.push(versions) });
    expect(applied).toEqual([[35]]);
    expect(upgraded.prepare("SELECT seq,id,character_id,role,content,parts,created_at FROM timeline_messages").all()).toEqual(canonical);
    expect(upgraded.prepare("SELECT presentation FROM timeline_messages").get()?.presentation).toBeNull();
    createTimelineRepo(upgraded).append({ characterId: "taki", role: "assistant", content: "new", presentation: {
      schemaVersion: "timeline-presentation.v1", messageId: "message", entryIndex: 0, entryCount: 1, activitySeq: 2,
      references: [{ kind: "text", itemId: "segment", order: 0, start: 0, end: 3 }],
    } });
    upgraded.close();
    const reopened = openDatabase({ path, migrations: MIGRATIONS, onMigrated: (versions) => applied.push(versions) }); databases.push(reopened);
    expect(applied).toEqual([[35], []]);
    expect(createTimelineRepo(reopened).latestAscending("taki", 10).at(-1)).toMatchObject({ content: "new", presentation: { messageId: "message" } });
    expect(reopened.prepare("SELECT mode,active_epoch_id FROM memory_authority_selection").get()).toEqual({ mode: "legacy-markdown", active_epoch_id: null });
  });
});
