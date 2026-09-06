import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CanonicalMemoryRecord, HindsightJournalPage, HindsightLogicalSnapshotRecord,
  HindsightLogicalSnapshotMetadata, MemoryReplicaJournalPage } from "@taki/shared";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";
import { snapshotManifestHash } from "../memory/hindsight/hindsight-snapshot-validator.ts";
import { projectHindsightJournal, type HindsightReplicaProjection } from "../memory/hindsight/hindsight-replica-projection.ts";
import { syncHindsightBankPage } from "../memory/hindsight/hindsight-incremental-sync.ts";
import { createHindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createHindsightReplicaSyncRepo } from "./hindsight-replica-sync-repo.ts";
import { createReplicaRecordStore } from "./hindsight-replica-record-store.ts";

const lineage = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const epoch = "hindsight-authority";
const at = "2026-09-05T00:00:00.000Z";
const later = "2026-09-05T00:01:00.000Z";
const expired = "2026-09-05T01:01:00.000Z";
const batchId = "33333333-3333-4333-8333-333333333333";
const snapshotId = "44444444-4444-4444-8444-444444444444";
const provenance = { actor: "user" as const, origin: "explicit-user" as const, characterId: null,
  timelineFromSeq: 1, timelineToSeq: 2, capturedAt: at, sanitized: true as const, sourceRef: "fixture-source" };
const dbs: Database[] = [];
const roots: string[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("B5 one-Bank snapshot-to-journal replica", () => {
  it("keeps a memory unit searchable when a document with the same ID is replaced", () => {
    const f = fixture();
    const source = f.repo.logicalRecord({ bankId: "global", objectKind: "document", objectId: "doc" });
    if (source?.payload?.kind !== "document") throw new Error("fixture source missing");
    const store = createReplicaRecordStore(f.db, createIntlSegmenterTokenizer({ stoplist: true }));
    store.replace({ ...source, objectId: "m1", payload: { kind: "document", value: { ...source.payload.value, documentId: "m1" } } }, null);
    expect(f.repo.search({ bankId: "global", query: "拉面", limit: 5 }).map((record) => record.unit.memoryId)).toContain("m1");
  });

  it("pulls one complete transaction after snapshot@8, updates canonical/FTS, and reads after reopen and snapshot expiry", async () => {
    const f = fixture(); const beforeAuthority = createCanonicalMemoryAuthorityRepo(f.db).initializeLocalAuthority(at);
    const calls: string[] = [];
    const client = createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "test-key",
      transport: async (url, init) => {
        calls.push(String(url)); expect(init?.headers).toMatchObject({ authorization: "Bearer test-key" });
        return { status: 200, body: JSON.stringify(wireJournal(journal())) };
      } });
    const applied = await syncHindsightBankPage({ client, repo: f.repo, lease: f.lease, projection,
      context: { timeoutMs: 1_000 } });
    expect(calls[0]).toContain("/changes?after_cursor=8&limit=500");
    expect(applied.checkpoint).toMatchObject({ endCursor: 10, snapshotCursor: 8, snapshotManifestDigest: f.snapshot.metadata.manifest.manifestDigest });
    expect(applied.checkpoint.manifestDigest).not.toBe(f.checkpoint.manifestDigest);
    expect(f.repo.search({ bankId: "global", query: "拉面", limit: 5 })).toEqual([]);
    expect(f.repo.search({ bankId: "global", query: "咖啡", limit: 5 })[0]?.unit.memoryId).toBe("m1");
    expect(f.repo.record({ bankId: "global", memoryId: "m2" })).toBeUndefined();
    expect(f.repo.logicalRecord({ bankId: "global", objectKind: "memory_unit", objectId: "m2", includeTombstones: true })?.operation).toBe("tombstone");
    expect(createCanonicalMemoryAuthorityRepo(f.db).activeEpoch()).toEqual(beforeAuthority);
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(0);
    f.db.close();
    const reopened = open(f.path); const repo = createRepo(reopened, () => expired);
    const record = repo.record({ bankId: "global", memoryId: "m1" });
    expect(record).toEqual(canonicalMemory("m1", 2, "咖啡计划"));
    expect(repo.checkpoint("global")).toEqual(applied.checkpoint);
    expect(repo.search({ bankId: "global", query: "咖啡", limit: 5 })).toHaveLength(1);
    expect(repo.logicalRecord({ bankId: "global", objectKind: "document", objectId: "doc" })?.payload)
      .toMatchObject({ kind: "document", value: { retainedText: "fixture source", provenance } });
  });

  it("rolls back canonical rows, FTS, and checkpoint when checkpoint publication fails", () => {
    const f = fixture();
    f.db.exec(`CREATE TRIGGER fail_replica_checkpoint BEFORE UPDATE ON hindsight_replica_sync_checkpoints
      BEGIN SELECT RAISE(ABORT, 'injected checkpoint failure'); END;`);
    expect(() => f.repo.applyPage({ page: page(), expectedCheckpoint: f.checkpoint, lease: f.lease })).toThrow("injected checkpoint failure");
    expect(f.repo.checkpoint("global")).toEqual(f.checkpoint);
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })).toEqual(canonicalMemory("m1", 1, "拉面计划"));
    expect(f.repo.record({ bankId: "global", memoryId: "m2" })).toBeDefined();
    expect(f.repo.search({ bankId: "global", query: "咖啡", limit: 5 })).toEqual([]);
    expect(f.repo.search({ bankId: "global", query: "拉面", limit: 5 })).toHaveLength(2);
    f.db.close();
    expect(createRepo(open(f.path), () => expired).checkpoint("global")).toEqual(f.checkpoint);
  });

  it("rejects forged leases, predecessor drift, wrong lineage/generation, and stale epoch", () => {
    const f = fixture();
    for (const lease of [{ ...f.lease, fence: f.lease.fence + 1 }, { ...f.lease, ownerId: "other" },
      { ...f.lease, runId: snapshotId }, { ...f.lease, expiresAt: expired }]) {
      expect(() => f.repo.applyPage({ page: page(), expectedCheckpoint: f.checkpoint, lease })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    }
    expect(() => f.repo.applyPage({ page: page(), expectedCheckpoint: { ...f.checkpoint, replicaEpochId: snapshotId }, lease: f.lease })).toThrow("HINDSIGHT_CHECKPOINT_STALE");
    const stalePage = { ...page(), predecessorCursor: 7, nextCursor: 7, currentCursor: 7, hasMore: false, records: [] };
    expect(() => f.repo.applyPage({ page: stalePage, expectedCheckpoint: f.checkpoint, lease: f.lease })).toThrow("HINDSIGHT_CHECKPOINT_STALE");
    for (const key of ["providerLineageId", "bankGeneration"] as const) {
      const changed = { ...page(), [key]: snapshotId, records: page().records.map((record) => ({ ...record, [key]: snapshotId })) };
      expect(() => f.repo.applyPage({ page: changed, expectedCheckpoint: f.checkpoint, lease: f.lease })).toThrow(/MISMATCH/);
    }
    const stale = projectHindsightJournal(journal(), { bankId: "global", authorityEpochId: "wrong", projection: {
      ...projection, memory: (record) => ({ ...projection.memory(record), policy: { ...projection.memory(record).policy, authorityEpochId: "wrong" } }),
    } });
    expect(() => f.repo.applyPage({ page: stale, expectedCheckpoint: f.checkpoint, lease: f.lease })).toThrow("HINDSIGHT_REPLICA_EPOCH_MISMATCH");
    expect(f.repo.checkpoint("global")).toEqual(f.checkpoint);
  });

  it("persists expired lease fencing and refuses the previous owner after restart", () => {
    const f = fixture(); f.db.close();
    const repo = createRepo(open(f.path), () => expired);
    expect(() => repo.applyPage({ page: page(), expectedCheckpoint: f.checkpoint, lease: f.lease })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    const replacement = repo.leases.acquire({ bankId: "global", ownerId: "new-process", durationMs: 60_000 });
    expect(replacement.fence).toBe(f.lease.fence + 1);
    expect(() => repo.applyPage({ page: page(), expectedCheckpoint: f.checkpoint, lease: f.lease })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(repo.applyPage({ page: page(), expectedCheckpoint: f.checkpoint, lease: replacement }).endCursor).toBe(10);
  });

  it("refuses stale/expired/tampered snapshot replacement while preserving the prior readable checkpoint", () => {
    const f = fixture();
    expect(() => f.repo.seedVerifiedSnapshot({ ...f.seed, expectedCheckpoint: null })).toThrow("HINDSIGHT_CHECKPOINT_STALE");
    expect(() => f.repo.seedVerifiedSnapshot({ ...f.seed, expectedCheckpoint: f.checkpoint, metadata: { ...f.seed.metadata,
      manifest: { ...f.seed.metadata.manifest, manifestDigest: "0".repeat(64) } } })).toThrow("HINDSIGHT_SNAPSHOT_MANIFEST_HASH_MISMATCH");
    f.setNow(expired);
    const lease = f.repo.leases.acquire({ bankId: "global", ownerId: "rebuild", durationMs: 60_000 });
    expect(() => f.repo.seedVerifiedSnapshot({ ...f.seed, expectedCheckpoint: f.checkpoint, lease })).toThrow("HINDSIGHT_SNAPSHOT_EXPIRED");
    expect(f.repo.checkpoint("global")).toEqual(f.checkpoint);
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })?.policy.layerId).toBe("episodes");
  });

  it("keeps invalidated records out of normal reads/FTS and accepts a caught-up empty page", () => {
    const f = fixture(); const value = page(); const upsert = value.records[0]!;
    if (upsert.payload?.kind !== "memory_unit") throw new Error("fixture invalid");
    upsert.payload.value.unit = { ...upsert.payload.value.unit, state: "invalidated", invalidatedAt: later, invalidationReason: "obsolete" };
    const checkpoint = f.repo.applyPage({ page: value, expectedCheckpoint: f.checkpoint, lease: f.lease });
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })).toBeUndefined();
    expect(f.repo.record({ bankId: "global", memoryId: "m1", includeInvalidated: true })?.unit.invalidationReason).toBe("obsolete");
    expect(f.repo.search({ bankId: "global", query: "咖啡", limit: 5 })).toEqual([]);
    const caughtUp = { ...value, records: [], predecessorCursor: 10 };
    expect(f.repo.applyPage({ page: caughtUp, expectedCheckpoint: checkpoint, lease: f.lease })).toEqual(checkpoint);
  });

  it("pulls a complete 501-record transaction beyond the requested 500-record soft limit", async () => {
    const f = fixture(); const value = journal(); const tombstone = value.changes[1]!;
    value.changes = Array.from({ length: 501 }, (_, index) => ({ ...tombstone, objectId: `retired-${index}`,
      cursor: 9 + index, batchIndex: index, batchSize: 501 }));
    value.nextCursor = 509; value.currentCursor = 509;
    const client = createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "test-key",
      transport: async () => ({ status: 200, body: JSON.stringify(wireJournal(value)) }) });
    const result = await syncHindsightBankPage({ client, repo: f.repo, lease: f.lease, projection, context: { timeoutMs: 1_000 } });
    expect(result.checkpoint.endCursor).toBe(509);
    expect(f.repo.logicalRecord({ bankId: "global", objectKind: "memory_unit", objectId: "retired-500", includeTombstones: true }))
      .toMatchObject({ operation: "tombstone", objectRevision: 2 });
  });

  it("leaves canonical rows, FTS, and checkpoint unchanged after transport and projection failures", async () => {
    const f = fixture(); const original = JSON.stringify(wireJournal(journal()));
    for (const response of [{ status: 401, body: "private auth details" }, { status: 409, body: "private cursor details" },
      { status: 200, body: original + " ".repeat(512 * 1024) }]) {
      const client = createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "test-key", transport: async () => response });
      await expect(syncHindsightBankPage({ client, repo: f.repo, lease: f.lease, projection, context: { timeoutMs: 1_000 } })).rejects.toThrow();
      expect(f.repo.checkpoint("global")).toEqual(f.checkpoint);
    }
    const client = createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "test-key",
      transport: async () => ({ status: 200, body: original }) });
    // @ts-expect-error Exercise an absent B4/B6 policy binding at the runtime validation boundary.
    const missingPolicy: HindsightReplicaProjection = { ...projection, memory: () => ({ provenance }) };
    await expect(syncHindsightBankPage({ client, repo: f.repo, lease: f.lease, projection: missingPolicy, context: { timeoutMs: 1_000 } })).rejects.toThrow();
    expect(f.repo.checkpoint("global")).toEqual(f.checkpoint);
    expect(f.repo.record({ bankId: "global", memoryId: "m1" })).toEqual(canonicalMemory("m1", 1, "拉面计划"));
    expect(f.repo.search({ bankId: "global", query: "咖啡", limit: 5 })).toEqual([]);
    expect(f.repo.search({ bankId: "global", query: "拉面", limit: 5 })).toHaveLength(2);
  });

  it("refuses cancellation and lease expiry while the HTTP response is in flight", async () => {
    for (const failure of ["cancel", "expiry"] as const) {
      const f = fixture(); const controller = new AbortController();
      const client = createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "test-key",
        transport: async () => {
          if (failure === "cancel") controller.abort(); else f.setNow(later);
          return { status: 200, body: JSON.stringify(wireJournal(journal())) };
        } });
      await expect(syncHindsightBankPage({ client, repo: f.repo, lease: f.lease, projection,
        context: { timeoutMs: 1_000, signal: controller.signal } }))
        .rejects.toThrow(failure === "cancel" ? "HINDSIGHT_CANCELLED" : "HINDSIGHT_REPLICA_LEASE_LOST");
      expect(f.repo.checkpoint("global")).toEqual(f.checkpoint);
      expect(f.repo.record({ bankId: "global", memoryId: "m1" })?.unit.revision).toBe(1);
    }
  });

  it("rejects an oversized complete canonical transaction without advancing its checkpoint", () => {
    const f = fixture(); const value = page(); const tombstone = value.records[1]!;
    value.records = Array.from({ length: 10_001 }, (_, index) => ({ ...tombstone, objectId: `retired-${index}`,
      cursor: 9 + index, batchIndex: index, batchSize: 10_001 }));
    value.nextCursor = 10_009; value.currentCursor = 10_009;
    expect(() => f.repo.applyPage({ page: value, expectedCheckpoint: f.checkpoint, lease: f.lease })).toThrow();
    expect(f.repo.checkpoint("global")).toEqual(f.checkpoint);
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_replica_sync_records").get()?.n).toBe(4);
  });

  it("preserves complete derived payloads and scoped JSON fields through journal application and reopen", () => {
    const f = fixture(); const value = journal(); const header = value.changes[0]!;
    const mentalModel = { mentalModelId: "mental", bankId: "global", subtype: "mental_model", name: "fixture model",
      sourceQuery: "fixture query", content: "fixture content", tags: [], maxTokens: 128,
      trigger: { source_query: "unchanged" }, lastRefreshedAt: later, createdAt: at,
      reflectResponse: { source_memory_ids: ["m1"] }, structuredContent: { fact_count: 1 } };
    const directive = { directiveId: "directive", bankId: "global", name: "fixture directive", content: "fixture content",
      priority: 1, isActive: false, tags: [], createdAt: at, updatedAt: later };
    value.changes = [
      { ...header, objectKind: "mental_model", objectId: "mental", objectRevision: 10, payload: { kind: "mental_model", value: mentalModel } },
      { ...header, objectKind: "directive", objectId: "directive", objectRevision: 11, cursor: 10, batchIndex: 1,
        payload: { kind: "directive", value: directive } },
    ];
    const checkpoint = f.repo.applyPage({ page: projectHindsightJournal(value, { bankId: "global", authorityEpochId: epoch, projection }),
      lease: f.lease, expectedCheckpoint: f.checkpoint });
    f.db.close(); const repo = createRepo(open(f.path), () => expired);
    expect(repo.checkpoint("global")).toEqual(checkpoint);
    expect(repo.logicalRecord({ bankId: "global", objectKind: "mental_model", objectId: "mental" })?.payload)
      .toEqual({ kind: "mental_model", value: { authorityEpochId: epoch, bankId: "global", objectRevision: 10, payload: { kind: "mental_model", ...mentalModel } } });
    expect(repo.logicalRecord({ bankId: "global", objectKind: "directive", objectId: "directive" })?.payload)
      .toEqual({ kind: "directive", value: { authorityEpochId: epoch, bankId: "global", objectRevision: 11, payload: { kind: "directive", ...directive } } });
  });

  it("refuses a rebuild with missing source provenance before changing the verified replica", () => {
    const f = fixture();
    // @ts-expect-error A provider document alone is insufficient to establish Taki source provenance.
    const missingSource: HindsightReplicaProjection = { ...projection, source: () => ({ retainedText: null, context: null }) };
    const repo = createHindsightReplicaSyncRepo({ db: f.db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }),
      now: () => at, projection: missingSource });
    expect(() => repo.seedVerifiedSnapshot({ ...f.seed, expectedCheckpoint: f.checkpoint })).toThrow();
    expect(repo.checkpoint("global")).toEqual(f.checkpoint);
    expect(repo.record({ bankId: "global", memoryId: "m1" })).toEqual(canonicalMemory("m1", 1, "拉面计划"));
  });
});

function open(path: string) { const db = openDatabase({ path, migrations: MIGRATIONS }); dbs.push(db); return db; }
function createRepo(db: Database, now: () => string) {
  return createHindsightReplicaSyncRepo({ db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), now, projection });
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "taki-b5-sync-")); roots.push(root);
  const path = join(root, "workspace.db"); const db = open(path); let time = at;
  const repo = createRepo(db, () => time); const lease = repo.leases.acquire({ bankId: "global", ownerId: "sync-owner", durationMs: 60_000 });
  const snapshot = snapshotFixture();
  const seed = { ...snapshot, authorityEpochId: epoch, expectedProviderLineageId: lineage, expectedBankGeneration: generation,
    expectedCheckpoint: null, lease };
  const checkpoint = repo.seedVerifiedSnapshot(seed);
  return { db, path, repo, lease, checkpoint, snapshot, seed, setNow: (value: string) => { time = value; } };
}

const projection: HindsightReplicaProjection = {
  bankScope: () => ({ kind: "global", characterId: null }),
  source: () => ({ retainedText: "fixture source", context: null, provenance }),
  memory: (record) => ({ policy: canonicalMemory(record.objectId, record.objectRevision, "unused").policy, provenance }),
};

function canonicalMemory(id: string, revision: number, text: string): CanonicalMemoryRecord {
  return { unit: { authorityEpochId: epoch, bankId: "global", memoryId: id, documentId: "doc", chunkId: null, text,
    context: "fixture context", factType: "experience", state: "valid", revision, tags: ["taki-layer:episodes"], metadata: {},
    entities: [], sourceMemoryIds: [], observationScopes: null, eventDate: null, occurredStart: null, occurredEnd: null,
    mentionedAt: at, createdAt: at, updatedAt: revision === 1 ? at : later, editedAt: null, consolidatedAt: null,
    consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 },
  policy: { authorityEpochId: epoch, bankId: "global", memoryId: id, layerId: "episodes", importance: 7,
    visibility: "retrieved", disclosure: "fixture disclosure", origin: "self", emotionalWeight: null,
    retention: { kind: "permanent" }, policyVersion: 1, updatedAt: at }, provenance };
}

function logicalMemory(id: string, revision: number, text: string): HindsightLogicalSnapshotRecord {
  const { authorityEpochId: _epoch, ...unit } = canonicalMemory(id, revision, text).unit;
  void _epoch;
  return { objectKind: "memory_unit", objectId: id, objectRevision: revision, payload: { kind: "memory_unit", value: unit } };
}
function snapshotFixture() {
  const records: HindsightLogicalSnapshotRecord[] = [
    { objectKind: "bank", objectId: "global", objectRevision: 1, payload: { kind: "bank", value: {
      bankId: "global", name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {}, createdAt: at, updatedAt: at } } },
    { objectKind: "document", objectId: "doc", objectRevision: 1, payload: { kind: "document", value: {
      documentId: "doc", bankId: "global", contentHash: "a".repeat(64), tags: [], metadata: {}, observationScopes: null, createdAt: at, updatedAt: at } } },
    logicalMemory("m1", 1, "拉面计划"), logicalMemory("m2", 1, "拉面经历"),
  ];
  const hash = "b".repeat(64);
  const metadata: HindsightLogicalSnapshotMetadata = { snapshotId, manifest: { schemaVersion: 1, bankId: "global",
    providerLineage: lineage, bankGeneration: generation, endCursor: 8, pageSize: 4, totalPages: 1, totalRecords: 4,
    counts: { bank: 1, document: 1, memoryUnit: { valid: 2, invalidated: 0 }, mentalModel: 0, directive: 0, total: 4 },
    pageHashes: [hash], manifestDigest: "c".repeat(64) }, createdAt: at, expiresAt: "2026-09-05T01:00:00.000Z" };
  metadata.manifest.manifestDigest = snapshotManifestHash(metadata);
  return { metadata, pages: [{ snapshotId, pageNumber: 0, totalPages: 1, recordCount: 4, contentHash: hash, records }] };
}

function journal(): HindsightJournalPage {
  const header = { providerLineageId: lineage, bankGeneration: generation, batchId, batchSize: 2, recordedAt: later };
  return { bankId: "global", providerLineageId: lineage, bankGeneration: generation, predecessorCursor: 8, nextCursor: 10,
    currentCursor: 10, minimumAvailableCursor: 0, hasMore: false, changes: [
      { ...header, ...logicalMemory("m1", 2, "咖啡计划"), operation: "upsert", cursor: 9, batchIndex: 0 },
      { ...header, objectKind: "memory_unit", objectId: "m2", objectRevision: 2, operation: "tombstone", payload: null, cursor: 10, batchIndex: 1 },
    ] };
}
function page(): MemoryReplicaJournalPage { return projectHindsightJournal(journal(), { bankId: "global", authorityEpochId: epoch, projection }); }
function wireJournal(value: HindsightJournalPage) {
  return { provider_lineage: value.providerLineageId, bank_generation: value.bankGeneration, from_cursor: value.predecessorCursor,
    next_cursor: value.nextCursor, current_cursor: value.currentCursor, minimum_available_cursor: value.minimumAvailableCursor, has_more: value.hasMore,
    changes: value.changes.map((change) => ({ cursor: change.cursor, provider_lineage: change.providerLineageId,
      bank_generation: change.bankGeneration, batch_id: change.batchId, batch_index: change.batchIndex, batch_size: change.batchSize,
      object_kind: change.objectKind, object_id: change.objectId, object_revision: change.objectRevision, operation: change.operation,
      payload: change.payload ? Object.fromEntries(Object.entries(change.payload.value).map(([key, item]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item])) : null,
      recorded_at: change.recordedAt })),
  };
}
