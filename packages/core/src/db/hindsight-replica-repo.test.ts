import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HindsightLogicalSnapshotMetadata, HindsightLogicalSnapshotRecord } from "@taki/shared";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createHindsightReplicaRepo } from "./hindsight-replica-repo.ts";
import { snapshotManifestHash } from "../memory/hindsight/hindsight-snapshot-validator.ts";

const roots: string[] = [];
const now = "2026-08-21T00:00:00.000Z";
const later = "2026-08-21T01:00:00.000Z";
const lineage = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const replicaEpoch = "55555555-5555-4555-8555-555555555555";
afterEach(() => { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); });

describe("Hindsight replica repository", () => {
  it("publishes records and checkpoint atomically, then survives reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-hindsight-replica-")); roots.push(root);
    const path = join(root, "workspace.db");
    const first = openDatabase({ path, migrations: MIGRATIONS }); seedRun(first);
    const repo = createHindsightReplicaRepo(first); const fixture = snapshot("33333333-3333-4333-8333-333333333333");
    const staged = repo.stage({ runId: "run", replicaEpochId: replicaEpoch, ...fixture, now });
    expect(staged).toMatchObject({ recordCount: 3, status: "verified" });
    expect(repo.checkpoint("bank")).toBeUndefined();
    expect(repo.publish({ stagingId: staged.stagingId, capturedAt: now, publishedAt: later })).toMatchObject({
      bankId: "bank", bankGeneration: generation, snapshotId: fixture.metadata.snapshotId, endCursor: 9,
    });
    expect(repo.visibleRecords("bank")).toHaveLength(3);
    first.close();
    const second = openDatabase({ path, migrations: MIGRATIONS });
    expect(createHindsightReplicaRepo(second).checkpoint("bank")).toMatchObject({ endCursor: 9, publishedAt: later });
    expect(createHindsightReplicaRepo(second).records(staged.stagingId)).toEqual([
      expect.objectContaining({ objectKind: "bank", objectRevision: 1 }),
      expect.objectContaining({ objectKind: "document", objectRevision: 2 }),
      expect.objectContaining({ objectKind: "memory_unit", objectRevision: 4 }),
    ]);
    second.close();
  });

  it("rolls back a failed batch and preserves the previous checkpoint", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); seedRun(db);
    const repo = createHindsightReplicaRepo(db); const initial = snapshot("33333333-3333-4333-8333-333333333333");
    const published = repo.stage({ runId: "run", replicaEpochId: replicaEpoch, ...initial, now });
    repo.publish({ stagingId: published.stagingId, capturedAt: now, publishedAt: later });
    const broken = snapshot("44444444-4444-4444-8444-444444444444");
    broken.pages[1]!.records = [broken.pages[0]!.records[0]!];
    broken.pages[1]!.recordCount = 1;
    expect(() => repo.stage({ runId: "run", replicaEpochId: "66666666-6666-4666-8666-666666666666", ...broken, now: later })).toThrow();
    expect(repo.checkpoint("bank")).toMatchObject({ snapshotId: initial.metadata.snapshotId, endCursor: 9 });
    expect(repo.visibleRecords("bank")).toHaveLength(3);
    expect(db.prepare("SELECT count(*) AS n FROM hindsight_replica_staging_runs").get()?.n).toBe(1);
    db.close();
  });

  it("refuses to republish a superseded staging epoch", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); seedRun(db);
    const secondPublishedAt = "2026-08-21T01:30:00.000Z";
    const repo = createHindsightReplicaRepo(db); const first = snapshot("33333333-3333-4333-8333-333333333333");
    const firstStaged = repo.stage({ runId: "run", replicaEpochId: replicaEpoch, ...first, now });
    repo.publish({ stagingId: firstStaged.stagingId, capturedAt: now, publishedAt: later });
    const second = snapshot("44444444-4444-4444-8444-444444444444");
    const secondStaged = repo.stage({ runId: "run", replicaEpochId: "66666666-6666-4666-8666-666666666666", ...second, now: later });
    repo.publish({ stagingId: secondStaged.stagingId, capturedAt: now, publishedAt: secondPublishedAt });
    expect(() => repo.publish({ stagingId: firstStaged.stagingId, capturedAt: now, publishedAt: later }))
      .toThrow("HINDSIGHT_CHECKPOINT_STALE");
    expect(repo.checkpoint("bank")?.snapshotId).toBe(second.metadata.snapshotId);
    db.close();
  });
});

function seedRun(db: Database): void {
  db.prepare(`INSERT INTO memory_migration_runs
    (run_id,snapshot_id,phase,status,requested_at,updated_at,lease_fence)
    VALUES ('run','legacy-snapshot','verified','ready',:now,:now,1)`).run({ now });
}

function snapshot(snapshotId: string) {
  const records = [bank(), document(), memory()];
  const split = [records.slice(0, 2), records.slice(2)];
  const hashes = ["a".repeat(64), "b".repeat(64)];
  const metadata: HindsightLogicalSnapshotMetadata = { snapshotId, manifest: {
    schemaVersion: 1, bankId: "bank", providerLineage: lineage, bankGeneration: generation, endCursor: 9,
    pageSize: 2, totalPages: 2, totalRecords: 3,
    counts: { bank: 1, document: 1, memoryUnit: { valid: 1, invalidated: 0 }, mentalModel: 0, directive: 0, total: 3 },
    pageHashes: hashes, manifestDigest: "a".repeat(64),
  }, createdAt: now, expiresAt: later };
  metadata.manifest.manifestDigest = snapshotManifestHash(metadata);
  const pages = split.map((items, pageNumber) => ({ snapshotId, pageNumber, totalPages: 2, recordCount: items.length,
    contentHash: hashes[pageNumber]!, records: items }));
  return { metadata, pages };
}

function bank(): HindsightLogicalSnapshotRecord {
  return { objectKind: "bank", objectId: "bank", objectRevision: 1, payload: { kind: "bank", value: {
    bankId: "bank", name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember",
    config: {}, createdAt: now, updatedAt: now,
  } } };
}
function document(): HindsightLogicalSnapshotRecord {
  return { objectKind: "document", objectId: "document", objectRevision: 2, payload: { kind: "document", value: {
    documentId: "document", bankId: "bank", contentHash: "a".repeat(64), tags: [], metadata: {}, observationScopes: null,
    createdAt: now, updatedAt: now,
  } } };
}
function memory(): HindsightLogicalSnapshotRecord {
  return { objectKind: "memory_unit", objectId: "fact", objectRevision: 4, payload: { kind: "memory_unit", value: {
    memoryId: "fact", bankId: "bank", documentId: "document", chunkId: null, text: "safe memory", context: null,
    factType: "world", state: "valid", revision: 4, tags: [], metadata: {}, entities: [], sourceMemoryIds: [],
    observationScopes: null, eventDate: null, occurredStart: null, occurredEnd: null, mentionedAt: null, createdAt: now,
    updatedAt: now, editedAt: null, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null,
    invalidatedAt: null, proofCount: 1,
  } } };
}
