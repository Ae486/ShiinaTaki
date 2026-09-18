import { afterEach, describe, expect, it } from "vitest";
import type { JsonValue, RecallRequest } from "@taki/shared";
import { CANONICAL_MAINTENANCE_LATER as later, canonicalMaintenanceRows,
  createCanonicalMaintenanceFixture } from "./canonical-memory-maintenance-fixtures.ts";
import { addCanonicalLineage, insertCanonicalUnitAndPolicy } from "./canonical-memory-maintenance-records.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createCanonicalLocalRuntime } from "../memory/canonical-local-runtime.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  return createCanonicalMaintenanceFixture(db);
}
function target(value: ReturnType<typeof fixture>, memoryId = "memory", bankId = "global") {
  return { epochId: value.epochId, bankId, characterId: "a", memoryId };
}
function copyInput(value: ReturnType<typeof fixture>, destinationBankId = "a-bank") {
  return { ...target(value), expectedRevision: 1, requestId: "copy", now: later, destinationBankId,
    policy: { layerId: "relationship", visibility: "pinned" as const, retention: { kind: "permanent" as const } } };
}

describe("canonical Local copy and supersede", () => {
  it("copies the complete support/source graph and duplicate evidence while preserving opaque fields and original provenance", () => {
    const value = fixture();
    const opaque = JSON.parse('{"__proto__":{"native":true},"constructor":"kept","values":[null,1,"1",false]}') as Record<string, JsonValue>;
    const support = value.seed({ memoryId: "support", unit: { metadata: opaque, factType: "world" } });
    const original = value.seed({ source: { metadata: opaque },
      unit: { factType: "observation", sourceMemoryIds: ["support"], metadata: opaque }, policy: { origin: "observed" } });
    const evidenceSource = value.make({ memoryId: "evidence" }).source;
    value.maintenance.ingest({ epochId: value.epochId, bankId: "global", characterId: "a", requestId: "evidence", now: later,
      source: evidenceSource, units: [], duplicates: [{ memoryId: "memory", expectedRevision: 1, importance: 5 }] });
    const beforeCopy = value.maintenance.record(target(value))!;
    const copied = value.maintenance.copyToBank({ ...copyInput(value), expectedRevision: 2 });
    expect(copied.original.unit).toMatchObject({ memoryId: "memory", bankId: "global", state: "invalidated", revision: 3,
      invalidationReason: "refiled", documentId: original.source.documentId });
    const supportId = copied.memoryMappings.find((item) => item.sourceMemoryId === "support")!.memoryId;
    const sourceId = copied.sourceMappings.find((item) => item.sourceDocumentId === original.source.documentId)!.documentId;
    expect(copied.record.unit).toEqual({ ...beforeCopy.unit, bankId: "a-bank", memoryId: copied.record.unit.memoryId,
      documentId: sourceId, revision: 1, sourceMemoryIds: [supportId], tags: ["keep-tag", "taki-layer:relationship"] });
    expect(copied.record.policy).toMatchObject({ layerId: "relationship", visibility: "pinned", origin: "observed",
      emotionalWeight: original.policy.emotionalWeight, policyVersion: original.policy.policyVersion });
    expect(copied.record.provenance).toEqual(original.source.provenance);
    expect(value.maintenance.record(target(value, supportId, "a-bank"))?.unit.metadata).toEqual(support.unit.metadata);
    expect(value.maintenance.record(target(value, "support"))?.unit).toEqual(support.unit);
    expect(value.maintenance.source({ ...target(value, copied.record.unit.memoryId, "a-bank"), documentId: sourceId }))
      .toEqual({ ...original.source, bankId: "a-bank", documentId: sourceId, revision: 1 });
    const copiedEvidence = value.maintenance.evidenceSources(target(value, copied.record.unit.memoryId, "a-bank"));
    expect(copiedEvidence).toHaveLength(1);
    expect(copiedEvidence[0]?.retainedText).toBe(evidenceSource.retainedText);
    expect(copiedEvidence[0]?.provenance).toEqual(evidenceSource.provenance);
    expect(value.maintenance.evidenceSources(target(value))).toHaveLength(1);
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(4);
    expect(value.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps cross-Bank ancillary relationship supports as hidden evidence outside another Character's assembly, BM25 and tidy", async () => {
    const value = fixture();
    const opaque = JSON.parse('{"__proto__":{"preserved":true},"constructor":"source-data","values":[null,3,"3",false]}') as Record<string, JsonValue>;
    const base = value.seed({ bankId: "a-bank", memoryId: "private-base", layerId: "relationship",
      unit: { text: "covenantsecret PRIVATE_BASE_RELATIONSHIP", metadata: opaque },
      source: { metadata: opaque }, policy: { importance: 9, visibility: "pinned" } });
    const support = value.seed({ bankId: "a-bank", memoryId: "private-support", layerId: "relationship",
      unit: { text: "covenantsecret PRIVATE_SUPPORT_RELATIONSHIP", factType: "observation", sourceMemoryIds: [base.unit.memoryId], metadata: opaque },
      source: { metadata: opaque }, policy: { importance: 9, visibility: "pinned" } });
    const selected = value.seed({ bankId: "a-bank", memoryId: "selected", layerId: "episodes",
      unit: { text: "publishedinsight The explicitly selected general preference", factType: "observation",
        sourceMemoryIds: [support.unit.memoryId], metadata: opaque }, policy: { importance: 9 } });
    const result = value.maintenance.copyToBank({ ...target(value, "selected", "a-bank"),
      expectedRevision: 1, requestId: "selected-to-global", now: later, destinationBankId: "global",
      policy: { layerId: "profile", visibility: "pinned", retention: { kind: "permanent" } } });
    const map = new Map(result.memoryMappings.map((entry) => [entry.sourceMemoryId, entry.memoryId]));
    expect(result.record.policy).toMatchObject({ layerId: "profile", visibility: "pinned" });
    expect(result.record.unit.sourceMemoryIds).toEqual([map.get(support.unit.memoryId)]);
    expect(result.original.unit).toMatchObject({ state: "invalidated", sourceMemoryIds: [support.unit.memoryId], metadata: opaque });
    for (const original of [base, support]) {
      const copied = value.maintenance.record(target(value, map.get(original.unit.memoryId)!, "global"))!;
      expect.soft(copied.policy.visibility).toBe("hidden");
      expect(copied.unit).toEqual({ ...original.unit, bankId: "global", memoryId: copied.unit.memoryId,
        documentId: copied.unit.documentId, revision: 1, sourceMemoryIds: original.unit.sourceMemoryIds.map((id) => map.get(id)) });
      expect(copied.policy).toEqual({ ...original.policy, bankId: "global", memoryId: copied.unit.memoryId,
        visibility: "hidden", updatedAt: later });
      expect(copied.provenance).toEqual(original.source.provenance);
      expect(copied.unit.sourceMemoryIds).toEqual(original.unit.sourceMemoryIds.map((id) => map.get(id)));
      expect(value.maintenance.record(target(value, original.unit.memoryId, "a-bank"))).toEqual(original.record);
      expect(value.maintenance.source({ ...target(value, original.unit.memoryId, "a-bank"), documentId: original.source.documentId }))
        .toEqual(original.source);
      expect(value.maintenance.source({ ...target(value, copied.unit.memoryId, "global"), documentId: copied.unit.documentId! }))
        .toEqual({ ...original.source, bankId: "global", documentId: copied.unit.documentId, revision: 1 });
    }
    expect(result.memoryMappings).toHaveLength(3);
    expect(result.sourceMappings).toHaveLength(3);
    const engine = createCanonicalLocalRuntime({ db: value.db, epochId: value.epochId });
    engine.banks("b");
    const assembly = engine.assemble({ characterId: "b", currentMessage: "covenantsecret" });
    expect(assembly).toContain("publishedinsight");
    expect.soft(assembly.includes("PRIVATE_"), "B assembly must exclude A-only supporting evidence").toBe(false);
    const context = { authorityEpochId: value.epochId, requestId: "b-recall", actor: "foreground-agent" as const };
    const query: Omit<RecallRequest, "query"> = { bankId: "global", queryTimestamp: null, budget: "low", limit: 20, maxTokens: 2_000,
      factTypes: ["world", "experience", "observation"], layerIds: [], includeInvalidated: false };
    expect.soft(await engine.provider.recall(context, { ...query, query: "covenantsecret" }))
      .toMatchObject({ ok: true, data: { returned: 0 } });
    expect(await engine.provider.recall({ ...context, requestId: "b-visible" }, { ...query, query: "publishedinsight" }))
      .toMatchObject({ ok: true, data: { returned: 1 } });
    const reviewed = engine.tidy.captureReview!("b").listActive("b");
    expect(reviewed.some((row) => row.content.includes("publishedinsight"))).toBe(true);
    expect.soft(reviewed.some((row) => row.content.includes("PRIVATE_")), "B tidy must exclude A-only supporting evidence").toBe(false);
    expect(value.maintenance.record(target(value, "selected", "a-bank"))?.provenance).toEqual(selected.source.provenance);
    expect(value.maintenance.source({ ...target(value, "selected", "a-bank"), documentId: selected.source.documentId })).toEqual(selected.source);
    expect(value.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps same-Bank support identities, visibility and source graph unchanged when only the selected fact is superseded", () => {
    const value = fixture();
    const support = value.seed({ bankId: "a-bank", memoryId: "relationship-support", layerId: "relationship",
      policy: { visibility: "pinned", importance: 9 } });
    const selected = value.seed({ bankId: "a-bank", memoryId: "selected", layerId: "episodes",
      unit: { factType: "observation", sourceMemoryIds: [support.unit.memoryId] } });
    const result = value.maintenance.copyToBank({ ...target(value, "selected", "a-bank"),
      expectedRevision: 1, requestId: "same-bank-selected", now: later, destinationBankId: "a-bank",
      policy: { layerId: "episodes", visibility: "retrieved", retention: { kind: "permanent" } } });
    expect(result.memoryMappings).toEqual([{ sourceMemoryId: selected.unit.memoryId, memoryId: result.record.unit.memoryId }]);
    expect(result.record.unit.sourceMemoryIds).toEqual([support.unit.memoryId]);
    expect(result.record.unit.documentId).toBe(selected.source.documentId);
    expect(result.sourceMappings).toEqual([]);
    expect(value.maintenance.record(target(value, support.unit.memoryId, "a-bank"))).toEqual(support.record);
    expect(value.maintenance.source({ ...target(value, support.unit.memoryId, "a-bank"), documentId: support.source.documentId }))
      .toEqual(support.source);
    expect(result.original.unit).toMatchObject({ state: "invalidated", sourceMemoryIds: [support.unit.memoryId] });
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(3);
    expect(value.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("composes same-Bank copy, content correction and policy change atomically without inventing a replacement raw source", () => {
    const value = fixture(); const original = value.seed();
    const replacement = value.maintenance.transaction(() => {
      const copy = value.maintenance.copyToBank({ ...copyInput(value, "global"),
        policy: { layerId: "profile", visibility: "retrieved", retention: { kind: "permanent" } } });
      const edited = value.records.edit({ ...target(value, copy.record.unit.memoryId), expectedRevision: 1,
        requestId: "correction", requestHash: "c".repeat(64), now: later, searchTerms: "corrected fact",
        patch: { text: "A corrected fact with the original source preserved." } });
      return value.maintenance.policyEdit({ ...target(value, edited.record.unit.memoryId), expectedRevision: 2,
        requestId: "promotion", now: later, patch: { importance: 9, disclosure: "the corrected preference" } }).record;
    });
    expect(replacement.unit).toMatchObject({ documentId: original.source.documentId, revision: 3, proofCount: original.unit.proofCount,
      text: "A corrected fact with the original source preserved.", metadata: original.unit.metadata });
    expect(replacement.provenance).toEqual(original.source.provenance);
    expect(value.maintenance.source({ ...target(value), documentId: original.source.documentId })).toEqual(original.source);
    expect(value.maintenance.record(target(value))?.unit.state).toBe("invalidated");
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_sources").get()?.n).toBe(1);
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(1);
  });

  it("rolls the whole supersede back when its later correction fails", () => {
    const value = fixture(); value.seed(); const before = canonicalMaintenanceRows(value.db);
    expect(() => value.maintenance.transaction(() => {
      const copied = value.maintenance.copyToBank(copyInput(value, "global"));
      value.records.edit({ ...target(value, copied.record.unit.memoryId), requestId: "bad-correction",
        requestHash: "d".repeat(64), expectedRevision: 1, now: later, searchTerms: "", patch: { text: "" } });
    })).toThrow();
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it("refuses a different Character destination and rolls copied sources back on a destination insert failure", () => {
    const value = fixture(); value.seed(); const before = canonicalMaintenanceRows(value.db);
    expect(() => value.maintenance.copyToBank(copyInput(value, "b-bank"))).toThrow(/MEMORY_AUTHORITY_MISMATCH/);
    value.db.exec(`CREATE TRIGGER fail_copy BEFORE INSERT ON canonical_memory_policy
      WHEN NEW.bank_id='a-bank' BEGIN SELECT RAISE(ABORT,'destination failed'); END`);
    expect(() => value.maintenance.copyToBank(copyInput(value))).toThrow();
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it("rechecks the destination Character after writing the compound receipt", () => {
    const value = fixture(); value.seed(); const before = canonicalMaintenanceRows(value.db);
    value.db.exec(`CREATE TRIGGER change_destination AFTER INSERT ON canonical_memory_operation_receipts
      WHEN NEW.request_id='copy' BEGIN UPDATE canonical_memory_banks SET character_id='different-owner' WHERE bank_id='a-bank'; END`);
    expect(() => value.maintenance.copyToBank(copyInput(value))).toThrow(/MEMORY_AUTHORITY_MISMATCH/);
    expect(value.authority.getBank(value.epochId, "a-bank")?.scope).toEqual({ kind: "character", characterId: "a" });
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it("replays the original copy outcome after the destination fact was edited and hard-deleted", () => {
    const value = fixture(); value.seed(); const input = copyInput(value);
    const copied = value.maintenance.copyToBank(input);
    const destination = target(value, copied.record.unit.memoryId, "a-bank");
    value.maintenance.policyEdit({ ...destination, requestId: "machine-policy", expectedRevision: 1, now: later,
      patch: { layerId: "activity", retention: { kind: "rolling-window", days: 1 } } });
    value.maintenance.hardDeleteRolling({ ...destination, requestId: "delete", expectedRevision: 2, now: "2026-05-01T00:00:00.000Z" });
    const before = canonicalMaintenanceRows(value.db);
    expect(value.maintenance.copyToBank({ ...input, now: "2026-06-01T00:00:00.000Z" })).toEqual(copied);
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
    expect(value.maintenance.record(destination)).toBeUndefined();
  });

  it("preserves a source-free imported observation without manufacturing a document", () => {
    const value = fixture(); value.seed({ memoryId: "support" });
    const native = value.make({ unit: { documentId: null, factType: "observation", sourceMemoryIds: ["support"] } });
    value.db.transaction(() => {
      insertCanonicalUnitAndPolicy(value.db, { unit: native.unit, policy: native.policy, searchTerms: "observation" });
      addCanonicalLineage(value.db, { ...target(value), sourceMemoryId: "support" });
    });
    const original = value.maintenance.record(target(value))!;
    expect(original.provenance.origin).toBe("provider-derived");
    const copied = value.maintenance.copyToBank(copyInput(value));
    expect(copied.record.unit.documentId).toBeNull();
    expect(copied.record.provenance).toEqual(original.provenance);
    expect(copied.sourceMappings).toHaveLength(1);
    expect(copied.sourceMappings[0]?.sourceDocumentId).toBe("document-support");
    expect(value.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("remaps a preserved cyclic support graph once without dropping or duplicating edges", () => {
    const value = fixture(); const root = value.make({ unit: { sourceMemoryIds: ["other"] } });
    const other = value.make({ memoryId: "other", unit: { documentId: root.source.documentId, sourceMemoryIds: ["memory"] } });
    value.records.retain({ epochId: value.epochId, bankId: "global", requestId: "cycle", requestHash: "e".repeat(64), source: root.source,
      units: [root, other].map((record) => ({ unit: record.unit, policy: record.policy, searchTerms: "support cycle" })) });
    const result = value.maintenance.copyToBank(copyInput(value));
    const otherId = result.memoryMappings.find((item) => item.sourceMemoryId === "other")!.memoryId;
    expect(result.memoryMappings).toHaveLength(2);
    expect(result.record.unit.sourceMemoryIds).toEqual([otherId]);
    expect(value.maintenance.record(target(value, otherId, "a-bank"))?.unit.sourceMemoryIds).toEqual([result.record.unit.memoryId]);
    expect(value.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
