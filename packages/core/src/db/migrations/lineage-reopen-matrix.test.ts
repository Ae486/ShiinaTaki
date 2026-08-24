import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Migration } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { MIGRATIONS } from "./index-list.ts";
import { mcpDesiredServersMigration018 } from "./018-mcp-desired-servers.ts";
import { skillPackagesMigration019 } from "./019-skill-packages.ts";
import { parallelFoundationConvergenceMigration020 } from "./020-parallel-foundation-convergence.ts";
import { memoryLegacyMigration021 } from "./021-memory-legacy-migration.ts";
import { hindsightConnectionSetupMigration022 } from "./022-hindsight-connection-setup.ts";
import { hindsightInitialCutoverMigration023 } from "./023-hindsight-initial-cutover.ts";
import { harnessRunsMigration024 } from "./024-harness-runs.ts";
import { runEventsMigration025 } from "./025-run-events.ts";

const roots: string[] = [];
const dbs: Database[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createPath(): string {
  const root = mkdtempSync(join(tmpdir(), "taki-migration-lineage-"));
  roots.push(root);
  return join(root, "taki.db");
}

function open(path: string, migrations: Migration[], onMigrated?: (applied: number[]) => void): Database {
  const db = openDatabase({ path, migrations, onMigrated });
  dbs.push(db);
  return db;
}

function close(db: Database): void {
  db.close();
  const index = dbs.indexOf(db);
  if (index >= 0) dbs.splice(index, 1);
}

function expectFinalSchema(db: Database): void {
  expect(db.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(25);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  expect(tables).toEqual(expect.arrayContaining([
    "canonical_memory_units",
    "mcp_desired_servers",
    "skill_packages",
    "memory_authority_selection",
    "memory_migration_runs",
    "hindsight_connection_state",
    "hindsight_cutover_runs",
    "hindsight_import_operations",
    "hindsight_replica_checkpoints",
    "hindsight_authority_activation_receipts",
    "runs",
    "run_attempts",
    "run_snapshots",
    "run_receipts",
    "run_events",
  ]));
}

function expectReopenNoOp(path: string): Database {
  const appliedOnReopen: number[][] = [];
  const reopened = open(path, MIGRATIONS, (applied) => appliedOnReopen.push(applied));
  expectFinalSchema(reopened);
  expect(appliedOnReopen).toEqual([[]]);
  return reopened;
}

describe("migration lineage reopen matrix", () => {
  it("converges a fresh database and is a no-op after reopen", () => {
    const path = createPath();
    const firstApplied: number[][] = [];
    const first = open(path, MIGRATIONS, (applied) => firstApplied.push(applied));
    expectFinalSchema(first);
    expect(firstApplied).toEqual([Array.from({ length: 25 }, (_, index) => index + 1)]);
    close(first);
    const reopened = expectReopenNoOp(path);
    expect(reopened.prepare("SELECT count(*) AS count FROM migrations").get()?.count).toBe(25);
  });

  it("converges the historical T4 17/18 MCP-Skill lineage through 024", () => {
    const path = createPath();
    const first = open(path, MIGRATIONS.slice(0, 16));
    expect(runMigrations(first, [
      { version: 17, sql: mcpDesiredServersMigration018.sql },
      { version: 18, sql: skillPackagesMigration019.sql },
    ])).toEqual([17, 18]);
    close(first);
    const tailApplied: number[][] = [];
    const reopened = open(path, [
      skillPackagesMigration019,
      parallelFoundationConvergenceMigration020,
      memoryLegacyMigration021,
      hindsightConnectionSetupMigration022,
      hindsightInitialCutoverMigration023,
      harnessRunsMigration024,
      runEventsMigration025,
    ], (applied) => tailApplied.push(applied));
    expect(tailApplied).toEqual([[19, 20, 21, 22, 23, 24, 25]]);
    expectFinalSchema(reopened);
    expect(reopened.prepare("SELECT version FROM migrations ORDER BY version").all().map((row) => row.version)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
    close(reopened);
    expectReopenNoOp(path);
  });

  it("applies the committed main 021-023 tail to the pre-main database", () => {
    const path = createPath();
    const first = open(path, MIGRATIONS.slice(0, 20));
    expect(first.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(20);
    close(first);
    const tailApplied: number[][] = [];
    const reopened = open(path, MIGRATIONS, (applied) => tailApplied.push(applied));
    expect(tailApplied).toEqual([[21, 22, 23, 24, 25]]);
    expectFinalSchema(reopened);
    expect(reopened.prepare("SELECT mode FROM memory_authority_selection WHERE singleton=1").get()?.mode)
      .toBe("legacy-markdown");
    close(reopened);
    expectReopenNoOp(path);
  });

  it("preserves a legal Hindsight authority marker and activation receipt on reopen", () => {
    const path = createPath();
    const first = open(path, MIGRATIONS);
    first.exec(`
      INSERT INTO canonical_memory_authority_epochs
        (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES ('local-epoch','local','local-lineage','closed',NULL,'2026-08-23T00:00:00.000Z','2026-08-23T00:01:00.000Z','initial-local');
      INSERT INTO canonical_memory_authority_epochs
        (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES ('hindsight-epoch','hindsight','provider-lineage','active','local-epoch','2026-08-23T00:02:00.000Z',NULL,'planned-switch');
      INSERT INTO memory_migration_runs
        (run_id,snapshot_id,phase,status,requested_at,updated_at,lease_fence)
      VALUES ('hindsight-run','snapshot','verified','ready','2026-08-23T00:00:00.000Z','2026-08-23T00:03:00.000Z',1);
      UPDATE memory_authority_selection
      SET mode='hindsight',active_epoch_id='hindsight-epoch',verified_snapshot_id=NULL,
          activation_transaction_id='hindsight-tx',provider_lineage_id='provider-lineage',
          replica_checkpoint_digest='${"a".repeat(64)}',updated_at='2026-08-23T00:03:00.000Z'
      WHERE singleton=1;
      INSERT INTO hindsight_authority_activation_receipts
        (transaction_id,run_id,predecessor_epoch_id,hindsight_epoch_id,provider_lineage,
         config_fingerprint,checkpoint_set_digest,bank_count,lease_fence,committed_at)
      VALUES ('hindsight-tx','hindsight-run','local-epoch','hindsight-epoch','provider-lineage',
              '${"b".repeat(64)}','${"c".repeat(64)}',1,1,'2026-08-23T00:03:00.000Z');
    `);
    close(first);
    const reopened = expectReopenNoOp(path);
    expect(reopened.prepare("SELECT mode,active_epoch_id,provider_lineage_id FROM memory_authority_selection WHERE singleton=1").get())
      .toEqual({ mode: "hindsight", active_epoch_id: "hindsight-epoch", provider_lineage_id: "provider-lineage" });
    expect(reopened.prepare("SELECT transaction_id FROM hindsight_authority_activation_receipts").get()?.transaction_id)
      .toBe("hindsight-tx");
  });
});
