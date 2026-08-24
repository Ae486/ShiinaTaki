import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "./index-list.ts";
import { openDatabase } from "../sqlite.ts";
import { memoryLegacyMigration021 } from "./021-memory-legacy-migration.ts";
import { hindsightConnectionSetupMigration022 } from "./022-hindsight-connection-setup.ts";
import { hindsightInitialCutoverMigration023 } from "./023-hindsight-initial-cutover.ts";

describe("hindsight initial cutover migration 023", () => {
  it("applies after B2/B3 and creates additive B4 tables", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    expect(db.prepare("SELECT version FROM migrations WHERE version = 23").get()?.version).toBe(23);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='hindsight_import_operations'").get()?.name).toBe("hindsight_import_operations");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='hindsight_cutover_runs'").get()?.name).toBe("hindsight_cutover_runs");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='hindsight_import_facts'").get()?.name).toBe("hindsight_import_facts");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='hindsight_replica_staging_runs'").get()?.name).toBe("hindsight_replica_staging_runs");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='hindsight_replica_staging_records'").get()?.name).toBe("hindsight_replica_staging_records");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='hindsight_replica_records'").get()?.name).toBe("hindsight_replica_records");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='hindsight_replica_checkpoints'").get()?.name).toBe("hindsight_replica_checkpoints");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='hindsight_authority_activation_receipts'").get()?.name).toBe("hindsight_authority_activation_receipts");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='hindsight_authority_bank_receipts'").get()?.name).toBe("hindsight_authority_bank_receipts");
    expect(() => db.prepare(`INSERT INTO hindsight_replica_staging_runs
      (staging_id,run_id,replica_epoch_id,provider_lineage,bank_id,bank_generation,snapshot_id,end_cursor,manifest_digest,manifest_json,status,created_at,updated_at)
      VALUES ('s','missing','e','p','b','g','snapshot',0,:hash,'{}','building','n','n')`).run({ hash: "z".repeat(64) })).toThrow();
    db.prepare(`INSERT INTO memory_migration_runs (run_id,snapshot_id,phase,status,requested_at,updated_at,lease_fence)
      VALUES ('run','snapshot','verified','ready','n','n',1)`).run();
    db.prepare(`INSERT INTO memory_migration_sources
      (run_id,source_id,kind,relative_path,raw_sha256,byte_length,phase,disposition,updated_at)
      VALUES ('run','source','entry','memory/a.md',:hash,1,'verified','converted-one','n')`).run({ hash: "a".repeat(64) });
    expect(() => db.prepare(`INSERT INTO hindsight_import_operations
      (run_id,source_id,bank_id,document_id,operation_identity,remote_operation_id,content_identity,provider_content_hash,lease_fence,status,updated_at)
      VALUES ('run','source','bank','document','identity','remote',:content,:hash,1,'pending','n')`)
      .run({ content: `sha256:${"z".repeat(64)}`, hash: "a".repeat(64) })).toThrow();
    db.close();
  });

  it("preserves an existing canonical-local marker while adding Hindsight-only columns", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-hindsight-migration-")); const path = join(root, "workspace.db");
    try {
      const db = openDatabase({ path, migrations: [memoryLegacyMigration021, hindsightConnectionSetupMigration022] });
      db.exec("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id='epoch',verified_snapshot_id='snapshot',activation_transaction_id='tx' WHERE singleton=1");
      db.close();
      const reopened = openDatabase({ path, migrations: [memoryLegacyMigration021, hindsightConnectionSetupMigration022, hindsightInitialCutoverMigration023] });
      expect(reopened.prepare("SELECT * FROM memory_authority_selection WHERE singleton=1").get()).toMatchObject({
        mode: "canonical-local", active_epoch_id: "epoch", verified_snapshot_id: "snapshot",
        activation_transaction_id: "tx", provider_lineage_id: null, replica_checkpoint_digest: null,
      });
      reopened.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("enforces valid Hindsight marker and checkpoint expiry shapes", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    expect(() => db.exec("UPDATE memory_authority_selection SET mode='hindsight',active_epoch_id='epoch',verified_snapshot_id=NULL,activation_transaction_id='tx',provider_lineage_id='lineage',replica_checkpoint_digest='bad' WHERE singleton=1")).toThrow();
    expect(() => db.prepare(`INSERT INTO memory_migration_runs (run_id,snapshot_id,phase,status,requested_at,updated_at,lease_fence)
      VALUES ('run-expiry','snapshot','verified','ready','n','n',1)`).run()).not.toThrow();
    expect(() => db.prepare(`INSERT INTO hindsight_replica_staging_runs
      (staging_id,run_id,replica_epoch_id,provider_lineage,bank_id,bank_generation,snapshot_id,end_cursor,manifest_digest,manifest_json,snapshot_expires_at,status,created_at,updated_at)
      VALUES ('stage','run-expiry','epoch','lineage','bank','generation','snapshot',0,:hash,'{}',NULL,'building','n','n')`)
      .run({ hash: "a".repeat(64) })).toThrow();
    db.close();
  });
});
