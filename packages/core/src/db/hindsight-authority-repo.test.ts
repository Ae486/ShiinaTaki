import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HindsightLogicalSnapshotMetadata, HindsightLogicalSnapshotRecord } from "@taki/shared";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createHindsightCutoverRunRepo } from "./hindsight-cutover-run-repo.ts";
import { hindsightCheckpointSetDigest, promoteHindsightAuthority, type HindsightPromotionInput } from "./hindsight-authority-repo.ts";
import { createHindsightReplicaRepo } from "./hindsight-replica-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { readMemoryAuthoritySelection } from "../memory/legacy-migration/legacy-activation-repo.ts";
import { snapshotManifestHash } from "../memory/hindsight/hindsight-snapshot-validator.ts";

const now = "2026-08-22T00:00:00.000Z";
const later = "2026-08-22T01:00:00.000Z";
const lineage = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const replicaEpoch = "33333333-3333-4333-8333-333333333333";
const snapshotId = "44444444-4444-4444-8444-444444444444";
const config = "a".repeat(64);
const template = "b".repeat(64);
const roots: string[] = [];

afterEach(() => { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); });

describe("Hindsight authority promotion repository", () => {
  it("exposes bounded status and refuses a stale expected predecessor without mutation", () => {
    const fixture = setup(openDatabase({ path: ":memory:", migrations: MIGRATIONS }));
    const runs = createHindsightCutoverRunRepo(fixture.db);
    expect(runs.status("run")).toMatchObject({ runId: "run", phase: "ready", sourceCount: 1, checkpointCount: 1, authority: { mode: "canonical-local" } });
    expect(runs.verify({ runId: "run", expectedRevision: 0, expectedEpochId: "wrong" })).toMatchObject({ eligible: false, blockingCodes: ["HINDSIGHT_PREDECESSOR_STALE"] });
    expect(runs.verify({ runId: "run", expectedRevision: 1, expectedEpochId: fixture.input.predecessorEpochId }))
      .toMatchObject({ eligible: false, blockingCodes: ["HINDSIGHT_STATE_CONFLICT"] });
    expect(readMemoryAuthoritySelection(fixture.db)).toMatchObject({ mode: "canonical-local" });
    fixture.db.close();
  });

  it("counts durable B2 exclusions without requiring synthetic Hindsight operation rows", () => {
    const fixture = setup(openDatabase({ path: ":memory:", migrations: MIGRATIONS }));
    fixture.db.prepare(`INSERT INTO memory_migration_sources
      (run_id,source_id,kind,relative_path,raw_sha256,byte_length,phase,disposition,result_count,updated_at)
      VALUES ('run','excluded-source','entry','memory/excluded.md',:hash,1,'verified','excluded',0,:now)`)
      .run({ hash: "f".repeat(64), now });
    const runs = createHindsightCutoverRunRepo(fixture.db);
    expect(runs.status("run")).toMatchObject({ sourceCount: 2, operationCounts: { mapped: 1, excluded: 1 } });
    expect(runs.verify({ runId: "run", expectedRevision: 0, expectedEpochId: fixture.input.predecessorEpochId }))
      .toMatchObject({ eligible: true, blockingCodes: [] });
    fixture.db.close();
  });

  it("commits one Hindsight epoch and receipt, then survives reopen with exactly one active epoch", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-hindsight-authority-")); roots.push(root);
    const path = join(root, "workspace.db"); const fixture = setup(openDatabase({ path, migrations: MIGRATIONS }));
    const result = promoteHindsightAuthority(fixture.db, fixture.input);
    expect(result.selection).toMatchObject({ mode: "hindsight", epochId: fixture.input.hindsightEpochId });
    expect(fixture.db.prepare("SELECT count(*) AS n FROM canonical_memory_authority_epochs WHERE status='active'").get()?.n).toBe(1);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(1);
    expect(fixture.db.prepare("SELECT phase,status,lease_owner FROM hindsight_cutover_runs WHERE run_id='run'").get())
      .toMatchObject({ phase: "activated", status: "completed", lease_owner: null });
    fixture.db.close();
    const reopened = openDatabase({ path, migrations: MIGRATIONS });
    expect(readMemoryAuthoritySelection(reopened)).toMatchObject({ mode: "hindsight", epochId: fixture.input.hindsightEpochId });
    expect(reopened.prepare("SELECT count(*) AS n FROM canonical_memory_authority_epochs WHERE status='active'").get()?.n).toBe(1);
    reopened.close();
  });

  it.each([
    ["unresolved mapping", (db: Database) => db.prepare("UPDATE hindsight_import_operations SET status='processing' WHERE run_id='run'").run(), "HINDSIGHT_IMPORT_UNRESOLVED"],
    ["stale manifest", (db: Database) => db.prepare("UPDATE hindsight_replica_staging_runs SET manifest_digest=:digest WHERE staging_id=(SELECT staging_id FROM hindsight_replica_checkpoints WHERE bank_id='bank')").run({ digest: "c".repeat(64) }), "HINDSIGHT_MANIFEST_STALE"],
    ["expired checkpoint", (db: Database) => db.prepare("UPDATE hindsight_replica_checkpoints SET snapshot_expires_at=:now WHERE bank_id='bank'").run({ now }), "HINDSIGHT_CHECKPOINT_STALE"],
    ["missing checkpoint", (db: Database) => db.prepare("DELETE FROM hindsight_replica_checkpoints WHERE bank_id='bank'").run(), "HINDSIGHT_CHECKPOINT_MISSING"],
    ["stale mapping", (db: Database) => db.prepare("UPDATE hindsight_import_facts SET payload_hash=:hash WHERE run_id='run'").run({ hash: "0".repeat(64) }), "HINDSIGHT_MAPPING_UNVERIFIED"],
    ["lost fence", (db: Database) => db.prepare("UPDATE hindsight_cutover_runs SET lease_fence=lease_fence+1 WHERE run_id='run'").run(), "LEASE_LOST"],
  ])("refuses %s without changing canonical Local authority", (_name, mutate, code) => {
    const fixture = setup(openDatabase({ path: ":memory:", migrations: MIGRATIONS })); mutate(fixture.db);
    expect(() => promoteHindsightAuthority(fixture.db, fixture.input)).toThrow(code);
    expect(readMemoryAuthoritySelection(fixture.db)).toMatchObject({ mode: "canonical-local", epochId: fixture.input.predecessorEpochId });
    expect(fixture.db.prepare("SELECT status FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: fixture.input.predecessorEpochId })?.status).toBe("active");
    fixture.db.close();
  });

  it("rolls back an insertion conflict after closing the predecessor in the transaction", () => {
    const fixture = setup(openDatabase({ path: ":memory:", migrations: MIGRATIONS }));
    const conflicting = { ...fixture.input, hindsightEpochId: fixture.input.predecessorEpochId };
    expect(() => promoteHindsightAuthority(fixture.db, conflicting)).toThrow("HINDSIGHT_PROMOTION_CONFLICT");
    expect(readMemoryAuthoritySelection(fixture.db)).toMatchObject({ mode: "canonical-local", epochId: fixture.input.predecessorEpochId });
    expect(fixture.db.prepare("SELECT status FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: fixture.input.predecessorEpochId })?.status).toBe("active");
    fixture.db.close();
  });

  it("rejects a stale expected Local predecessor before authority mutation", () => {
    const fixture = setup(openDatabase({ path: ":memory:", migrations: MIGRATIONS }));
    expect(() => promoteHindsightAuthority(fixture.db, { ...fixture.input, predecessorEpochId: "wrong-predecessor" })).toThrow("HINDSIGHT_PREDECESSOR_STALE");
    expect(readMemoryAuthoritySelection(fixture.db)).toMatchObject({ mode: "canonical-local", epochId: fixture.input.predecessorEpochId });
    fixture.db.close();
  });

  it("rejects promotion when the active predecessor is no longer a Local authority epoch", () => {
    const fixture = setup(openDatabase({ path: ":memory:", migrations: MIGRATIONS }));
    fixture.db.prepare("UPDATE canonical_memory_authority_epochs SET provider_id='hindsight' WHERE epoch_id=:epoch")
      .run({ epoch: fixture.input.predecessorEpochId });
    expect(() => promoteHindsightAuthority(fixture.db, fixture.input)).toThrow("HINDSIGHT_PREDECESSOR_STALE");
    expect(fixture.db.prepare("SELECT status FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch")
      .get({ epoch: fixture.input.predecessorEpochId })?.status).toBe("active");
    expect(fixture.db.prepare("SELECT mode,active_epoch_id FROM memory_authority_selection WHERE singleton=1").get())
      .toMatchObject({ mode: "canonical-local", active_epoch_id: fixture.input.predecessorEpochId });
    fixture.db.close();
  });

  it("rejects a published checkpoint staged by a different cutover run", () => {
    const fixture = setup(openDatabase({ path: ":memory:", migrations: MIGRATIONS }));
    fixture.db.prepare(`INSERT INTO memory_migration_runs
      (run_id,snapshot_id,epoch_id,phase,status,requested_at,updated_at,lease_fence,activation_transaction_id)
      VALUES ('foreign-run','foreign-snapshot',:epoch,'activated','completed',:now,:now,1,'foreign-tx')`)
      .run({ epoch: fixture.input.predecessorEpochId, now });
    fixture.db.prepare("UPDATE hindsight_replica_staging_runs SET run_id='foreign-run' WHERE staging_id=(SELECT staging_id FROM hindsight_replica_checkpoints WHERE bank_id='bank')").run();
    expect(() => promoteHindsightAuthority(fixture.db, fixture.input)).toThrow("HINDSIGHT_MANIFEST_STALE");
    expect(readMemoryAuthoritySelection(fixture.db)).toMatchObject({ mode: "canonical-local", epochId: fixture.input.predecessorEpochId });
    fixture.db.close();
  });

  it("fails closed on reopen when the committed activation receipt is missing", () => {
    const fixture = setup(openDatabase({ path: ":memory:", migrations: MIGRATIONS }));
    promoteHindsightAuthority(fixture.db, fixture.input);
    fixture.db.exec("DELETE FROM hindsight_authority_activation_receipts");
    expect(() => readMemoryAuthoritySelection(fixture.db)).toThrow("MEMORY_INTEGRITY_ERROR");
    fixture.db.close();
  });
});

function setup(db: Database): { db: Database; input: HindsightPromotionInput } {
  const authority = createCanonicalMemoryAuthorityRepo(db); const predecessor = authority.initializeLocalAuthority(now);
  seedCompletedB2(db, predecessor.epochId); seedConnectionAndBank(db);
  const checkpoint = seedReplica(db); seedMapping(db);
  const runs = createHindsightCutoverRunRepo(db);
  runs.create({ runId: "run", expectedPredecessorEpochId: predecessor.epochId, now });
  const lease = runs.acquireLease({ runId: "run", owner: "cutover", now, expiresAt: later });
  const banks = [{ bankId: "bank", templateDigest: template, checkpoint }];
  const checkpointSetDigest = hindsightCheckpointSetDigest(banks);
  runs.markReady({ lease, configFingerprint: config, checkpointSetDigest, now });
  return { db, input: { lease, predecessorEpochId: predecessor.epochId, hindsightEpochId: "55555555-5555-4555-8555-555555555555",
    transactionId: "66666666-6666-4666-8666-666666666666", configFingerprint: config, checkpointSetDigest, banks, now } };
}

function seedCompletedB2(db: Database, epochId: string): void {
  db.prepare(`INSERT INTO memory_migration_runs
    (run_id,snapshot_id,epoch_id,phase,status,requested_at,updated_at,lease_fence,activation_transaction_id)
    VALUES ('run','legacy-snapshot',:epoch,'activated','completed',:now,:now,1,'local-tx')`).run({ epoch: epochId, now });
  db.prepare(`INSERT INTO memory_migration_activation_receipts
    (run_id,transaction_id,snapshot_id,manifest_digest,readiness_digest,epoch_id,lease_fence,committed_at,marker_mode)
    VALUES ('run','local-tx','legacy-snapshot',:hash,:hash,:epoch,1,:now,'canonical-local')`)
    .run({ hash: "d".repeat(64), epoch: epochId, now });
  db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,verified_snapshot_id='legacy-snapshot',
    activation_transaction_id='local-tx',updated_at=:now WHERE singleton=1`).run({ epoch: epochId, now });
  db.prepare(`INSERT INTO memory_migration_sources
    (run_id,source_id,kind,relative_path,raw_sha256,byte_length,phase,disposition,result_count,updated_at)
    VALUES ('run','source','entry','memory/global/profile/source.md',:hash,1,'verified','converted-one',1,:now)`)
    .run({ hash: "e".repeat(64), now });
}

function seedConnectionAndBank(db: Database): void {
  db.prepare(`UPDATE hindsight_connection_state SET phase='configured',config_fingerprint=:config,compatibility_json=:compatibility,
    updated_at=:now WHERE singleton=1`).run({ config, compatibility: JSON.stringify({ providerLineage: lineage }), now });
  db.prepare(`INSERT INTO hindsight_bank_setup
    (canonical_identity,scope_kind,external_bank_id,template_revision,template_digest,status,operation_ids_json,updated_at)
    VALUES ('global','global','bank','taki-bank-v1',:template,'verified','[]',:now)`)
    .run({ template, now });
}

function seedReplica(db: Database) {
  const records = [document(), memory()]; const pageHash = "f".repeat(64);
  const metadata: HindsightLogicalSnapshotMetadata = { snapshotId, manifest: {
    schemaVersion: 1, bankId: "bank", providerLineage: lineage, bankGeneration: generation, endCursor: 7,
    pageSize: 2, totalPages: 1, totalRecords: 2,
    counts: { bank: 0, document: 1, memoryUnit: { valid: 1, invalidated: 0 }, mentalModel: 0, directive: 0, total: 2 },
    pageHashes: [pageHash], manifestDigest: "a".repeat(64),
  }, createdAt: now, expiresAt: later };
  metadata.manifest.manifestDigest = snapshotManifestHash(metadata);
  const repo = createHindsightReplicaRepo(db);
  const staged = repo.stage({ runId: "run", replicaEpochId: replicaEpoch, metadata, pages: [{ snapshotId, pageNumber: 0,
    totalPages: 1, recordCount: 2, contentHash: pageHash, records }], now });
  return repo.publish({ stagingId: staged.stagingId, capturedAt: now, publishedAt: now });
}

function seedMapping(db: Database): void {
  db.prepare(`INSERT INTO hindsight_import_operations
    (run_id,source_id,bank_id,document_id,operation_identity,remote_operation_id,content_identity,provider_content_hash,
     lease_fence,attempt_no,status,derived_unit_count,mapping_complete,updated_at)
    VALUES ('run','source','bank','document','operation','remote',:content,:hash,1,1,'mapped',1,1,:now)`)
    .run({ content: `sha256:${"a".repeat(64)}`, hash: "b".repeat(64), now });
  db.prepare(`INSERT INTO hindsight_import_facts (run_id,source_id,fact_ordinal,fact_id,revision,payload_hash)
    VALUES ('run','source',0,'fact',4,:hash)`).run({ hash: canonicalPayloadHash(memory().payload.value) });
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
