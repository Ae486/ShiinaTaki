import { afterEach, describe, expect, it } from "vitest";
import type { CanonicalMemoryRecord, MemoryReplicaRecord } from "@taki/shared";
import { buildFtsQuery } from "../memory/fts5-query.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { createIntlSegmenterTokenizer, type SearchTokenizer } from "../memory/search-tokenizer.ts";
import { createReplicaRecordStore } from "./hindsight-replica-record-store.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const at = "2026-09-11T00:00:00.000Z";
const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const tokenizer = createIntlSegmenterTokenizer({ stoplist: true });
  return { db, tokenizer, store: createReplicaRecordStore(db, tokenizer) };
}

function memory(input: {
  id: string; revision?: number; text?: string;
  visibility?: CanonicalMemoryRecord["policy"]["visibility"];
  state?: CanonicalMemoryRecord["unit"]["state"];
}): MemoryReplicaRecord {
  const { id, revision = 1, state = "valid", visibility = "retrieved", text = "coffee" } = input;
  const record: CanonicalMemoryRecord = {
    unit: { authorityEpochId: "hindsight-authority", bankId: "global", memoryId: id, documentId: "document", chunkId: null,
      text, context: null, factType: "experience", state, revision, tags: ["taki-layer:episodes"],
      metadata: { native_detail: { preserved: true } }, entities: [], sourceMemoryIds: [], observationScopes: null,
      eventDate: null, occurredStart: null, occurredEnd: null, mentionedAt: at, createdAt: at, updatedAt: at,
      editedAt: null, consolidatedAt: null, consolidationFailedAt: null,
      invalidationReason: state === "invalidated" ? "obsolete" : null, invalidatedAt: state === "invalidated" ? at : null,
      proofCount: 1 },
    policy: { authorityEpochId: "hindsight-authority", bankId: "global", memoryId: id, layerId: "episodes", importance: 7,
      visibility, disclosure: null, origin: "self", emotionalWeight: null, retention: { kind: "permanent" },
      policyVersion: revision, updatedAt: at },
    provenance: { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: 1, timelineToSeq: 2,
      capturedAt: at, sanitized: true, sourceRef: "fixture-source" },
  };
  return { bankId: "global", objectKind: "memory_unit", objectId: id, objectRevision: revision,
    operation: "upsert", payload: { kind: "memory_unit", value: record } };
}

function logicalRows(db: Database) {
  return db.prepare("SELECT * FROM hindsight_replica_sync_records ORDER BY bank_id,object_kind,object_id").all();
}
function indexed(db: Database) {
  return db.prepare("SELECT object_id FROM hindsight_replica_sync_fts ORDER BY object_id").all().map((row) => row.object_id);
}

// Simulate the FTS projection left by an older build or a damaged cache. Logical records stay untouched.
function staleIndex(db: Database, tokenizer: SearchTokenizer, record: MemoryReplicaRecord) {
  if (record.payload?.kind !== "memory_unit") throw new Error("fixture memory missing");
  const { unit, policy } = record.payload.value;
  db.prepare("DELETE FROM hindsight_replica_sync_fts WHERE bank_id=:bank AND object_id=:id")
    .run({ bank: record.bankId, id: record.objectId });
  db.prepare(`INSERT INTO hindsight_replica_sync_fts (bank_id,object_id,text,context,disclosure,search_terms)
    VALUES (:bank,:id,:text,:context,:disclosure,:terms)`)
    .run({ bank: record.bankId, id: record.objectId, text: unit.text, context: unit.context, disclosure: policy.disclosure,
      terms: tokenizer.tokenize([unit.text, unit.context, policy.disclosure].filter((value) => value !== null).join(" ")).join(" ") });
}

describe("B5 replica hidden-memory search projection", () => {
  it("preserves hidden logical records, hashes and source cursors without indexing writes or replacements", () => {
    const f = fixture(); const hidden = memory({ id: "hidden", visibility: "hidden" });
    f.db.transaction(() => f.store.write(hidden, 9));
    expect(f.store.get({ bankId: "global", objectKind: "memory_unit", objectId: "hidden" })).toEqual(hidden);
    expect(logicalRows(f.db)[0]).toMatchObject({ record_hash: canonicalPayloadHash(hidden), source_cursor: 9,
      object_revision: 1, operation: "upsert" });
    expect(indexed(f.db)).toEqual([]);
    expect(f.store.search({ bankId: "global", query: "coffee", limit: 1 })).toEqual([]);

    const replacement = memory({ id: "hidden", revision: 2, visibility: "hidden", text: "corrected coffee preference" });
    f.db.transaction(() => f.store.replace(replacement, 10));
    expect(f.store.get({ bankId: "global", objectKind: "memory_unit", objectId: "hidden" })).toEqual(replacement);
    expect(logicalRows(f.db)[0]).toMatchObject({ record_hash: canonicalPayloadHash(replacement), source_cursor: 10,
      object_revision: 2, operation: "upsert" });
    expect(indexed(f.db)).toEqual([]);
  });

  describe.each(["hidden", "invalidated", "tombstone"] as const)("stale %s FTS rows", (excluded) => {
    it.each([
      { kind: "match", query: "coffee", hiddenText: "coffee", visibleText: "coffee with a longer explanation about a morning routine" },
      { kind: "like", query: "🙂", hiddenText: "🙂", visibleText: "a visible memory with 🙂" },
    ])("cannot crowd out a visible result at limit=1 through $kind", ({ kind, query, hiddenText, visibleText }) => {
      const f = fixture();
      const hidden = memory({ id: "a-hidden", text: hiddenText, visibility: excluded === "hidden" ? "hidden" : "retrieved",
        state: excluded === "invalidated" ? "invalidated" : "valid" });
      const visible = memory({ id: "z-visible", text: visibleText });
      const stored: MemoryReplicaRecord = excluded === "tombstone" ? { ...hidden, operation: "tombstone", payload: null } : hidden;
      f.db.transaction(() => { f.store.write(stored, 9); f.store.write(visible, 10); staleIndex(f.db, f.tokenizer, hidden); });

      const parsed = buildFtsQuery(f.tokenizer, query);
      expect(parsed.kind).toBe(kind);
      if (parsed.kind === "empty") throw new Error("fixture query missing");
      const where = parsed.kind === "match" ? "hindsight_replica_sync_fts MATCH :query" : "text LIKE :query";
      const order = parsed.kind === "match" ? "bm25(hindsight_replica_sync_fts,0,0,1,1,2,2),object_id" : "object_id";
      const first = f.db.prepare(`SELECT object_id FROM hindsight_replica_sync_fts WHERE ${where} ORDER BY ${order} LIMIT 1`)
        .get({ query: parsed.kind === "match" ? parsed.match : parsed.like });
      expect(first?.object_id).toBe("a-hidden");
      const before = logicalRows(f.db);
      expect(f.store.search({ bankId: "global", query, limit: 1 }).map((record) => record.unit.memoryId)).toEqual(["z-visible"]);
      expect(logicalRows(f.db)).toEqual(before);
      expect(f.store.get({ bankId: "global", objectKind: "memory_unit", objectId: "a-hidden",
        includeInvalidated: true, includeTombstones: true })).toEqual(stored);
    });
  });

  it("reconciles stale indexes to the same projection as incremental writes without changing logical evidence", () => {
    const f = fixture(); const fresh = fixture();
    const records = [memory({ id: "hidden", visibility: "hidden" }), memory({ id: "invalidated", state: "invalidated" }),
      memory({ id: "visible" })];
    f.db.transaction(() => { for (const record of records) f.store.write(record, 9); });
    const before = logicalRows(f.db); const digest = f.store.digest("global");
    staleIndex(f.db, f.tokenizer, records[0]!); staleIndex(f.db, f.tokenizer, records[1]!);
    f.db.prepare("DELETE FROM hindsight_replica_sync_fts WHERE object_id='visible'").run();

    f.db.transaction(() => f.store.reconcile("global", records));
    fresh.db.transaction(() => fresh.store.reconcile("global", records));
    expect(indexed(f.db)).toEqual(["visible"]);
    expect(f.db.prepare("SELECT * FROM hindsight_replica_sync_fts ORDER BY object_id").all())
      .toEqual(fresh.db.prepare("SELECT * FROM hindsight_replica_sync_fts ORDER BY object_id").all());
    expect(f.store.search({ bankId: "global", query: "coffee", limit: 1 }).map((record) => record.unit.memoryId)).toEqual(["visible"]);
    expect(logicalRows(f.db)).toEqual(before);
    expect(f.store.digest("global")).toBe(digest);
    expect(fresh.store.digest("global")).toBe(digest);
  });

  it.each(["pinned", "retrieved", "mood-gated"] as const)("restores valid %s visibility while invalidated records remain excluded", (visibility) => {
    const f = fixture(); const original = memory({ id: "valid" });
    f.db.transaction(() => f.store.write(original, 9));
    expect(indexed(f.db)).toEqual(["valid"]);
    f.db.transaction(() => {
      f.store.write(memory({ id: "valid", revision: 2, visibility: "hidden" }), 10);
      f.store.write(memory({ id: "invalidated", visibility: "hidden", state: "invalidated" }), 11);
    });
    expect(indexed(f.db)).toEqual([]);

    const restored = memory({ id: "valid", revision: 3, visibility });
    const invalidated = memory({ id: "invalidated", revision: 2, visibility, state: "invalidated" });
    f.db.transaction(() => { f.store.write(restored, 12); f.store.write(invalidated, 13); });
    expect(indexed(f.db)).toEqual(["valid"]);
    expect(f.store.search({ bankId: "global", query: "coffee", limit: 1 })).toEqual([restored.payload!.value]);
    expect(f.store.get({ bankId: "global", objectKind: "memory_unit", objectId: "invalidated" })).toBeUndefined();
    expect(f.store.get({ bankId: "global", objectKind: "memory_unit", objectId: "invalidated", includeInvalidated: true })).toEqual(invalidated);
    f.db.transaction(() => f.store.reconcile("global", [restored, invalidated]));
    expect(indexed(f.db)).toEqual(["valid"]);
    expect(f.store.get({ bankId: "global", objectKind: "memory_unit", objectId: "valid" })).toEqual(restored);
  });
});
