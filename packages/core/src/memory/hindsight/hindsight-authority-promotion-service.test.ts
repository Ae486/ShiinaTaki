import { describe, expect, it } from "vitest";
import { seedLocalB2CoverageFixture } from "../../db/hindsight-local-coverage-fixtures.ts";
import { createHindsightCutoverRunRepo } from "../../db/hindsight-cutover-run-repo.ts";
import { hindsightCheckpointSetDigest, type HindsightPromotionInput } from "../../db/hindsight-authority-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createMemoryAuthorityFence } from "../legacy-migration/memory-authority-fence.ts";
import { promoteHindsightWithFence } from "./hindsight-authority-promotion-service.ts";

const now = "2026-08-22T00:00:00.000Z";
const later = "2026-08-22T01:00:00.000Z";
const lineage = "11111111-1111-4111-8111-111111111111";
const replicaEpoch = "22222222-2222-4222-8222-222222222222";
const snapshotId = "33333333-3333-4333-8333-333333333333";
const generation = "44444444-4444-4444-8444-444444444444";
const config = "a".repeat(64);
const template = "b".repeat(64);
const manifest = "c".repeat(64);
const payload = "d".repeat(64);

describe("Hindsight authority promotion service", () => {
  it("times out a busy legacy admission fence without changing authority and reopens admissions", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const fence = createMemoryAuthorityFence();
    const promotion = seedReadyPromotion(db); let release: () => void = () => undefined;
    const held = fence.admit(() => new Promise<void>((resolve) => { release = resolve; }));
    await expect(promoteHindsightWithFence({ db, fence, timeoutMs: 1, promotion })).rejects.toThrow("MEMORY_QUIESCENCE_TIMEOUT");
    expect(db.prepare("SELECT mode,active_epoch_id FROM memory_authority_selection WHERE singleton=1").get())
      .toMatchObject({ mode: "canonical-local", active_epoch_id: promotion.predecessorEpochId });
    release(); await held;
    await expect(fence.admit(async () => "Local admission restored")).resolves.toBe("Local admission restored");
    db.close();
  });

  it("restores Local admissions when pre-commit promotion refuses", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const fence = createMemoryAuthorityFence();
    await expect(promoteHindsightWithFence({ db, fence, timeoutMs: 10, promotion: invalidPromotion() })).rejects.toThrow("HINDSIGHT_PROMOTION_INPUT_INVALID");
    await expect(fence.admit(async () => "Local admission restored")).resolves.toBe("Local admission restored");
    db.close();
  });

  it("keeps admissions open when current Local import proof refuses an old B2-only ready run", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const fence = createMemoryAuthorityFence();
    const promotion = seedReadyPromotion(db);
    await expect(promoteHindsightWithFence({ db, fence, timeoutMs: 100, promotion })).rejects.toThrow("HINDSIGHT_LOCAL_COVERAGE_UNPROVEN");
    await expect(fence.admit(async () => "admission remains open")).resolves.toBe("admission remains open");
    expect(db.prepare("SELECT mode,active_epoch_id FROM memory_authority_selection WHERE singleton=1").get())
      .toMatchObject({ mode: "canonical-local", active_epoch_id: promotion.predecessorEpochId });
    db.close();
  });
});

function invalidPromotion(): HindsightPromotionInput {
  return { lease: { runId: "run", owner: "owner", fence: 1, expiresAt: later }, predecessorEpochId: "",
    hindsightEpochId: "hindsight", transactionId: "tx", configFingerprint: "bad", checkpointSetDigest: "bad",
    banks: [], now };
}

function seedReadyPromotion(db: Database): HindsightPromotionInput {
  const local = seedLocalB2CoverageFixture(db);
  seedSetup(db); seedReplicaAndMapping(db, local.sourceId);
  const runs = createHindsightCutoverRunRepo(db);
  runs.create({ runId: "run", expectedPredecessorEpochId: local.epochId, now });
  const lease = runs.acquireLease({ runId: "run", owner: "cutover", now, expiresAt: later });
  const checkpoint = { providerLineage: lineage, bankId: "bank", bankGeneration: generation, replicaEpochId: replicaEpoch,
    snapshotId, endCursor: 7, manifestDigest: manifest, capturedAt: now, snapshotExpiresAt: later, publishedAt: now };
  const banks = [{ bankId: "bank", templateDigest: template, checkpoint }];
  const checkpointSetDigest = hindsightCheckpointSetDigest(banks);
  // Historical B2-only readiness is input to the new refusal path, never evidence of a current import.
  db.prepare(`UPDATE hindsight_cutover_runs SET phase='ready',status='ready',config_fingerprint=:config,
    checkpoint_set_digest=:digest WHERE run_id='run'`).run({ config, digest: checkpointSetDigest });
  return { lease, predecessorEpochId: local.epochId, hindsightEpochId: "55555555-5555-4555-8555-555555555555",
    transactionId: "66666666-6666-4666-8666-666666666666", configFingerprint: config, checkpointSetDigest, banks, now };
}

function seedSetup(db: Database): void {
  db.prepare(`UPDATE hindsight_connection_state SET phase='configured',config_fingerprint=:config,
    compatibility_json=:compatibility,updated_at=:now WHERE singleton=1`)
    .run({ config, compatibility: JSON.stringify({ providerLineage: lineage }), now });
  db.prepare(`INSERT INTO hindsight_bank_setup
    (canonical_identity,scope_kind,external_bank_id,template_revision,template_digest,status,operation_ids_json,updated_at)
    VALUES ('global','global','bank','v1',:template,'verified','[]',:now)`).run({ template, now });
}

function seedReplicaAndMapping(db: Database, sourceId: string): void {
  db.prepare(`INSERT INTO hindsight_replica_staging_runs
    (staging_id,run_id,replica_epoch_id,provider_lineage,bank_id,bank_generation,snapshot_id,end_cursor,manifest_digest,
     manifest_json,snapshot_expires_at,status,created_at,updated_at)
    VALUES ('stage','run',:replica,:lineage,'bank',:generation,:snapshot,7,:manifest,'{}',:later,'published',:now,:now)`)
    .run({ replica: replicaEpoch, lineage, generation, snapshot: snapshotId, manifest, later, now });
  for (const record of [{ kind: "document", id: "document", revision: 1, hash: "a".repeat(64) },
    { kind: "memory_unit", id: "fact", revision: 2, hash: payload }]) seedRecord(db, record);
  db.prepare(`INSERT INTO hindsight_replica_checkpoints
    (bank_id,replica_epoch_id,provider_lineage,bank_generation,snapshot_id,end_cursor,manifest_digest,captured_at,
     snapshot_expires_at,published_at,staging_id)
    VALUES ('bank',:replica,:lineage,:generation,:snapshot,7,:manifest,:now,:later,:now,'stage')`)
    .run({ replica: replicaEpoch, lineage, generation, snapshot: snapshotId, manifest, now, later });
  db.prepare(`INSERT INTO hindsight_import_operations
    (run_id,source_id,bank_id,document_id,operation_identity,remote_operation_id,content_identity,provider_content_hash,
     lease_fence,attempt_no,status,derived_unit_count,mapping_complete,updated_at)
    VALUES ('run',:source,'bank','document','operation','remote',:content,:hash,1,1,'mapped',1,1,:now)`)
    .run({ source: sourceId, content: `sha256:${"a".repeat(64)}`, hash: "b".repeat(64), now });
  db.prepare(`INSERT INTO hindsight_import_facts (run_id,source_id,fact_ordinal,fact_id,revision,payload_hash)
    VALUES ('run',:source,0,'fact',2,:payload)`).run({ source: sourceId, payload });
}

function seedRecord(db: Database, record: { kind: string; id: string; revision: number; hash: string }): void {
  const input = { ordinal: record.kind === "document" ? 0 : 1, kind: record.kind, id: record.id,
    revision: record.revision, hash: record.hash };
  db.prepare(`INSERT INTO hindsight_replica_staging_records
    (staging_id,page_number,record_ordinal,object_kind,object_id,object_revision,payload_hash,payload_json)
    VALUES ('stage',0,:ordinal,:kind,:id,:revision,:hash,'{}')`).run(input);
  db.prepare(`INSERT INTO hindsight_replica_records
    (bank_id,replica_epoch_id,object_kind,object_id,object_revision,payload_hash,payload_json)
    VALUES ('bank',:replica,:kind,:id,:revision,:hash,'{}')`).run({ kind: input.kind, id: input.id,
      revision: input.revision, hash: input.hash, replica: replicaEpoch });
}
