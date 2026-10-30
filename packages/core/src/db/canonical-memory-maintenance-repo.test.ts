import { afterEach, describe, expect, it } from "vitest";
import type { JsonValue } from "@taki/shared";
import { createCanonicalMemorySparseRepo } from "./canonical-memory-sparse-repo.ts";
import type { CanonicalMaintenanceMutation } from "./canonical-memory-maintenance-contract.ts";
import { CANONICAL_MAINTENANCE_AT as at, CANONICAL_MAINTENANCE_LATER as later,
  canonicalMaintenanceRows, createCanonicalMaintenanceFixture } from "./canonical-memory-maintenance-fixtures.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  return createCanonicalMaintenanceFixture(db);
}
function request(value: ReturnType<typeof fixture>, overrides: Partial<CanonicalMaintenanceMutation> = {}): CanonicalMaintenanceMutation {
  return { epochId: value.epochId, bankId: "global", characterId: "a", memoryId: "memory",
    expectedRevision: 1, requestId: "change", now: later, ...overrides };
}

describe("canonical Local maintenance scope and policy", () => {
  it("lists only Global plus the active Character and exposes expired all-Bank retention metadata without text", () => {
    const value = fixture();
    value.seed({ memoryId: "global" });
    value.seed({ memoryId: "a", bankId: "a-bank", layerId: "intentions",
      policy: { retention: { kind: "expiring", expiresAt: at } } });
    value.seed({ memoryId: "b", bankId: "b-bank", layerId: "episodes" });
    value.seed({ memoryId: "archived", bankId: "a-bank", layerId: "episodes",
      unit: { state: "invalidated", invalidatedAt: at, invalidationReason: "historical" } });
    expect(value.maintenance.list({ epochId: value.epochId, characterId: "a" }).map((r) => r.unit.memoryId)).toEqual(["global", "a"]);
    expect(value.maintenance.list({ epochId: value.epochId, characterId: "a", layerIds: ["intentions"] }).map((r) => r.unit.memoryId)).toEqual(["a"]);
    expect(value.maintenance.list({ epochId: value.epochId, characterId: null }).map((r) => r.unit.memoryId)).toEqual(["global"]);
    expect(value.maintenance.list({ epochId: value.epochId, characterId: "a", includeInvalidated: true }).map((r) => r.unit.memoryId))
      .toEqual(["global", "a", "archived"]);
    const rows = value.maintenance.listRetention({ epochId: value.epochId });
    expect(rows.map((row) => row.memoryId)).toEqual(["a", "b", "global"]);
    expect(rows.find((row) => row.memoryId === "a")).toMatchObject({ bankId: "a-bank", characterId: "a", revision: 1,
      policy: { retention: { kind: "expiring", expiresAt: at } } });
    expect(JSON.stringify(rows)).not.toContain("I remember quiet cafes");
    expect(JSON.stringify(rows)).not.toContain("Original approved conversation");
  });

  it("updates the complete policy and sparse disclosure while retaining every unrelated logical value", () => {
    const value = fixture();
    const metadata = JSON.parse('{"__proto__":{"isData":true},"constructor":"preserved","array":[1,"1",null,false]}') as Record<string, JsonValue>;
    const sourceMetadata = JSON.parse('{"__proto__":{"source":1},"constructor":{"prototype":"data"}}') as Record<string, JsonValue>;
    const original = value.seed({ bankId: "a-bank", layerId: "episodes", source: { metadata: sourceMetadata },
      unit: { metadata, factType: "observation", consolidationFailedAt: at }, policy: { origin: "observed" } });
    const patch = { importance: 9, disclosure: "当用户谈到过敏时回想", layerId: "relationship",
      visibility: "pinned" as const, retention: { kind: "permanent" as const } };
    const result = value.maintenance.policyEdit({ ...request(value, { bankId: "a-bank" }), patch });
    expect(result.record.unit).toEqual({ ...original.unit, revision: 2, updatedAt: later,
      tags: ["keep-tag", "taki-layer:relationship"] });
    expect(result.record.policy).toEqual({ ...original.policy, ...patch, updatedAt: later });
    expect(result.record.provenance).toEqual(original.source.provenance);
    expect(Object.hasOwn(result.record.unit.metadata, "__proto__")).toBe(true);
    expect(value.maintenance.source({ ...request(value, { bankId: "a-bank" }), documentId: original.source.documentId })).toEqual(original.source);
    const sparse = createCanonicalMemorySparseRepo(value.db);
    const hits = sparse.search({ bankId: "a-bank", query: "过敏", queryTimestamp: null, budget: "low", limit: 10,
      maxTokens: 100, factTypes: ["observation"], layerIds: ["relationship"], includeInvalidated: false }, value.tokenizer, value.epochId);
    expect(hits.map((hit) => hit.memoryId)).toEqual(["memory"]);
    const before = value.db.prepare("SELECT * FROM canonical_memory_fts").all();
    sparse.rebuild(value.epochId, value.tokenizer);
    expect(value.db.prepare("SELECT * FROM canonical_memory_fts").all()).toEqual(before);
  });

  it("keeps tidy reinforcement distinct from incoming duplicate importance and replays without another proof", () => {
    const value = fixture(); const original = value.seed();
    const tidy = value.maintenance.reinforce({ ...request(value), mode: "tidy" });
    expect(tidy.record.unit).toEqual({ ...original.unit, revision: 2, proofCount: 4, updatedAt: later });
    expect(tidy.record.policy).toEqual(original.policy);
    const duplicateInput = { ...request(value, { expectedRevision: 2, requestId: "duplicate" }), mode: "duplicate-write" as const, importance: 7 };
    const duplicate = value.maintenance.reinforce(duplicateInput);
    expect(duplicate.record).toMatchObject({ unit: { revision: 3, proofCount: 5, mentionedAt: at, editedAt: null }, policy: { importance: 7 } });
    value.maintenance.policyEdit({ ...request(value, { expectedRevision: 3, requestId: "later-policy" }), patch: { importance: 2 } });
    const beforeReplay = canonicalMaintenanceRows(value.db);
    expect(value.maintenance.reinforce({ ...duplicateInput, now: "2026-04-01T00:00:00.000Z" })).toEqual(duplicate);
    expect(canonicalMaintenanceRows(value.db)).toEqual(beforeReplay);
    expect(value.maintenance.record(request(value))?.policy.importance).toBe(2);
    expect(value.maintenance.record(request(value))?.unit.proofCount).toBe(5);
  });

  it("does not demote an explicit high importance on a low-importance duplicate", () => {
    const value = fixture(); value.seed({ policy: { importance: 10, visibility: "pinned" } });
    expect(value.maintenance.reinforce({ ...request(value), mode: "duplicate-write", importance: 3 }).record.policy)
      .toMatchObject({ importance: 10, visibility: "pinned" });
  });

  it("uses the existing recoverable lifecycle receipts, including an unchanged historical invalidation", () => {
    const value = fixture(); const original = value.seed();
    const invalidation = { ...request(value), reason: "outdated" };
    const invalidated = value.maintenance.invalidate(invalidation);
    expect(invalidated.record.unit).toMatchObject({ state: "invalidated", revision: 2 });
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(0);
    const unchangedInput = { ...request(value, { expectedRevision: 2, requestId: "unchanged" }), reason: "outdated" };
    const unchanged = value.maintenance.invalidate(unchangedInput);
    expect(unchanged.outcome).toBe("unchanged");
    const restored = value.maintenance.restore(request(value, { expectedRevision: 2, requestId: "restore" }));
    expect(restored.record.unit).toMatchObject({ state: "valid", revision: 3, invalidatedAt: null, invalidationReason: null });
    expect(restored.record.provenance).toEqual(original.source.provenance);
    const before = canonicalMaintenanceRows(value.db);
    expect(value.maintenance.invalidate(invalidation)).toEqual(invalidated);
    expect(value.maintenance.invalidate(unchangedInput)).toEqual(unchanged);
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
    expect(value.db.prepare("SELECT operation FROM canonical_memory_operation_receipts WHERE request_id='restore'").get()?.operation).toBe("restore");
  });

  it("does not reindex an invalidated fact when the public canonical edit changes its text", () => {
    const value = fixture(); value.seed();
    value.maintenance.invalidate({ ...request(value), reason: null });
    const edited = value.records.edit({ ...request(value, { expectedRevision: 2, requestId: "foreground-edit" }),
      requestHash: "f".repeat(64), patch: { text: "A corrected archived memory" }, searchTerms: "corrected archived memory" });
    expect(edited.record.unit.state).toBe("invalidated");
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(0);
    value.maintenance.restore(request(value, { expectedRevision: 3, requestId: "restore" }));
    expect(value.db.prepare("SELECT text FROM canonical_memory_fts").get()?.text).toBe("A corrected archived memory");
  });
});

describe("canonical maintenance refusal and rollback", () => {
  it("rejects stale revision and reused request identity without applying a partial policy", () => {
    const value = fixture(); value.seed();
    value.maintenance.policyEdit({ ...request(value), patch: { importance: 7 } });
    const before = canonicalMaintenanceRows(value.db);
    expect(() => value.maintenance.policyEdit({ ...request(value, { requestId: "stale" }), patch: { disclosure: "new" } }))
      .toThrow(/MEMORY_REVISION_MISMATCH:2/);
    expect(() => value.maintenance.policyEdit({ ...request(value), patch: { importance: 8 } })).toThrow(/MEMORY_REQUEST_ID_CONFLICT/);
    expect(() => value.maintenance.reinforce({ ...request(value), mode: "tidy" })).toThrow(/MEMORY_REQUEST_ID_CONFLICT/);
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it("fences unknown Banks, foreign Characters, stale epochs, and a foreign provider even for receipt replay", () => {
    const value = fixture(); value.seed({ bankId: "a-bank" });
    const input = { ...request(value, { bankId: "a-bank" }), mode: "tidy" as const };
    value.maintenance.reinforce(input);
    const before = canonicalMaintenanceRows(value.db);
    expect(() => value.maintenance.reinforce({ ...input, characterId: "b" })).toThrow(/MEMORY_AUTHORITY_MISMATCH/);
    expect(() => value.maintenance.reinforce({ ...input, bankId: "unknown" })).toThrow(/MEMORY_AUTHORITY_MISMATCH/);
    expect(() => value.maintenance.reinforce({ ...input, epochId: "old-epoch" })).toThrow(/MEMORY_AUTHORITY_MISMATCH/);
    expect(() => value.maintenance.source({ ...input, characterId: "b", documentId: "document-memory" })).toThrow(/MEMORY_AUTHORITY_MISMATCH/);
    value.db.prepare("UPDATE canonical_memory_banks SET character_id='new-owner' WHERE bank_id='a-bank'").run();
    expect(() => value.maintenance.reinforce(input)).toThrow(/MEMORY_AUTHORITY_MISMATCH/);
    value.db.prepare("UPDATE canonical_memory_banks SET character_id='a' WHERE bank_id='a-bank'").run();
    value.db.exec("UPDATE canonical_memory_authority_epochs SET provider_id='hindsight'");
    expect(() => value.maintenance.reinforce(input)).toThrow(/MEMORY_AUTHORITY_MISMATCH/);
    expect(() => value.maintenance.list({ epochId: value.epochId, characterId: "a" })).toThrow(/MEMORY_AUTHORITY_MISMATCH/);
    expect(() => value.maintenance.listRetention({ epochId: value.epochId })).toThrow(/MEMORY_AUTHORITY_MISMATCH/);
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it.each([
    "CREATE TRIGGER fail_policy BEFORE UPDATE ON canonical_memory_policy BEGIN SELECT RAISE(ABORT,'policy failed'); END",
    "CREATE TRIGGER fail_snapshot BEFORE INSERT ON canonical_memory_revision_snapshots BEGIN SELECT RAISE(ABORT,'snapshot failed'); END",
    "CREATE TRIGGER fail_receipt BEFORE INSERT ON canonical_memory_operation_receipts BEGIN SELECT RAISE(ABORT,'receipt failed'); END",
  ])("rolls unit, policy, FTS, snapshot and receipt back on a durable write failure", (sql) => {
    const value = fixture(); value.seed(); const before = canonicalMaintenanceRows(value.db); value.db.exec(sql);
    expect(() => value.maintenance.policyEdit({ ...request(value), patch: { importance: 8, disclosure: "new disclosure" } })).toThrow();
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it.each(["policy", "receipt"] as const)("rolls back an authority change occurring at the %s boundary", (boundary) => {
    const value = fixture(); value.seed(); const before = canonicalMaintenanceRows(value.db);
    value.db.exec(boundary === "policy" ? `CREATE TRIGGER change_authority AFTER UPDATE ON canonical_memory_policy
      BEGIN UPDATE canonical_memory_authority_epochs SET provider_id='hindsight'; END`
      : `CREATE TRIGGER change_authority AFTER INSERT ON canonical_memory_operation_receipts
        BEGIN UPDATE canonical_memory_authority_epochs SET provider_id='hindsight'; END`);
    expect(() => value.maintenance.policyEdit({ ...request(value), patch: { importance: 8 } })).toThrow(/MEMORY_AUTHORITY_MISMATCH/);
    expect(value.authority.activeEpoch().providerId).toBe("local");
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it.each(["receipt", "snapshot"] as const)("fails closed when a historical %s points at another canonical identity", (kind) => {
    const value = fixture(); value.seed(); value.seed({ memoryId: "other" });
    const input = { ...request(value), patch: { importance: 8 } };
    const changed = value.maintenance.policyEdit(input);
    if (kind === "receipt") {
      const receipt = { version: 1, kind: "policy-edit", result: { outcome: "applied", bankId: "global", memoryId: "other", revision: 1 } };
      value.db.prepare("UPDATE canonical_memory_operation_receipts SET result_json=:value WHERE request_id='change'")
        .run({ value: JSON.stringify(receipt) });
    } else {
      const record = { ...changed.record, unit: { ...changed.record.unit, memoryId: "other" },
        policy: { ...changed.record.policy, memoryId: "other" } };
      value.db.prepare("UPDATE canonical_memory_revision_snapshots SET record_json=:value WHERE memory_id='memory' AND revision=2")
        .run({ value: JSON.stringify(record) });
    }
    const before = canonicalMaintenanceRows(value.db);
    expect(() => value.maintenance.policyEdit(input)).toThrow(/MEMORY_INTEGRITY_ERROR/);
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it("rejects malformed policy/proof intents before a durable write", () => {
    const value = fixture(); value.seed(); const before = canonicalMaintenanceRows(value.db);
    expect(() => value.maintenance.policyEdit({ ...request(value), patch: { importance: 11 } })).toThrow(/MEMORY_INVALID_REQUEST/);
    expect(() => value.maintenance.reinforce({ ...request(value), mode: "duplicate-write", importance: 0 })).toThrow(/MEMORY_INVALID_REQUEST/);
    expect(() => value.maintenance.reinforce({ ...request(value, { expectedRevision: 0 }), mode: "tidy" })).toThrow(/MEMORY_INVALID_REQUEST/);
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it("rejects asynchronous transaction callbacks before dispatch and rolls back a returned promise", async () => {
    const value = fixture(); value.seed(); const before = canonicalMaintenanceRows(value.db); let dispatched = false;
    expect(() => value.maintenance.transaction(async () => {
      dispatched = true;
      await Promise.resolve();
      value.maintenance.policyEdit({ ...request(value), patch: { importance: 8 } });
    })).toThrow(/synchronous transaction required/);
    await Promise.resolve();
    expect(dispatched).toBe(false);
    expect(() => value.maintenance.transaction(() => {
      value.maintenance.policyEdit({ ...request(value), patch: { importance: 8 } });
      return Promise.resolve();
    })).toThrow(/synchronous transaction required/);
    expect(value.maintenance.transaction(() => ({ then: "ordinary JSON data" }))).toEqual({ then: "ordinary JSON data" });
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });
});
