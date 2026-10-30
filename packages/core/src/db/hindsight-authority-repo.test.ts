import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { HindsightLogicalSnapshotMetadata, HindsightLogicalSnapshotRecord } from "@taki/shared";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import { createHindsightCutoverRunRepo } from "./hindsight-cutover-run-repo.ts";
import { seedLocalB2CoverageFixture } from "./hindsight-local-coverage-fixtures.ts";
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

afterEach(() => {
  const prefixes = ["taki-hindsight-authority-", "taki-hindsight-before-reservation-",
    "taki-hindsight-after-reservation-", "taki-hindsight-held-reservation-"];
  for (const root of roots.splice(0)) {
    const target = resolve(root);
    if (dirname(target) !== resolve(tmpdir()) || !prefixes.some((prefix) => basename(target).startsWith(prefix))) {
      throw new Error("unsafe Hindsight authority fixture path");
    }
    rmSync(target, { recursive: true, force: true });
  }
});

describe("Hindsight authority promotion repository", () => {
  it("exposes bounded status and refuses a stale expected predecessor without mutation", () => {
    const fixture = setup(openDatabase({ path: ":memory:", migrations: MIGRATIONS }));
    const runs = createHindsightCutoverRunRepo(fixture.db);
    expect(runs.status("run")).toMatchObject({ runId: "run", phase: "ready", sourceCount: 1, checkpointCount: 1, authority: { mode: "canonical-local" } });
    expect(runs.verify({ runId: "run", expectedRevision: 0, expectedEpochId: "wrong" })).toMatchObject({ eligible: false, blockingCodes: expect.arrayContaining(["HINDSIGHT_PREDECESSOR_STALE", "HINDSIGHT_LOCAL_COVERAGE_UNPROVEN"]) });
    expect(runs.verify({ runId: "run", expectedRevision: 1, expectedEpochId: fixture.input.predecessorEpochId }))
      .toMatchObject({ eligible: false, blockingCodes: expect.arrayContaining(["HINDSIGHT_STATE_CONFLICT", "HINDSIGHT_LOCAL_COVERAGE_UNPROVEN"]) });
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
    expect(runs.status("run")).toMatchObject({ sourceCount: 1, operationCounts: { mapped: 1, excluded: 1 } });
    expect(runs.verify({ runId: "run", expectedRevision: 0, expectedEpochId: fixture.input.predecessorEpochId }))
      .toMatchObject({ eligible: false, blockingCodes: expect.arrayContaining(["HINDSIGHT_LOCAL_COVERAGE_STALE"]) });
    fixture.db.close();
  });

  it("refuses old B2-only readiness and preserves Local authority and resumable mappings across reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-hindsight-authority-")); roots.push(root);
    const path = join(root, "workspace.db"); const fixture = setup(openDatabase({ path, migrations: MIGRATIONS }));
    expect(() => promoteHindsightAuthority(fixture.db, fixture.input)).toThrow("HINDSIGHT_LOCAL_COVERAGE_UNPROVEN");
    expect(readMemoryAuthoritySelection(fixture.db)).toMatchObject({ mode: "canonical-local", epochId: fixture.input.predecessorEpochId });
    expect(fixture.db.prepare("SELECT count(*) AS n FROM canonical_memory_authority_epochs WHERE status='active'").get()?.n).toBe(1);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(0);
    expect(fixture.db.prepare("SELECT phase,status,lease_owner FROM hindsight_cutover_runs WHERE run_id='run'").get())
      .toMatchObject({ phase: "ready", status: "ready", lease_owner: "cutover" });
    fixture.db.close();
    const reopened = openDatabase({ path, migrations: MIGRATIONS });
    expect(readMemoryAuthoritySelection(reopened)).toMatchObject({ mode: "canonical-local", epochId: fixture.input.predecessorEpochId });
    expect(reopened.prepare("SELECT count(*) AS n FROM canonical_memory_authority_epochs WHERE status='active'").get()?.n).toBe(1);
    expect(reopened.prepare("SELECT status,mapping_complete FROM hindsight_import_operations").get()).toMatchObject({ status: "mapped", mapping_complete: 1 });
    reopened.close();
  });

  it.each([
    ["unresolved mapping", (db: Database) => db.prepare("UPDATE hindsight_import_operations SET status='processing' WHERE run_id='run'").run(), "HINDSIGHT_IMPORT_UNRESOLVED"],
    ["stale manifest", (db: Database) => db.prepare("UPDATE hindsight_replica_staging_runs SET manifest_digest=:digest WHERE staging_id=(SELECT staging_id FROM hindsight_replica_checkpoints WHERE bank_id='bank')").run({ digest: "c".repeat(64) }), "HINDSIGHT_MANIFEST_STALE"],
    ["expired checkpoint", (db: Database) => db.prepare("UPDATE hindsight_replica_checkpoints SET snapshot_expires_at=:now WHERE bank_id='bank'").run({ now }), "HINDSIGHT_CHECKPOINT_STALE"],
    ["missing checkpoint", (db: Database) => db.prepare("DELETE FROM hindsight_replica_checkpoints WHERE bank_id='bank'").run(), "HINDSIGHT_CHECKPOINT_MISSING"],
    ["stale mapping", (db: Database) => db.prepare("UPDATE hindsight_import_facts SET payload_hash=:hash WHERE run_id='run'").run({ hash: "0".repeat(64) }), "HINDSIGHT_MAPPING_UNVERIFIED"],
    ["lost fence", (db: Database) => db.prepare("UPDATE hindsight_cutover_runs SET lease_fence=lease_fence+1 WHERE run_id='run'").run(), "LEASE_LOST"],
    ["missing Local coverage", (db: Database) => db.exec("DELETE FROM hindsight_cutover_local_coverage"), "HINDSIGHT_LOCAL_COVERAGE_MISSING"],
  ])("refuses %s without changing canonical Local authority", (_name, mutate, code) => {
    const fixture = setup(openDatabase({ path: ":memory:", migrations: MIGRATIONS })); mutate(fixture.db);
    expect(() => promoteHindsightAuthority(fixture.db, fixture.input)).toThrow(code);
    expect(readMemoryAuthoritySelection(fixture.db)).toMatchObject({ mode: "canonical-local", epochId: fixture.input.predecessorEpochId });
    expect(fixture.db.prepare("SELECT status FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: fixture.input.predecessorEpochId })?.status).toBe("active");
    fixture.db.close();
  });

  it("refuses an unproven current import before even an epoch insertion conflict can close Local", () => {
    const fixture = setup(openDatabase({ path: ":memory:", migrations: MIGRATIONS }));
    const conflicting = { ...fixture.input, hindsightEpochId: fixture.input.predecessorEpochId };
    expect(() => promoteHindsightAuthority(fixture.db, conflicting)).toThrow("HINDSIGHT_LOCAL_COVERAGE_UNPROVEN");
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
    seedHistoricalActivation(fixture.db, fixture.input);
    fixture.db.exec("DELETE FROM hindsight_authority_activation_receipts");
    expect(() => readMemoryAuthoritySelection(fixture.db)).toThrow("MEMORY_INTEGRITY_ERROR");
    fixture.db.close();
  });

  it("keeps an already activated historical run inspectable without treating its closed Local predecessor as active", () => {
    const fixture = setup(openDatabase({ path: ":memory:", migrations: MIGRATIONS }));
    seedHistoricalActivation(fixture.db, fixture.input);
    const runs = createHindsightCutoverRunRepo(fixture.db);
    expect(runs.status("run")).toMatchObject({ phase: "activated", sourceCount: 1,
      localCoverage: { state: "historical", currentSourceCount: null, frozenSourceCount: 1 }, authority: { mode: "hindsight" } });
    expect(runs.verify({ runId: "run", expectedRevision: 0, expectedEpochId: fixture.input.predecessorEpochId }))
      .toMatchObject({ eligible: true });
    fixture.db.exec("DELETE FROM hindsight_cutover_local_coverage");
    expect(runs.status("run")).toMatchObject({ sourceCount: null,
      localCoverage: { state: "historical", manifestId: null, currentSourceCount: null, frozenSourceCount: null } });
    fixture.db.close();
  });

  it("observes a competing connection's commit before reserving the SQLite writer", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-hindsight-before-reservation-")); roots.push(root);
    const path = join(root, "owned.db"); const fixture = setup(openDatabase({ path, migrations: MIGRATIONS }));
    const other = openDatabase({ path, migrations: MIGRATIONS });
    try {
      let reserved = false; const statements: string[] = [];
      const guarded = interceptReservation(fixture.db, () => {
        statements.push("other-commit");
        createCanonicalMemoryRepo(other).edit({ epochId: fixture.local.epochId, bankId: fixture.local.bankId,
          memoryId: fixture.local.record.unit.memoryId, expectedRevision: 1, requestId: "other-edit", requestHash: "4".repeat(64),
          patch: { text: "Committed before the reservation." }, now, searchTerms: "committed" });
      }, () => { reserved = true; statements.push("reserved"); });
      expect(() => promoteHindsightAuthority(guarded, fixture.input)).toThrow("HINDSIGHT_LOCAL_COVERAGE_STALE");
      expect(reserved).toBe(true); expect(statements).toEqual(["other-commit", "reserved"]);
      expect(readMemoryAuthoritySelection(fixture.db)).toMatchObject({ mode: "canonical-local", epochId: fixture.local.epochId });
      expect(fixture.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(0);
    } finally { other.close(); fixture.db.close(); }
  });

  it("blocks a competing canonical writer after reservation and rolls the refused promotion back", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-hindsight-after-reservation-")); roots.push(root);
    const path = join(root, "owned.db"); const fixture = setup(openDatabase({ path, migrations: MIGRATIONS }));
    const other = openDatabase({ path, migrations: MIGRATIONS });
    try {
      other.exec("PRAGMA busy_timeout=0"); let attempted = false;
      fixture.db.exec(`CREATE TEMP TABLE reservation_probe (value INTEGER);
        CREATE TEMP TRIGGER record_reservation AFTER UPDATE ON canonical_memory_authority_state
        BEGIN INSERT INTO reservation_probe VALUES (1); END;`);
      const before = JSON.stringify(fixture.db.prepare("SELECT * FROM canonical_memory_authority_state").get());
      const guarded = interceptReservation(fixture.db, () => undefined, () => {
        attempted = true;
        expect(() => createCanonicalMemoryRepo(other).edit({ epochId: fixture.local.epochId, bankId: fixture.local.bankId,
          memoryId: fixture.local.record.unit.memoryId, expectedRevision: 1, requestId: "blocked-edit", requestHash: "5".repeat(64),
          patch: { text: "Must not commit while promotion owns the writer." }, now, searchTerms: "blocked" })).toThrow(/locked|busy/i);
      });
      expect(() => promoteHindsightAuthority(guarded, fixture.input)).toThrow("HINDSIGHT_LOCAL_COVERAGE_UNPROVEN");
      expect(attempted).toBe(true);
      expect(JSON.stringify(fixture.db.prepare("SELECT * FROM canonical_memory_authority_state").get())).toBe(before);
      expect(createCanonicalMemoryRepo(fixture.db).record(fixture.local.epochId, fixture.local.bankId, fixture.local.record.unit.memoryId)?.unit.revision).toBe(1);
      expect(createCanonicalMemoryRepo(other).receipt(fixture.local.epochId, "blocked-edit")).toBeUndefined();
      expect(fixture.db.prepare("SELECT count(*) AS n FROM reservation_probe").get()?.n).toBe(0);
      expect(readMemoryAuthoritySelection(fixture.db)).toMatchObject({ mode: "canonical-local", epochId: fixture.local.epochId });
    } finally { other.close(); fixture.db.close(); }
  });

  it("fails without mutation when another connection already holds the SQLite writer reservation", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-hindsight-held-reservation-")); roots.push(root);
    const path = join(root, "owned.db"); const fixture = setup(openDatabase({ path, migrations: MIGRATIONS }));
    const other = openDatabase({ path, migrations: MIGRATIONS });
    try {
      fixture.db.exec("PRAGMA busy_timeout=0");
      const before = JSON.stringify(fixture.db.prepare("SELECT * FROM canonical_memory_authority_state").get());
      expect(() => other.transaction(() => {
        other.prepare("UPDATE canonical_memory_banks SET mission='uncommitted writer' WHERE bank_id='bank'").run();
        expect(() => promoteHindsightAuthority(fixture.db, fixture.input)).toThrow(/locked|busy/i);
        throw new Error("TEST_ROLLBACK_HELD_WRITER");
      })).toThrow("TEST_ROLLBACK_HELD_WRITER");
      expect(JSON.stringify(fixture.db.prepare("SELECT * FROM canonical_memory_authority_state").get())).toBe(before);
      expect(readMemoryAuthoritySelection(fixture.db)).toMatchObject({ mode: "canonical-local", epochId: fixture.local.epochId });
      expect(fixture.db.prepare("SELECT count(*) AS n FROM hindsight_authority_activation_receipts").get()?.n).toBe(0);
      expect(() => promoteHindsightAuthority(fixture.db, fixture.input)).toThrow("HINDSIGHT_LOCAL_COVERAGE_UNPROVEN");
    } finally { other.close(); fixture.db.close(); }
  });
});

function setup(db: Database) {
  const local = seedLocalB2CoverageFixture(db);
  seedConnectionAndBank(db);
  const checkpoint = seedReplica(db); seedMapping(db, local.sourceId);
  const runs = createHindsightCutoverRunRepo(db);
  runs.create({ runId: "run", expectedPredecessorEpochId: local.epochId, now });
  const lease = runs.acquireLease({ runId: "run", owner: "cutover", now, expiresAt: later });
  const banks = [{ bankId: "bank", templateDigest: template, checkpoint }];
  const checkpointSetDigest = hindsightCheckpointSetDigest(banks);
  // Reopened pre-C1 ready flags are historical input, never a current-version import certificate.
  db.prepare(`UPDATE hindsight_cutover_runs SET phase='ready',status='ready',config_fingerprint=:config,
    checkpoint_set_digest=:digest WHERE run_id='run'`).run({ config, digest: checkpointSetDigest });
  const input: HindsightPromotionInput = { lease, predecessorEpochId: local.epochId, hindsightEpochId: "55555555-5555-4555-8555-555555555555",
    transactionId: "66666666-6666-4666-8666-666666666666", configFingerprint: config, checkpointSetDigest, banks, now };
  return { db, input, local };
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

function seedMapping(db: Database, sourceId: string): void {
  db.prepare(`INSERT INTO hindsight_import_operations
    (run_id,source_id,bank_id,document_id,operation_identity,remote_operation_id,content_identity,provider_content_hash,
     lease_fence,attempt_no,status,derived_unit_count,mapping_complete,updated_at)
    VALUES ('run',:source,'bank','document','operation','remote',:content,:hash,1,1,'mapped',1,1,:now)`)
    .run({ source: sourceId, content: `sha256:${"a".repeat(64)}`, hash: "b".repeat(64), now });
  db.prepare(`INSERT INTO hindsight_import_facts (run_id,source_id,fact_ordinal,fact_id,revision,payload_hash)
    VALUES ('run',:source,0,'fact',4,:hash)`).run({ source: sourceId, hash: canonicalPayloadHash(memory().payload.value) });
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

function interceptReservation(db: Database, before: () => void, after: () => void): Database {
  let reserved = false;
  return { ...db, prepare(sql) {
    if (!reserved && /^SELECT/i.test(sql) && sql.includes("canonical_memory_")) {
      throw new Error("TEST_LOCAL_READ_BEFORE_WRITER_RESERVATION");
    }
    const statement = db.prepare(sql);
    if (!reserved && sql.startsWith("UPDATE canonical_memory_authority_state SET active_epoch_id=active_epoch_id")) {
      return { ...statement, run(params) {
        before(); const result = statement.run(params); reserved = true; after(); return result;
      } };
    }
    return statement;
  } };
}

function seedHistoricalActivation(db: Database, input: HindsightPromotionInput): void {
  // This represents an activation committed by the older implementation, not acceptance by the new C1 guard.
  db.transaction(() => {
    db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at=:now WHERE epoch_id=:epoch")
      .run({ epoch: input.predecessorEpochId, now });
    db.prepare(`INSERT INTO canonical_memory_authority_epochs
      (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES (:epoch,'hindsight',:lineage,'active',:predecessor,:now,NULL,'planned-switch')`)
      .run({ epoch: input.hindsightEpochId, lineage, predecessor: input.predecessorEpochId, now });
    db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id=:epoch WHERE singleton=1").run({ epoch: input.hindsightEpochId });
    db.prepare(`INSERT INTO hindsight_authority_activation_receipts
      (transaction_id,run_id,predecessor_epoch_id,hindsight_epoch_id,provider_lineage,config_fingerprint,checkpoint_set_digest,bank_count,lease_fence,committed_at)
      VALUES (:tx,'run',:predecessor,:epoch,:lineage,:config,:digest,1,:fence,:now)`)
      .run({ tx: input.transactionId, predecessor: input.predecessorEpochId, epoch: input.hindsightEpochId,
        lineage, config, digest: input.checkpointSetDigest, fence: input.lease.fence, now });
    for (const bank of input.banks) {
      db.prepare(`INSERT INTO hindsight_authority_bank_receipts
        (transaction_id,bank_id,snapshot_id,bank_generation,replica_epoch_id,end_cursor,manifest_digest,template_digest)
        VALUES (:tx,:bank,:snapshot,:generation,:replica,:cursor,:digest,:template)`)
        .run({ tx: input.transactionId, bank: bank.bankId, snapshot: bank.checkpoint.snapshotId,
          generation: bank.checkpoint.bankGeneration, replica: bank.checkpoint.replicaEpochId, cursor: bank.checkpoint.endCursor,
          digest: bank.checkpoint.manifestDigest, template: bank.templateDigest });
    }
    db.prepare(`UPDATE memory_authority_selection SET mode='hindsight',active_epoch_id=:epoch,
      verified_snapshot_id=NULL,activation_transaction_id=:tx,provider_lineage_id=:lineage,replica_checkpoint_digest=:digest WHERE singleton=1`)
      .run({ epoch: input.hindsightEpochId, tx: input.transactionId, lineage, digest: input.checkpointSetDigest });
    db.prepare("UPDATE hindsight_cutover_runs SET phase='activated',status='completed',lease_owner=NULL,lease_expires_at=NULL WHERE run_id='run'").run();
  });
}
