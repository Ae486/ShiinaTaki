import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase } from "./sqlite.ts";
import { createCanonicalMemorySparseRepo } from "./canonical-memory-sparse-repo.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";
import { createCanonicalMaintenanceFixture } from "./canonical-memory-maintenance-fixtures.ts";

describe("canonical sparse repository", () => {
  it("keeps projections rebuildable and refuses orphan or invalidated units", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const repo = createCanonicalMemorySparseRepo(db);
    repo.upsert({ epochId: "missing", bankId: "missing", memoryId: "missing", text: "拉面", context: null, searchTerms: "拉面" });
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(0);
    const value = createCanonicalMaintenanceFixture(db); value.seed({ unit: { text: "拉面", context: null } });
    const projection = { epochId: value.epochId, bankId: "global", memoryId: "memory", text: "拉面", context: null, searchTerms: "拉面" };
    repo.upsert(projection);
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(1);
    repo.remove(projection);
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(0);
    repo.rebuild(value.epochId, value.tokenizer);
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(1);
    value.maintenance.invalidate({ ...projection, characterId: null, requestId: "invalidate", expectedRevision: 1,
      now: "2026-02-01T00:00:00.000Z", reason: null });
    repo.upsert(projection);
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(0);
    db.close();
  });
  it("filters before limit, deduplicates upserts, and preserves CJK results after rebuild", () => {
    const at = "2026-08-19T00:00:00.000Z"; const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const authority = createCanonicalMemoryAuthorityRepo(db); const epoch = authority.initializeLocalAuthority(at);
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {} });
    const provenance = { actor: "agent" as const, origin: "explicit-agent" as const, characterId: null, timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true as const, sourceRef: null };
    const records = createCanonicalMemoryRepo(db); const tokenizer = createIntlSegmenterTokenizer({ stoplist: true });
    for (const [memoryId, layerId] of [["profile", "profile"], ["activity", "activity"]] as const) {
      const documentId = `doc-${memoryId}`; const text = `same 豚骨拉面 ${memoryId}`;
      const source = { authorityEpochId: epoch.epochId, bankId: "global", documentId, contentHash: null, retainedText: text, context: null, tags: [], metadata: {}, observationScopes: null, provenance, revision: 1, createdAt: at, updatedAt: at };
      const unit = { authorityEpochId: epoch.epochId, bankId: "global", memoryId, documentId, chunkId: null, text, context: null, factType: "experience" as const, state: "valid" as const, revision: 1, tags: [`taki-layer:${layerId}`], metadata: {}, entities: [], sourceMemoryIds: [], observationScopes: null, eventDate: at, occurredStart: null, occurredEnd: null, mentionedAt: at, createdAt: at, updatedAt: at, editedAt: null, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 };
      const policy = { authorityEpochId: epoch.epochId, bankId: "global", memoryId, layerId, importance: layerId === "profile" ? 10 : 1, visibility: "retrieved" as const, disclosure: "面馆", origin: "self" as const, emotionalWeight: null, retention: layerId === "profile" ? { kind: "permanent" as const } : { kind: "rolling-window" as const, days: 30 }, policyVersion: 1, updatedAt: at };
      records.retain({ epochId: epoch.epochId, bankId: "global", requestId: memoryId, requestHash: memoryId === "profile" ? "a".repeat(64) : "b".repeat(64), source, unit, policy, searchTerms: tokenizer.tokenize(`${text} 面馆`).join(" ") });
    }
    const sparse = createCanonicalMemorySparseRepo(db); const request = { bankId: "global", query: "拉面", queryTimestamp: null, budget: "low" as const, limit: 1, maxTokens: 100, factTypes: ["experience" as const], layerIds: ["activity"], includeInvalidated: false as const };
    expect(sparse.search(request, tokenizer, epoch.epochId).map((row) => row.memoryId)).toEqual(["activity"]);
    sparse.upsert({ epochId: epoch.epochId, bankId: "global", memoryId: "activity", text: "same 豚骨拉面 activity", context: null, searchTerms: "拉面" });
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_fts WHERE memory_id='activity'").get()?.n).toBe(1);
    sparse.rebuild(epoch.epochId, tokenizer);
    expect(sparse.search(request, tokenizer, epoch.epochId).map((row) => row.memoryId)).toEqual(["activity"]); db.close();
  });
});
