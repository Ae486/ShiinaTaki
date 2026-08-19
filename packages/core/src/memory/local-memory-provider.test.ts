import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase } from "../db/sqlite.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import { createCanonicalMemorySparseRepo } from "../db/canonical-memory-sparse-repo.ts";
import { createIntlSegmenterTokenizer } from "./search-tokenizer.ts";
import { createLocalMemoryProvider } from "./local-memory-provider.ts";

describe("Local canonical provider", () => {
  it("retains structured data and rejects reflect without embeddings", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const authority = createCanonicalMemoryAuthorityRepo(db); const epoch = authority.initializeLocalAuthority(); authority.createBank({ authorityEpochId: epoch.epochId, bankId: "global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {} }); const provider = createLocalMemoryProvider({ authority, records: createCanonicalMemoryRepo(db), sparse: createCanonicalMemorySparseRepo(db), tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), now: () => "2026-08-19T00:00:00.000Z" });
    const provenance = { actor: "agent" as const, origin: "explicit-agent" as const, characterId: null, timelineFromSeq: null, timelineToSeq: null, capturedAt: "2026-08-19T00:00:00.000Z", sanitized: true as const, sourceRef: null };
    const request = { bankId: "global", content: "remember 拉面", context: null, timestamp: null, tags: [], entities: [], metadata: {}, observationScopes: null, documentId: null, strategy: null, updateMode: "replace" as const, provenance, policy: { layerId: "profile", importance: 8, visibility: "retrieved" as const, disclosure: null, origin: "self" as const, emotionalWeight: null, retention: { kind: "permanent" as const }, policyVersion: 1 } };
    const result = await provider.retain({ requestId: "r", authorityEpochId: epoch.epochId, actor: "foreground-agent" }, request); expect(result.ok).toBe(true); expect((await provider.capabilities()).vectorRetrieval).toBe("unavailable");
    const recalled = await provider.recall({ requestId: "q", authorityEpochId: epoch.epochId, actor: "foreground-agent" }, { bankId: "global", query: "拉面", queryTimestamp: null, budget: "low", limit: 5, maxTokens: 100, factTypes: ["experience"], layerIds: [], includeInvalidated: false });
    expect(recalled.ok).toBe(true); if (!recalled.ok) throw new Error("expected recall"); expect(recalled.data.returned).toBe(1);
    const memoryId = recalled.data.hits[0]!.record.unit.memoryId;
    db.exec("CREATE TRIGGER fail_mutation_receipt BEFORE INSERT ON canonical_memory_operation_receipts WHEN NEW.operation='edit' BEGIN SELECT RAISE(ABORT,'receipt failure'); END");
    const failed = await provider.mutate({ requestId: "edit-fail", authorityEpochId: epoch.epochId, actor: "foreground-agent" }, { kind: "edit", bankId: "global", memoryId, expectedRevision: 1, patch: { text: "changed" } });
    expect(failed.ok).toBe(false); expect(createCanonicalMemoryRepo(db).record(epoch.epochId, "global", memoryId)?.unit.revision).toBe(1);
    db.exec("DROP TRIGGER fail_mutation_receipt; DROP TABLE canonical_memory_fts");
    const failedFts = await provider.mutate({ requestId: "fts-fail", authorityEpochId: epoch.epochId, actor: "foreground-agent" }, { kind: "edit", bankId: "global", memoryId, expectedRevision: 1, patch: { text: "changed" } });
    expect(failedFts.ok).toBe(false); expect(createCanonicalMemoryRepo(db).record(epoch.epochId, "global", memoryId)?.unit.revision).toBe(1);
    const reflect = await provider.reflect({ requestId: "x", authorityEpochId: epoch.epochId, actor: "foreground-agent" }, { bankId: "global", query: "x", budget: "low", maxTokens: 100 }); expect(reflect.ok).toBe(false); db.close();
  });
  it("reclassifies an intention with a future default expiry", async () => {
    const at = "2026-08-19T00:00:00.000Z"; const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const authority = createCanonicalMemoryAuthorityRepo(db); const epoch = authority.initializeLocalAuthority(at);
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "character", scope: { kind: "character", characterId: "taki" }, name: "Taki", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {} });
    const provider = createLocalMemoryProvider({ authority, records: createCanonicalMemoryRepo(db), sparse: createCanonicalMemorySparseRepo(db), tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), now: () => at });
    const retained = await provider.retain({ requestId: "retain", authorityEpochId: epoch.epochId, actor: "foreground-agent" }, { bankId: "character", content: "future plan", context: null, timestamp: null, tags: [], entities: [], metadata: {}, observationScopes: null, documentId: null, strategy: null, updateMode: "replace", provenance: { actor: "agent", origin: "explicit-agent", characterId: "taki", timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true, sourceRef: null }, policy: { layerId: "episodes", importance: 5, visibility: "retrieved", disclosure: null, origin: "self", emotionalWeight: null, retention: { kind: "importance-decay", archiveBelowImportance: 4, afterDays: 90 }, policyVersion: 1 } });
    expect(retained.ok).toBe(true); if (!retained.ok) throw new Error("expected retain"); const memoryId = retained.data.memories[0]!.memoryId;
    const edited = await provider.mutate({ requestId: "edit", authorityEpochId: epoch.epochId, actor: "foreground-agent" }, { kind: "edit", bankId: "character", memoryId, expectedRevision: 1, patch: { layerId: "intentions" } });
    expect(edited.ok).toBe(true); if (!edited.ok) throw new Error("expected edit"); expect(edited.data.record.policy.retention).toEqual({ kind: "expiring", expiresAt: "2026-09-18T00:00:00.000Z" }); db.close();
  });
  it("keeps receipts content-free and enforces replay, conflict, CAS, lifecycle, and hard recall budget", async () => {
    const at = "2026-08-19T00:00:00.000Z"; const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const authority = createCanonicalMemoryAuthorityRepo(db); const epoch = authority.initializeLocalAuthority(at);
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {} });
    const records = createCanonicalMemoryRepo(db); const provider = createLocalMemoryProvider({ authority, records, sparse: createCanonicalMemorySparseRepo(db), tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), now: () => at });
    const request = { bankId: "global", content: "PRIVATE_MEMORY_BODY with enough words to exceed one token", context: null, timestamp: null, tags: ["taki-layer:wrong", "taki-layer:other"], entities: [], metadata: {}, observationScopes: null, documentId: null, strategy: null, updateMode: "replace" as const, provenance: { actor: "agent" as const, origin: "explicit-agent" as const, characterId: null, timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true as const, sourceRef: null }, policy: { layerId: "profile", importance: 5, visibility: "retrieved" as const, disclosure: null, origin: "self" as const, emotionalWeight: null, retention: { kind: "permanent" as const }, policyVersion: 1 } };
    const context = { requestId: "retain", authorityEpochId: epoch.epochId, actor: "foreground-agent" as const };
    const first = await provider.retain(context, request); expect(first.ok).toBe(true); if (!first.ok) throw new Error("expected retain"); const memoryId = first.data.memories[0]!.memoryId;
    const replay = await provider.retain(context, request); expect(replay).toEqual(first);
    const conflict = await provider.retain(context, { ...request, content: "different work" }); expect(conflict.ok).toBe(false); if (conflict.ok) throw new Error("expected conflict"); expect(conflict.error.code).toBe("MEMORY_REQUEST_ID_CONFLICT");
    const receipt = db.prepare("SELECT request_hash,result_json FROM canonical_memory_operation_receipts WHERE request_id='retain'").get(); expect(String(receipt?.request_hash)).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(receipt)).not.toContain("PRIVATE_MEMORY_BODY");
    expect(records.record(epoch.epochId, "global", memoryId)?.unit.tags).toEqual(["taki-layer:profile"]);
    const edited = await provider.mutate({ ...context, requestId: "edit" }, { kind: "edit", bankId: "global", memoryId, expectedRevision: 1, patch: { text: "edited body" } }); expect(edited.ok).toBe(true); if (!edited.ok) throw new Error("expected edit"); expect(edited.data.record.unit.revision).toBe(2);
    const editReplay = await provider.mutate({ ...context, requestId: "edit" }, { kind: "edit", bankId: "global", memoryId, expectedRevision: 1, patch: { text: "edited body" } }); expect(editReplay).toEqual(edited);
    const stale = await provider.mutate({ ...context, requestId: "stale" }, { kind: "edit", bankId: "global", memoryId, expectedRevision: 1, patch: { text: "stale body" } }); expect(stale.ok).toBe(false); if (stale.ok) throw new Error("expected stale"); expect(stale.error).toMatchObject({ code: "MEMORY_REVISION_MISMATCH", currentRevision: 2 }); expect(records.record(epoch.epochId, "global", memoryId)?.unit.text).toBe("edited body");
    const invalidated = await provider.mutate({ ...context, requestId: "invalidate" }, { kind: "invalidate", bankId: "global", memoryId, expectedRevision: 2, reason: "obsolete" }); expect(invalidated.ok).toBe(true); if (!invalidated.ok) throw new Error("expected invalidate"); expect(invalidated.data.record.unit.state).toBe("invalidated");
    const restored = await provider.mutate({ ...context, requestId: "restore" }, { kind: "restore", bankId: "global", memoryId, expectedRevision: 3 }); expect(restored.ok).toBe(true); if (!restored.ok) throw new Error("expected restore"); expect(restored.data.record.unit.state).toBe("valid");
    const recalled = await provider.recall({ ...context, requestId: "recall" }, { bankId: "global", query: "edited", queryTimestamp: null, budget: "low", limit: 10, maxTokens: 1, factTypes: ["experience"], layerIds: [], includeInvalidated: false }); expect(recalled.ok).toBe(true); if (!recalled.ok) throw new Error("expected recall"); expect(recalled.data).toMatchObject({ returned: 0, truncated: true }); db.close();
  });
  it("keeps sparse recall available when vector search fails", async () => {
    const at = "2026-08-19T00:00:00.000Z"; const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const authority = createCanonicalMemoryAuthorityRepo(db); const epoch = authority.initializeLocalAuthority(at);
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {} });
    const vector = { status: async () => "ready" as const, scheduleUpsert: () => undefined, scheduleDelete: () => undefined, search: async () => { throw new Error("vector down"); }, rebuild: async () => undefined };
    const provider = createLocalMemoryProvider({ authority, records: createCanonicalMemoryRepo(db), sparse: createCanonicalMemorySparseRepo(db), tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), vector, now: () => at });
    const provenance = { actor: "agent" as const, origin: "explicit-agent" as const, characterId: null, timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true as const, sourceRef: null };
    await provider.retain({ requestId: "retain", authorityEpochId: epoch.epochId, actor: "foreground-agent" }, { bankId: "global", content: "ramen memory", context: null, timestamp: null, tags: [], entities: [], metadata: {}, observationScopes: null, documentId: null, strategy: null, updateMode: "replace", provenance, policy: { layerId: "profile", importance: 5, visibility: "retrieved", disclosure: null, origin: "self", emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 1 } });
    const recalled = await provider.recall({ requestId: "recall", authorityEpochId: epoch.epochId, actor: "foreground-agent" }, { bankId: "global", query: "ramen", queryTimestamp: null, budget: "low", limit: 10, maxTokens: 100, factTypes: ["experience"], layerIds: [], includeInvalidated: false }); expect(recalled.ok).toBe(true); if (!recalled.ok) throw new Error("expected recall"); expect(recalled.data.returned).toBe(1); expect(recalled.data.vectorState).toBe("degraded"); db.close();
  });
});
