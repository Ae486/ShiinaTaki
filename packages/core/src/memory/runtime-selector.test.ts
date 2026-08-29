import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { canonicalMemoryMigration017 } from "../db/migrations/017-canonical-memory.ts";
import { memoryLegacyMigration021 } from "../db/migrations/021-memory-legacy-migration.ts";
import { hindsightInitialCutoverMigration023 } from "../db/migrations/023-hindsight-initial-cutover.ts";
import type { MemoryEngine } from "./memory-engine.ts";
import { selectMemoryRuntime } from "./runtime-selector.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
function engine(): MemoryEngine { return { reconcile: () => ({ upserted: 0, deleted: 0, total: 0, invalid: [] }), assemble: () => "", createTools: () => ({}), createBackgroundTools: () => ({}), writeEntry: () => ({ id: "x", layer: "profile" }), retention: { listActive: () => [], archive: () => undefined, hardDelete: () => undefined }, tidy: { listActive: () => [], countSince: () => 0, readBlock: () => undefined, createTools: () => ({}) } }; }
function open(): Database { const db = openDatabase({ path: ":memory:", migrations: [canonicalMemoryMigration017, memoryLegacyMigration021] }); dbs.push(db); return db; }

describe("memory runtime selector", () => {
  it("constructs legacy only while the marker is legacy-markdown", () => { const db = open(); const createLegacy = vi.fn(() => ({ engine: engine() } as never)); const createCanonical = vi.fn(engine); const selected = selectMemoryRuntime({ db, createLegacy, createCanonical }); expect(selected.canonical).toBe(false); expect(createLegacy).toHaveBeenCalledOnce(); expect(createCanonical).not.toHaveBeenCalled(); });
  it("constructs canonical only after activation and never falls back to Markdown", () => { const db = open(); db.exec("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id='epoch',verified_snapshot_id='snapshot',activation_transaction_id='tx' WHERE singleton=1"); const createLegacy = vi.fn(() => ({ engine: engine() } as never)); const createCanonical = vi.fn(engine); const selected = selectMemoryRuntime({ db, createLegacy, createCanonical }); expect(selected.canonical).toBe(true); expect(createLegacy).not.toHaveBeenCalled(); expect(createCanonical).toHaveBeenCalledWith("epoch"); });
  it("delegates existing detached calls to canonical after an in-process activation", () => {
    const db = open();
    const legacy = engine(); const canonical = engine();
    legacy.assemble = () => "legacy"; canonical.assemble = () => "canonical";
    const selected = selectMemoryRuntime({ db, createLegacy: () => ({ engine: legacy } as never), createCanonical: () => canonical });
    expect(selected.memory.assemble({ characterId: "taki", currentMessage: "" })).toBe("legacy");
    selected.bindCanonical("epoch");
    expect(selected.memory.assemble({ characterId: "taki", currentMessage: "" })).toBe("canonical");
    expect(selected.legacy).toBeNull();
  });
  it("fails closed for a missing marker instead of silently selecting legacy", () => { const db = open(); db.exec("DELETE FROM memory_authority_selection"); expect(() => selectMemoryRuntime({ db, createLegacy: () => ({ engine: engine() } as never), createCanonical: engine })).toThrow("MEMORY_INTEGRITY_ERROR"); });
  it("fails closed for Hindsight authority before runtime integration without constructing either Local runtime", () => {
    const db = openDatabase({ path: ":memory:", migrations: [canonicalMemoryMigration017, memoryLegacyMigration021, hindsightInitialCutoverMigration023] }); dbs.push(db);
    seedHindsightSelection(db);
    const createLegacy = vi.fn(() => ({ engine: engine() } as never)); const createCanonical = vi.fn(engine);
    expect(() => selectMemoryRuntime({ db, createLegacy, createCanonical })).toThrow("Hindsight authority runtime is not installed");
    expect(createLegacy).not.toHaveBeenCalled(); expect(createCanonical).not.toHaveBeenCalled();
  });
});

function seedHindsightSelection(db: Database): void {
  const digest = "a".repeat(64); const config = "b".repeat(64); const now = "2026-08-22T00:00:00.000Z";
  db.prepare(`INSERT INTO canonical_memory_authority_epochs
    (epoch_id,provider_id,provider_lineage_id,status,started_at,ended_at,reason)
    VALUES ('local-epoch','local','local-lineage','closed',:now,:now,'initial-local'),
      ('hindsight-epoch','hindsight','lineage','active',:now,NULL,'planned-switch')`).run({ now });
  db.prepare("INSERT INTO canonical_memory_authority_state (singleton,active_epoch_id,updated_at) VALUES (1,'hindsight-epoch',:now)").run({ now });
  db.prepare(`INSERT INTO memory_migration_runs
    (run_id,snapshot_id,epoch_id,phase,status,requested_at,updated_at,lease_fence,activation_transaction_id)
    VALUES ('run','snapshot','local-epoch','activated','completed',:now,:now,1,'local-tx')`).run({ now });
  db.prepare(`INSERT INTO hindsight_cutover_runs
    (run_id,expected_predecessor_epoch_id,phase,status,config_fingerprint,checkpoint_set_digest,lease_fence,created_at,updated_at)
    VALUES ('run','local-epoch','activated','completed',:config,:digest,1,:now,:now)`).run({ config, digest, now });
  db.prepare(`INSERT INTO hindsight_authority_activation_receipts
    (transaction_id,run_id,predecessor_epoch_id,hindsight_epoch_id,provider_lineage,config_fingerprint,
     checkpoint_set_digest,bank_count,lease_fence,committed_at)
    VALUES ('tx','run','local-epoch','hindsight-epoch','lineage',:config,:digest,1,1,:now)`)
    .run({ config, digest, now });
  db.prepare(`INSERT INTO hindsight_authority_bank_receipts
    (transaction_id,bank_id,snapshot_id,bank_generation,replica_epoch_id,end_cursor,manifest_digest,template_digest)
    VALUES ('tx','bank','snapshot','generation','replica',0,:digest,:digest)`).run({ digest });
  db.prepare(`UPDATE memory_authority_selection SET mode='hindsight',active_epoch_id='hindsight-epoch',verified_snapshot_id=NULL,
    activation_transaction_id='tx',provider_lineage_id='lineage',replica_checkpoint_digest=:digest WHERE singleton=1`)
    .run({ digest });
}
