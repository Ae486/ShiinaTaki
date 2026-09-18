import { describe, expect, it } from "vitest";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import { createCanonicalMemorySparseRepo } from "./canonical-memory-sparse-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase } from "./sqlite.ts";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";
import { createCanonicalMaintenanceFixture } from "./canonical-memory-maintenance-fixtures.ts";
import { insertCanonicalUnitAndPolicy } from "./canonical-memory-maintenance-records.ts";

const at = "2026-08-19T00:00:00.000Z";
describe("canonical source-to-many repository", () => {
  it.each(["valid", "invalidated"] as const)("replays an unchanged lifecycle result for a source-free imported %s record", (state) => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const fixture = createCanonicalMaintenanceFixture(db);
      const imported = fixture.make({ unit: { documentId: null, factType: "observation", state,
        invalidationReason: state === "invalidated" ? "imported" : null,
        invalidatedAt: state === "invalidated" ? at : null } });
      insertCanonicalUnitAndPolicy(db, { unit: imported.unit, policy: imported.policy, searchTerms: "imported" });
      const request = { epochId: fixture.epochId, bankId: "global", memoryId: imported.unit.memoryId,
        expectedRevision: 1, requestId: "unchanged-import", requestHash: "a".repeat(64), now: at, searchTerms: "imported" };
      const mutate = () => state === "valid" ? fixture.records.restore(request)
        : fixture.records.invalidate({ ...request, reason: "imported" });
      expect(db.prepare("SELECT COUNT(*) AS n FROM canonical_memory_revision_snapshots").get()?.n).toBe(0);
      const first = mutate();
      expect(first.outcome).toBe("unchanged");
      expect(mutate()).toEqual(first);
      fixture.records.edit({ ...request, requestId: "later-edit", requestHash: "b".repeat(64), patch: { text: "A later revision." } });
      expect(mutate()).toEqual(first);
      expect(fixture.records.record(fixture.epochId, "global", imported.unit.memoryId)?.unit.revision).toBe(2);
    } finally { db.close(); }
  });

  it("rolls a newly captured unchanged-result snapshot back when its receipt cannot commit", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const fixture = createCanonicalMaintenanceFixture(db);
      const imported = fixture.make({ unit: { documentId: null, factType: "observation" } });
      insertCanonicalUnitAndPolicy(db, { unit: imported.unit, policy: imported.policy, searchTerms: "imported" });
      const request = { epochId: fixture.epochId, bankId: "global", memoryId: imported.unit.memoryId,
        expectedRevision: 1, requestId: "unchanged-import", requestHash: "a".repeat(64), now: at, searchTerms: "imported" };
      db.exec("CREATE TRIGGER refuse_unchanged_receipt BEFORE INSERT ON canonical_memory_operation_receipts BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END");
      expect(() => fixture.records.restore(request)).toThrow("fixture receipt failure");
      expect(db.prepare("SELECT COUNT(*) AS n FROM canonical_memory_revision_snapshots").get()?.n).toBe(0);
      expect(fixture.records.receipt(fixture.epochId, request.requestId)).toBeUndefined();
      db.exec("DROP TRIGGER refuse_unchanged_receipt");
      const result = fixture.records.restore(request);
      expect(fixture.records.restore(request)).toEqual(result);
    } finally { db.close(); }
  });

  it("atomically stores two units, policies, FTS rows, and deterministic sparse ties", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const authority = createCanonicalMemoryAuthorityRepo(db); const epoch = authority.initializeLocalAuthority(at);
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {} });
    const provenance = { actor: "agent" as const, origin: "explicit-agent" as const, characterId: null, timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true as const, sourceRef: null };
    const source = { authorityEpochId: epoch.epochId, bankId: "global", documentId: "doc", contentHash: null, retainedText: "same terms", context: null, tags: [], metadata: {}, observationScopes: null, provenance, revision: 1, createdAt: at, updatedAt: at };
    const unit = (memoryId: string, sourceMemoryIds: string[] = []) => ({ authorityEpochId: epoch.epochId, bankId: "global", memoryId, documentId: "doc", chunkId: null, text: "same terms", context: null, factType: "experience" as const, state: "valid" as const, revision: 1, tags: ["taki-layer:profile"], metadata: {}, entities: [], sourceMemoryIds, observationScopes: null, eventDate: at, occurredStart: null, occurredEnd: null, mentionedAt: at, createdAt: at, updatedAt: at, editedAt: null, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 });
    const policy = (memoryId: string) => ({ authorityEpochId: epoch.epochId, bankId: "global", memoryId, layerId: "profile", importance: 5, visibility: "retrieved" as const, disclosure: null, origin: "self" as const, emotionalWeight: null, retention: { kind: "permanent" as const }, policyVersion: 1, updatedAt: at });
    const repo = createCanonicalMemoryRepo(db); const result = repo.retain({ epochId: epoch.epochId, bankId: "global", requestId: "many", requestHash: "a".repeat(64), source, units: ["b", "a"].map((id) => ({ unit: unit(id, id === "b" ? ["a"] : []), policy: policy(id), searchTerms: "same terms" })) });
    expect(result.memories).toHaveLength(2); expect(repo.record(epoch.epochId, "global", "a")?.policy.memoryId).toBe("a"); expect(repo.record(epoch.epochId, "global", "b")?.unit.sourceMemoryIds).toEqual(["a"]); expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(2);
    db.exec("CREATE TRIGGER fail_second_policy BEFORE INSERT ON canonical_memory_policy WHEN NEW.memory_id='d' BEGIN SELECT RAISE(ABORT,'policy failure'); END");
    const secondSource = { ...source, documentId: "doc2" }; expect(() => repo.retain({ epochId: epoch.epochId, bankId: "global", requestId: "rollback", requestHash: "b".repeat(64), source: secondSource, units: ["c", "d"].map((id) => ({ unit: { ...unit(id), documentId: "doc2" }, policy: policy(id), searchTerms: "same terms" })) })).toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_sources").get()?.n).toBe(1); expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(2); expect(repo.receipt(epoch.epochId, "rollback")).toBeUndefined();
    const rows = createCanonicalMemorySparseRepo(db).search({ bankId: "global", query: "same", queryTimestamp: null, budget: "low", limit: 10, maxTokens: 100, factTypes: ["experience"], layerIds: ["profile"], includeInvalidated: false }, createIntlSegmenterTokenizer({ stoplist: true }), epoch.epochId);
    expect(rows.map((row) => row.memoryId)).toEqual(["a", "b"]); db.close();
  });
});
