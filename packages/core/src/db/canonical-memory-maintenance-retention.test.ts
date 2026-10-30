import { afterEach, describe, expect, it } from "vitest";
import type { TakiMemoryPolicyProjection } from "@taki/shared";
import { CANONICAL_MAINTENANCE_AT as at, CANONICAL_MAINTENANCE_LATER as later,
  canonicalMaintenanceRows, createCanonicalMaintenanceFixture } from "./canonical-memory-maintenance-fixtures.ts";
import { CANONICAL_LOCAL_EVIDENCE_KEY } from "./canonical-memory-maintenance-evidence.ts";
import { stableRequestHash } from "./canonical-memory-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  return createCanonicalMaintenanceFixture(db);
}
function target(value: ReturnType<typeof fixture>, memoryId = "memory") {
  return { epochId: value.epochId, bankId: "global", characterId: "a", memoryId };
}
function deletion(value: ReturnType<typeof fixture>) {
  return { ...target(value), expectedRevision: 1, requestId: "delete", now: later };
}
const rolling = { kind: "rolling-window", days: 7 } as const;

describe("canonical machine rolling retention", () => {
  it.each<{ layerId: string; retention: TakiMemoryPolicyProjection["retention"] }>([
    { layerId: "profile", retention: rolling },
    { layerId: "relationship", retention: rolling },
    { layerId: "activity", retention: { kind: "permanent" } },
    { layerId: "activity", retention: { kind: "expiring", expiresAt: at } },
  ])("does not treat $layerId / $retention.kind as an irreversible retention grant", ({ layerId, retention }) => {
    const value = fixture(); value.seed({ layerId, policy: { retention } }); const before = canonicalMaintenanceRows(value.db);
    expect(() => value.maintenance.hardDeleteRolling(deletion(value))).toThrow(/MEMORY_INVALID_REQUEST/);
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it("uses the current recency anchor and a strictly expired rolling window", () => {
    const value = fixture(); value.seed({ layerId: "activity", policy: { retention: rolling } });
    const boundary = { ...deletion(value), now: "2026-01-08T00:00:00.000Z" };
    expect(() => value.maintenance.hardDeleteRolling(boundary)).toThrow(/MEMORY_INVALID_REQUEST/);
    expect(value.maintenance.hardDeleteRolling({ ...boundary, now: "2026-01-08T00:00:00.001Z" }).outcome).toBe("deleted");
    expect(value.maintenance.record(target(value))).toBeUndefined();
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_sources").get()?.n).toBe(0);
    expect(value.db.prepare("SELECT document_id,last_revision FROM canonical_memory_retired_sources").get())
      .toMatchObject({ document_id: "document-memory", last_revision: 1 });
  });

  it("replays every historical mutation and retain receipt after physical deletion without recreating rows", () => {
    const value = fixture(); const original = value.seed({ layerId: "activity", policy: { retention: rolling } });
    const policyInput = { ...deletion(value), requestId: "policy", patch: { disclosure: "a new trigger" } };
    const policy = value.maintenance.policyEdit(policyInput);
    const reinforceInput = { ...deletion(value), expectedRevision: 2, requestId: "reinforce", now: "2026-02-02T00:00:00.000Z", mode: "tidy" as const };
    const reinforced = value.maintenance.reinforce(reinforceInput);
    const invalidateInput = { ...deletion(value), expectedRevision: 3, requestId: "invalidate", now: "2026-02-03T00:00:00.000Z", reason: "old activity" };
    const invalidated = value.maintenance.invalidate(invalidateInput);
    const restoreInput = { ...deletion(value), expectedRevision: 4, requestId: "restore", now: "2026-02-04T00:00:00.000Z" };
    const restored = value.maintenance.restore(restoreInput);
    const editInput = { ...deletion(value), expectedRevision: 5, requestId: "edit", now: "2026-02-05T00:00:00.000Z",
      requestHash: "f".repeat(64), patch: { text: "A later activity correction" }, searchTerms: "later activity correction" };
    const edited = value.records.edit(editInput);
    const deleteInput = { ...deletion(value), expectedRevision: 6, now: "2026-05-01T00:00:00.000Z" };
    const deleted = value.maintenance.hardDeleteRolling(deleteInput);
    for (const table of ["canonical_memory_units", "canonical_memory_policy", "canonical_memory_fts", "canonical_memory_sources"]) {
      expect(value.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
    }
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_revision_snapshots").get()?.n).toBe(6);
    const before = canonicalMaintenanceRows(value.db);
    expect(value.maintenance.policyEdit(policyInput)).toEqual(policy);
    expect(value.maintenance.reinforce(reinforceInput)).toEqual(reinforced);
    expect(value.maintenance.invalidate(invalidateInput)).toEqual(invalidated);
    expect(value.maintenance.restore(restoreInput)).toEqual(restored);
    expect(value.records.edit(editInput)).toEqual(edited);
    expect(value.maintenance.hardDeleteRolling(deleteInput)).toEqual(deleted);
    expect(value.records.retain({ epochId: value.epochId, bankId: "global", requestId: "seed-global-memory",
      requestHash: stableRequestHash(original), source: original.source, unit: original.unit, policy: original.policy,
      searchTerms: "historical request" })).toEqual({ documentId: original.source.documentId,
      sourceRevision: 1, memories: [{ memoryId: "memory", revision: 1 }] });
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
    expect(() => value.maintenance.hardDeleteRolling({ ...deleteInput, expectedRevision: 7 })).toThrow(/MEMORY_REQUEST_ID_CONFLICT/);
    expect(() => value.maintenance.hardDeleteRolling({ ...deleteInput, requestId: "new-delete" })).toThrow(/MEMORY_NOT_FOUND/);
  });

  it("preserves a source shared by another current fact", () => {
    const value = fixture(); const machine = value.make({ layerId: "activity", policy: { retention: rolling } });
    const lasting = value.make({ memoryId: "lasting", unit: { documentId: machine.source.documentId } });
    value.records.retain({ epochId: value.epochId, bankId: "global", requestId: "shared-source", requestHash: "b".repeat(64),
      source: machine.source, units: [machine, lasting].map((item) => ({ unit: item.unit, policy: item.policy, searchTerms: "shared source" })) });
    value.maintenance.hardDeleteRolling(deletion(value));
    expect(value.maintenance.source({ ...target(value), documentId: machine.source.documentId })).toEqual(machine.source);
    expect(value.maintenance.record(target(value, "lasting"))?.unit.state).toBe("valid");
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_retired_sources").get()?.n).toBe(0);
    expect(value.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("removes only the deleted fact's evidence association while retaining a shared new source and its opaque metadata", () => {
    const value = fixture(); value.seed({ layerId: "activity", policy: { retention: rolling } }); value.seed({ memoryId: "lasting" });
    const source = value.make({ memoryId: "evidence" }).source;
    const input = { epochId: value.epochId, bankId: "global", characterId: "a", requestId: "proof", now: later, source,
      units: [], duplicates: [{ memoryId: "memory", expectedRevision: 1, importance: 5 },
        { memoryId: "lasting", expectedRevision: 1, importance: 7 }] };
    const receipt = value.maintenance.ingest(input);
    value.maintenance.hardDeleteRolling({ ...deletion(value), expectedRevision: 2, now: "2026-05-01T00:00:00.000Z" });
    const remaining = value.maintenance.evidenceSources(target(value, "lasting"));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ retainedText: source.retainedText, provenance: source.provenance, revision: 2,
      metadata: { ...source.metadata, [CANONICAL_LOCAL_EVIDENCE_KEY]: { version: 1,
        targets: [{ epochId: value.epochId, bankId: "global", memoryId: "lasting" }] } } });
    expect(value.maintenance.evidenceSources(target(value))).toEqual([]);
    expect(value.maintenance.ingestReceipt(input)).toEqual(receipt);
    expect(value.maintenance.ingest(input)).toEqual(receipt);
    expect(value.maintenance.record(target(value, "lasting"))?.unit.proofCount).toBe(4);
  });

  it("refuses to delete a fact that still supports another fact, including archived dependents", () => {
    const value = fixture(); value.seed({ layerId: "activity", policy: { retention: rolling } });
    value.seed({ memoryId: "dependent", unit: { sourceMemoryIds: ["memory"], state: "invalidated", invalidatedAt: at,
      invalidationReason: "historical supporting record" } });
    const before = canonicalMaintenanceRows(value.db);
    expect(() => value.maintenance.hardDeleteRolling(deletion(value))).toThrow(/MEMORY_INVALID_REQUEST/);
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it("rolls deletion and source cleanup back when a source write fails", () => {
    const value = fixture(); value.seed({ layerId: "activity", policy: { retention: rolling } });
    const before = canonicalMaintenanceRows(value.db);
    value.db.exec("CREATE TRIGGER fail_source BEFORE DELETE ON canonical_memory_sources BEGIN SELECT RAISE(ABORT,'source failed'); END");
    expect(() => value.maintenance.hardDeleteRolling(deletion(value))).toThrow();
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it("does not recycle a hard-deleted document or memory identity into an unrelated new retain", () => {
    const value = fixture(); const original = value.seed({ layerId: "activity", policy: { retention: rolling } });
    value.maintenance.hardDeleteRolling(deletion(value)); const before = canonicalMaintenanceRows(value.db);
    const reusedSource = value.make({ memoryId: "replacement", source: { documentId: original.source.documentId } });
    expect(() => value.records.retain({ epochId: value.epochId, bankId: "global", requestId: "reuse-source",
      requestHash: "c".repeat(64), ...reusedSource, searchTerms: "replacement" })).toThrow(/MEMORY_REQUEST_ID_CONFLICT/);
    const reusedMemory = value.make({ source: { documentId: "fresh-source" } });
    expect(() => value.records.retain({ epochId: value.epochId, bankId: "global", requestId: "reuse-memory",
      requestHash: "d".repeat(64), ...reusedMemory, searchTerms: "replacement" })).toThrow(/MEMORY_REQUEST_ID_CONFLICT/);
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });
});
