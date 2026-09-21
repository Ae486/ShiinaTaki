import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "./index-list.ts";
import { openDatabase, type Database } from "../sqlite.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function open(migrations = MIGRATIONS): Database {
  const db = openDatabase({ path: ":memory:", migrations }); dbs.push(db); return db;
}

const NEW_TABLES = ["memory_migration_candidates", "memory_migration_block_plans", "memory_migration_source_proofs", "primary_memory_groups", "primary_memory_members"];

describe("migration 049 local onboarding", () => {
  it("applies on a fresh database and on a database at 048 without touching earlier receipts", () => {
    expect(open(MIGRATIONS.slice(0, 49)).prepare("SELECT max(version) AS v FROM migrations").get()?.v).toBe(49);
    const upgraded = open(MIGRATIONS.slice(0, 48));
    upgraded.exec(`INSERT INTO memory_migration_runs (run_id,snapshot_id,epoch_id,phase,status,requested_at,updated_at,lease_fence)
      VALUES ('raw-run','sha256:raw',NULL,'snapshotted','running','2026-08-20T00:00:00.000Z','2026-08-20T00:00:00.000Z',0)`);
    expect(upgraded.prepare("SELECT max(version) AS v FROM migrations").get()?.v).toBe(48);
    upgraded.exec(MIGRATIONS[48]!.sql);
    const tables = upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(NEW_TABLES));
    expect(upgraded.prepare("SELECT status FROM memory_migration_runs WHERE run_id='raw-run'").get()?.status).toBe("running");
    expect(upgraded.prepare("SELECT count(*) AS n FROM memory_migration_candidates").get()?.n).toBe(0);
  });

  it("keeps candidates, plans and proofs bound to registered runs and sources", () => {
    const db = open();
    expect(() => db.prepare("INSERT INTO memory_migration_candidates (run_id,workspace_root,created_at) VALUES ('missing','root','now')").run()).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare(`INSERT INTO memory_migration_source_proofs (run_id,source_id,payload_hash,effects_hash) VALUES ('missing','s','p','e')`).run()).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare(`INSERT INTO primary_memory_groups (group_id,character_id,creator_boot_id,state,finalized_through_seq,created_at)
      VALUES ('g','taki','boot','finalized',NULL,'now')`).run()).toThrow(/CHECK/);
    expect(() => db.prepare(`INSERT INTO primary_memory_groups (group_id,character_id,creator_boot_id,state,finalized_through_seq,created_at)
      VALUES ('g','taki','boot','open',3,'now')`).run()).toThrow(/CHECK/);
  });
});
