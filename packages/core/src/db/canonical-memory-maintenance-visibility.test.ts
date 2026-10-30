import { afterEach, describe, expect, it } from "vitest";
import { CANONICAL_MAINTENANCE_LATER as later, canonicalMaintenanceRows,
  createCanonicalMaintenanceFixture } from "./canonical-memory-maintenance-fixtures.ts";
import { createCanonicalMemorySparseRepo } from "./canonical-memory-sparse-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  return { ...createCanonicalMaintenanceFixture(db), sparse: createCanonicalMemorySparseRepo(db) };
}
function target(value: ReturnType<typeof fixture>, memoryId = "memory", bankId = "global") {
  return { epochId: value.epochId, bankId, characterId: "a", memoryId };
}
function change(value: ReturnType<typeof fixture>, requestId: string, expectedRevision: number) {
  return { ...target(value), requestId, expectedRevision, now: later };
}
function search(value: ReturnType<typeof fixture>, bankId = "global", limit = 10) {
  return value.sparse.search({ bankId, query: "quiet", queryTimestamp: null, budget: "low", limit,
    maxTokens: 100, factTypes: ["experience"], layerIds: [], includeInvalidated: false }, value.tokenizer, value.epochId);
}
function indexed(db: Database) { return db.prepare("SELECT memory_id FROM canonical_memory_fts ORDER BY memory_id").all().map((row) => row.memory_id); }

describe("canonical hidden memory sparse visibility", () => {
  it("retains hidden facts and history for by-ID reads without publishing them through retain, upsert or rebuild", () => {
    const value = fixture(); const original = value.seed({ policy: { visibility: "hidden" } });
    expect(indexed(value.db)).toEqual([]);
    expect(value.maintenance.record(target(value))).toEqual(original.record);
    expect(value.maintenance.source({ ...target(value), documentId: original.source.documentId })).toEqual(original.source);
    const snapshot = value.db.prepare("SELECT record_json FROM canonical_memory_revision_snapshots WHERE memory_id='memory'").get();
    expect(JSON.parse(String(snapshot?.record_json))).toEqual(original.record);
    value.sparse.upsert({ ...target(value), text: original.unit.text, context: original.unit.context, searchTerms: "quiet" });
    value.sparse.rebuild(value.epochId, value.tokenizer);
    expect(indexed(value.db)).toEqual([]);
    expect(search(value)).toEqual([]);
    expect(value.maintenance.record(target(value))?.unit.state).toBe("valid");
  });

  it("removes an existing index row on hide and republishes on unhide without changing content or lifecycle", () => {
    const value = fixture(); const original = value.seed();
    const hideInput = { ...change(value, "hide", 1), patch: { visibility: "hidden" as const } };
    const hidden = value.maintenance.policyEdit(hideInput);
    expect(hidden.record.unit).toEqual({ ...original.unit, revision: 2, updatedAt: later });
    expect(indexed(value.db)).toEqual([]);
    expect(search(value)).toEqual([]);
    const visible = value.maintenance.policyEdit({ ...change(value, "unhide", 2), patch: { visibility: "retrieved" } });
    expect(visible.record.unit.state).toBe("valid");
    expect(visible.record.provenance).toEqual(original.source.provenance);
    expect(indexed(value.db)).toEqual(["memory"]);
    expect(search(value).map((row) => row.memoryId)).toEqual(["memory"]);
    const beforeReplay = canonicalMaintenanceRows(value.db);
    expect(value.maintenance.policyEdit(hideInput)).toEqual(hidden);
    expect(canonicalMaintenanceRows(value.db)).toEqual(beforeReplay);
    value.sparse.rebuild(value.epochId, value.tokenizer);
    expect(indexed(value.db)).toEqual(["memory"]);
  });

  it("keeps hidden policy effective through canonical edit, reinforcement, invalidate and restore", () => {
    const value = fixture(); const original = value.seed();
    value.records.edit({ ...change(value, "edit-hide", 1), requestHash: "a".repeat(64), searchTerms: "quiet corrected",
      patch: { text: "A quiet corrected memory" }, policy: { layerId: "profile", visibility: "hidden", retention: { kind: "permanent" } } });
    expect(indexed(value.db)).toEqual([]);
    value.maintenance.reinforce({ ...change(value, "proof", 2), mode: "tidy" });
    expect(indexed(value.db)).toEqual([]);
    value.maintenance.invalidate({ ...change(value, "invalidate", 3), reason: "temporarily invalid" });
    const restored = value.maintenance.restore(change(value, "restore", 4));
    expect(restored.record).toMatchObject({ unit: { state: "valid", text: "A quiet corrected memory", revision: 5 },
      policy: { visibility: "hidden" }, provenance: original.source.provenance });
    expect(indexed(value.db)).toEqual([]);
    expect(search(value)).toEqual([]);
    value.maintenance.policyEdit({ ...change(value, "show-restored", 5), patch: { visibility: "retrieved" } });
    expect(search(value).map((row) => row.memoryId)).toEqual(["memory"]);
  });

  it.each(["global", "a-bank"])("keeps copied hidden facts and support out of the %s index until deliberate unhide", (destinationBankId) => {
    const value = fixture(); value.seed({ memoryId: "support", policy: { visibility: "hidden" } });
    const original = value.seed({ unit: { sourceMemoryIds: ["support"] } });
    const copied = value.maintenance.copyToBank({ ...change(value, "copy-hidden", 1), destinationBankId,
      policy: { layerId: "profile", visibility: "hidden", retention: { kind: "permanent" } } });
    expect(copied.record).toMatchObject({ unit: { state: "valid", text: original.unit.text },
      policy: { visibility: "hidden" }, provenance: original.source.provenance });
    expect(copied.record.unit.sourceMemoryIds).toHaveLength(1);
    expect(indexed(value.db)).toEqual([]);
    const copiedTarget = target(value, copied.record.unit.memoryId, destinationBankId);
    expect(value.maintenance.record(copiedTarget)).toEqual(copied.record);
    value.maintenance.policyEdit({ ...copiedTarget, expectedRevision: 1, requestId: "unhide-copy", now: later,
      patch: { visibility: "retrieved" } });
    value.sparse.rebuild(value.epochId, value.tokenizer);
    expect(indexed(value.db)).toEqual([copied.record.unit.memoryId]);
    expect(search(value, destinationBankId).map((row) => row.memoryId)).toEqual([copied.record.unit.memoryId]);
    expect(value.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("filters stale hidden cache rows before the result limit and removes them completely on rebuild", () => {
    const value = fixture(); value.seed({ memoryId: "hidden", unit: { text: "same quiet memory" }, policy: { visibility: "hidden", importance: 10 } });
    value.seed({ memoryId: "visible", unit: { text: "same quiet memory" }, policy: { importance: 1 } });
    value.db.prepare(`INSERT INTO canonical_memory_fts (authority_epoch_id,bank_id,memory_id,text,context,search_terms)
      VALUES (:epoch,'global','hidden','same quiet memory',NULL,'quiet')`).run({ epoch: value.epochId });
    expect(indexed(value.db)).toEqual(["hidden", "visible"]);
    expect(search(value, "global", 1).map((row) => row.memoryId)).toEqual(["visible"]);
    value.sparse.rebuild(value.epochId, value.tokenizer);
    expect(indexed(value.db)).toEqual(["visible"]);
    expect(value.maintenance.record(target(value, "hidden"))?.unit.state).toBe("valid");
  });

  it("does not publish hidden new facts during an atomic ingestion batch", () => {
    const value = fixture(); const hidden = value.make({ policy: { visibility: "hidden" } });
    const result = value.maintenance.ingest({ epochId: value.epochId, bankId: "global", characterId: "a", requestId: "ingest-hidden", now: later,
      source: hidden.source, units: [{ unit: hidden.unit, policy: hidden.policy, searchTerms: "quiet" }], duplicates: [] });
    expect(result.memories).toEqual([{ memoryId: "memory", revision: 1 }]);
    expect(indexed(value.db)).toEqual([]);
    expect(value.maintenance.record(target(value))).toEqual(hidden.record);
  });

  it("rolls hidden policy and index removal back together if the historical snapshot fails", () => {
    const value = fixture(); value.seed(); const before = canonicalMaintenanceRows(value.db);
    value.db.exec("CREATE TRIGGER fail_hide BEFORE INSERT ON canonical_memory_revision_snapshots BEGIN SELECT RAISE(ABORT,'snapshot failed'); END");
    expect(() => value.maintenance.policyEdit({ ...change(value, "hide-fails", 1), patch: { visibility: "hidden" } })).toThrow();
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
    expect(search(value).map((row) => row.memoryId)).toEqual(["memory"]);
  });
});
