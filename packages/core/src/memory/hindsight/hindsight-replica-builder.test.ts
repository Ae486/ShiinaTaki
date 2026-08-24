import { describe, expect, it, vi } from "vitest";
import type { HindsightLogicalSnapshotMetadata, HindsightLogicalSnapshotRecord } from "@taki/shared";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createHindsightReplicaRepo } from "../../db/hindsight-replica-repo.ts";
import { openDatabase } from "../../db/sqlite.ts";
import type { HindsightClient } from "./hindsight-client.ts";
import { buildHindsightReplica } from "./hindsight-replica-builder.ts";
import { snapshotManifestHash } from "./hindsight-snapshot-validator.ts";

const now = "2026-08-21T00:00:00.000Z";
const later = "2026-08-21T01:00:00.000Z";
const lineage = "11111111-1111-4111-8111-111111111111";

describe("Hindsight replica builder", () => {
  it("reads the immutable manifest and every page before publishing the checkpoint", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); seedRun(db);
    const repo = createHindsightReplicaRepo(db); const data = fixture();
    const logicalSnapshotPage = vi.fn(async () => data.page);
    const client = fakeClient({ createLogicalSnapshot: vi.fn(async () => data.metadata),
      logicalSnapshot: vi.fn(async () => structuredClone(data.metadata)), logicalSnapshotPage });
    await expect(buildHindsightReplica({ client, repo, runId: "run", bankId: "bank", providerLineage: lineage,
      pageSize: 1, ttlSeconds: 60, reconcile: vi.fn(), now: () => now })).resolves.toMatchObject({ checkpoint: { endCursor: 4 } });
    expect(logicalSnapshotPage).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 0, snapshotId: data.metadata.snapshotId }));
    db.close();
  });

  it("refuses changed manifests and page failures without a checkpoint", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); seedRun(db);
    const repo = createHindsightReplicaRepo(db); const data = fixture();
    const changed = structuredClone(data.metadata); changed.manifest.endCursor = 5;
    await expect(buildHindsightReplica({ client: fakeClient({ createLogicalSnapshot: async () => data.metadata,
      logicalSnapshot: async () => changed, logicalSnapshotPage: async () => data.page }), repo, runId: "run",
      bankId: "bank", providerLineage: lineage, pageSize: 1, ttlSeconds: 60, reconcile: vi.fn(), now: () => now })).rejects.toThrow(/MANIFEST_CHANGED/);
    expect(repo.checkpoint("bank")).toBeUndefined();
    await expect(buildHindsightReplica({ client: fakeClient({ createLogicalSnapshot: async () => data.metadata,
      logicalSnapshot: async () => data.metadata, logicalSnapshotPage: async () => { throw new Error("HINDSIGHT_CURSOR_RESET_REQUIRED"); } }),
      repo, runId: "run", bankId: "bank", providerLineage: lineage, pageSize: 1, ttlSeconds: 60, reconcile: vi.fn(), now: () => now }))
      .rejects.toThrow(/CURSOR_RESET_REQUIRED/);
    expect(repo.checkpoint("bank")).toBeUndefined();
    db.close();
  });
});

function fakeClient(snapshot: Pick<HindsightClient, "createLogicalSnapshot" | "logicalSnapshot" | "logicalSnapshotPage">): HindsightClient {
  return snapshot as HindsightClient;
}
function seedRun(db: ReturnType<typeof openDatabase>): void {
  db.prepare(`INSERT INTO memory_migration_runs (run_id,snapshot_id,phase,status,requested_at,updated_at,lease_fence)
    VALUES ('run','legacy','verified','ready',:now,:now,1)`).run({ now });
}
function fixture() {
  const record: HindsightLogicalSnapshotRecord = { objectKind: "bank", objectId: "bank", objectRevision: 1,
    payload: { kind: "bank", value: { bankId: "bank", name: "Global",
      disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {},
      createdAt: now, updatedAt: now } } };
  const pageHash = "a".repeat(64);
  const metadata: HindsightLogicalSnapshotMetadata = { snapshotId: "33333333-3333-4333-8333-333333333333",
    manifest: { schemaVersion: 1, bankId: "bank", providerLineage: lineage,
      bankGeneration: "22222222-2222-4222-8222-222222222222", endCursor: 4, pageSize: 1, totalPages: 1,
      totalRecords: 1, counts: { bank: 1, document: 0, memoryUnit: { valid: 0, invalidated: 0 }, mentalModel: 0,
        directive: 0, total: 1 }, pageHashes: [pageHash], manifestDigest: "a".repeat(64) }, createdAt: now, expiresAt: later };
  metadata.manifest.manifestDigest = snapshotManifestHash(metadata);
  return { metadata, page: { snapshotId: metadata.snapshotId, pageNumber: 0, totalPages: 1, recordCount: 1,
    contentHash: pageHash, records: [record] } };
}
