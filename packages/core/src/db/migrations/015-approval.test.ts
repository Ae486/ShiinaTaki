import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { approvalMigration015 } from "./015-approval.ts";

const dbs: Database[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmTempDir(dir);
});

function open(path = ":memory:"): Database {
  const db = openDatabase({ path, migrations: [] });
  dbs.push(db);
  return db;
}

const row = {
  decision_id: "11111111-1111-4111-8111-111111111111",
  binding_revision: 1,
  binding_digest: "a".repeat(64),
  capability_id: "mcp.tool.call",
  owner_host_id: "22222222-2222-4222-8222-222222222222",
  subject_id: "server.tool",
  subject_revision: "config-1",
  descriptor_revision: 1,
  classifier_id: "mcp-tool-call",
  classifier_revision: 1,
  cell_key: "mcp-tool-call",
  decision_scope_digest: "b".repeat(64),
  disclosure_revision: 1,
  provenance: "operator",
  created_at: "2026-08-13T00:00:00.000Z",
  updated_at: "2026-08-13T00:00:00.000Z",
};

describe("approvalMigration015", () => {
  it("creates the generation-1 singleton and privacy-minimal strict tables", () => {
    const db = open();
    runMigrations(db, [approvalMigration015]);
    expect(db.prepare("SELECT approval_generation, governance_registry_revision, disclosure_revision FROM approval_state").get())
      .toEqual({ approval_generation: 1, governance_registry_revision: 1, disclosure_revision: 1 });
    const columns = db.prepare("PRAGMA table_info(approval_decisions)").all().map((item) => item.name);
    expect(columns).toEqual([
      "decision_id", "binding_revision", "binding_digest", "capability_id", "owner_host_id",
      "subject_id", "subject_revision", "descriptor_revision", "classifier_id", "classifier_revision",
      "cell_key", "decision_scope_digest", "disclosure_revision", "provenance", "created_at", "updated_at",
    ]);
    for (const forbidden of ["input", "presentation", "command", "path", "challenge", "socket", "secret", "verdict"]) {
      expect(columns.some((column) => String(column).includes(forbidden))).toBe(false);
    }
  });

  it("enforces subject pairs, provenance, positive revisions, and unique binding digests", () => {
    const db = open();
    runMigrations(db, [approvalMigration015]);
    const insert = db.prepare(`INSERT INTO approval_decisions (
      decision_id,binding_revision,binding_digest,capability_id,owner_host_id,subject_id,subject_revision,
      descriptor_revision,classifier_id,classifier_revision,cell_key,decision_scope_digest,
      disclosure_revision,provenance,created_at,updated_at
    ) VALUES (
      :decision_id,:binding_revision,:binding_digest,:capability_id,:owner_host_id,:subject_id,:subject_revision,
      :descriptor_revision,:classifier_id,:classifier_revision,:cell_key,:decision_scope_digest,
      :disclosure_revision,:provenance,:created_at,:updated_at
    )`);
    insert.run(row);
    expect(() => insert.run({ ...row, decision_id: "33333333-3333-4333-8333-333333333333" })).toThrow();
    expect(() => insert.run({
      ...row, decision_id: "44444444-4444-4444-8444-444444444444",
      binding_digest: "c".repeat(64), subject_revision: null,
    })).toThrow();
    expect(() => insert.run({
      ...row, decision_id: "55555555-5555-4555-8555-555555555555",
      binding_digest: "d".repeat(64), provenance: "imported",
    })).toThrow();
    const invalidDigests = ["A".repeat(64), "a".repeat(63), "a".repeat(65), `${"a".repeat(63)}g`];
    for (const [index, invalid] of invalidDigests.entries()) {
      expect(() => insert.run({
        ...row,
        decision_id: `66666666-6666-4666-8666-66666666666${index}`,
        binding_digest: invalid,
        decision_scope_digest: `${index}`.repeat(64),
      })).toThrow();
      expect(() => insert.run({
        ...row,
        decision_id: `77777777-7777-4777-8777-77777777777${index}`,
        binding_digest: `${index}`.repeat(64),
        decision_scope_digest: invalid,
      })).toThrow();
    }
  });

  it("applies once and survives a real file-backed close/reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-approval-migration-"));
    dirs.push(dir);
    const path = join(dir, "taki.db");
    const first = open(path);
    expect(runMigrations(first, [approvalMigration015])).toEqual([15]);
    first.close();
    const second = open(path);
    expect(runMigrations(second, [approvalMigration015])).toEqual([]);
    expect(second.prepare("SELECT COUNT(*) AS n FROM approval_state").get()).toEqual({ n: 1 });
  });
});
