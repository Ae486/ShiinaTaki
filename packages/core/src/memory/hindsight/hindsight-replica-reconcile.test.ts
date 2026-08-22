import { describe, expect, it } from "vitest";
import type { HindsightLogicalSnapshotMetadata, HindsightLogicalSnapshotRecord } from "@taki/shared";
import { createHindsightReplicaRepo } from "../../db/hindsight-replica-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { reconcileHindsightReplica } from "./hindsight-replica-reconcile.ts";
import { snapshotManifestHash } from "./hindsight-snapshot-validator.ts";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";

const now = "2026-08-21T00:00:00.000Z";

describe("Hindsight replica reconciliation", () => {
  it("matches every imported document and fact revision against staging", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); seed(db);
    const staged = createHindsightReplicaRepo(db).stage({ runId: "run", replicaEpochId: "replica", ...fixture(), now });
    expect(reconcileHindsightReplica(db, { runId: "run", bankId: "bank", stagingId: staged.stagingId })).toEqual({
      sourceCount: 1, excludedCount: 0, factCount: 1, documentCount: 1,
    });
    db.prepare("UPDATE hindsight_import_facts SET revision=5 WHERE run_id='run' AND source_id='source'").run();
    expect(() => reconcileHindsightReplica(db, { runId: "run", bankId: "bank", stagingId: staged.stagingId }))
      .toThrow(/FACT_MAPPING_MISMATCH/);
    db.prepare("UPDATE hindsight_import_facts SET revision=4,payload_hash=:hash WHERE run_id='run' AND source_id='source'")
      .run({ hash: "e".repeat(64) });
    expect(() => reconcileHindsightReplica(db, { runId: "run", bankId: "bank", stagingId: staged.stagingId }))
      .toThrow(/FACT_MAPPING_MISMATCH/);
    db.close();
  });

  it("blocks unresolved imports before mapping comparison", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); seed(db);
    const staged = createHindsightReplicaRepo(db).stage({ runId: "run", replicaEpochId: "replica", ...fixture(), now });
    db.prepare("UPDATE hindsight_import_operations SET status='processing',mapping_complete=0 WHERE run_id='run'").run();
    expect(() => reconcileHindsightReplica(db, { runId: "run", bankId: "bank", stagingId: staged.stagingId }))
      .toThrow(/IMPORT_UNRESOLVED/);
    db.close();
  });
});

function seed(db: Database): void {
  db.prepare(`INSERT INTO memory_migration_runs (run_id,snapshot_id,phase,status,requested_at,updated_at,lease_fence)
    VALUES ('run','legacy','verified','ready',:now,:now,1)`).run({ now });
  db.prepare(`INSERT INTO memory_migration_sources
    (run_id,source_id,kind,relative_path,raw_sha256,byte_length,phase,disposition,result_count,updated_at)
    VALUES ('run','source','entry','memory/source.md',:hash,1,'verified','converted-one',1,:now)`)
    .run({ hash: "a".repeat(64), now });
  db.prepare(`INSERT INTO hindsight_import_operations
    (run_id,source_id,bank_id,document_id,operation_identity,remote_operation_id,content_identity,provider_content_hash,
     lease_fence,attempt_no,status,derived_unit_count,mapping_complete,updated_at)
    VALUES ('run','source','bank','document','operation','remote',:content,:hash,1,1,'mapped',1,1,:now)`)
    .run({ content: `sha256:${"b".repeat(64)}`, hash: "c".repeat(64), now });
  db.prepare(`INSERT INTO hindsight_import_facts (run_id,source_id,fact_ordinal,fact_id,revision,payload_hash)
    VALUES ('run','source',0,'fact',4,:hash)`).run({ hash: canonicalPayloadHash(memory().payload.value) });
}

function fixture() {
  const records = [document(), memory()]; const pageHash = "a".repeat(64);
  const metadata: HindsightLogicalSnapshotMetadata = { snapshotId: "33333333-3333-4333-8333-333333333333",
    manifest: { schemaVersion: 1, bankId: "bank", providerLineage: "11111111-1111-4111-8111-111111111111",
      bankGeneration: "22222222-2222-4222-8222-222222222222", endCursor: 4, pageSize: 2, totalPages: 1,
      totalRecords: 2, counts: { bank: 0, document: 1, memoryUnit: { valid: 1, invalidated: 0 }, mentalModel: 0,
        directive: 0, total: 2 }, pageHashes: [pageHash], manifestDigest: "a".repeat(64) }, createdAt: now,
    expiresAt: "2026-08-21T01:00:00.000Z" };
  metadata.manifest.manifestDigest = snapshotManifestHash(metadata);
  return { metadata, pages: [{ snapshotId: metadata.snapshotId, pageNumber: 0, totalPages: 1, recordCount: 2,
    contentHash: pageHash, records }] };
}
function document(): HindsightLogicalSnapshotRecord {
  return { objectKind: "document", objectId: "document", objectRevision: 2, payload: { kind: "document", value: {
    documentId: "document", bankId: "bank", contentHash: "a".repeat(64), tags: [], metadata: {}, observationScopes: null,
    createdAt: now, updatedAt: now,
  } } };
}
function memory(): HindsightLogicalSnapshotRecord {
  return { objectKind: "memory_unit", objectId: "fact", objectRevision: 4, payload: { kind: "memory_unit", value: {
    memoryId: "fact", bankId: "bank", documentId: "document", chunkId: null, text: "safe", context: null,
    factType: "world", state: "valid", revision: 4, tags: [], metadata: {}, entities: [], sourceMemoryIds: [],
    observationScopes: null, eventDate: null, occurredStart: null, occurredEnd: null, mentionedAt: null, createdAt: now,
    updatedAt: now, editedAt: null, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null,
    invalidatedAt: null, proofCount: 1,
  } } };
}
