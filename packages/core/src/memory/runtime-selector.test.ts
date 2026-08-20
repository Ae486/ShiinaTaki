import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { canonicalMemoryMigration017 } from "../db/migrations/017-canonical-memory.ts";
import { memoryLegacyMigration021 } from "../db/migrations/021-memory-legacy-migration.ts";
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
  });
  it("fails closed for a missing marker instead of silently selecting legacy", () => { const db = open(); db.exec("DELETE FROM memory_authority_selection"); expect(() => selectMemoryRuntime({ db, createLegacy: () => ({ engine: engine() } as never), createCanonical: engine })).toThrow("MEMORY_INTEGRITY_ERROR"); });
});
