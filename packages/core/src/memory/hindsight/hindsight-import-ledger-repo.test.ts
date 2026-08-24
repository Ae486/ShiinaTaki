import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createHindsightCutoverRunRepo } from "../../db/hindsight-cutover-run-repo.ts";
import { createHindsightImportLedgerRepo } from "./hindsight-import-ledger-repo.ts";

const dbs: Database[] = [];
const now = "2026-08-21T00:00:00.000Z";
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function setup(): { db: Database; repo: ReturnType<typeof createHindsightImportLedgerRepo>; lease: ReturnType<ReturnType<typeof createHindsightCutoverRunRepo>["acquireLease"]> } {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  seedCompletedSource(db);
  const cutover = createHindsightCutoverRunRepo(db);
  cutover.create({ runId: "run", expectedPredecessorEpochId: "local-epoch", now });
  const lease = cutover.acquireLease({ runId: "run", owner: "owner", now, expiresAt: "2026-08-21T01:00:00.000Z" });
  return { db, repo: createHindsightImportLedgerRepo(db), lease };
}

function seedCompletedSource(db: Database): void {
  db.prepare(`INSERT INTO canonical_memory_authority_epochs
    (epoch_id,provider_id,provider_lineage_id,status,started_at,reason)
    VALUES ('local-epoch','local','local-lineage','active',:now,'initial-local')`).run({ now });
  db.prepare("INSERT INTO canonical_memory_authority_state (singleton,active_epoch_id,updated_at) VALUES (1,'local-epoch',:now)").run({ now });
  db.prepare(`INSERT INTO memory_migration_runs
    (run_id,snapshot_id,epoch_id,phase,status,requested_at,updated_at,lease_fence,activation_transaction_id)
    VALUES ('run','snapshot','local-epoch','activated','completed',:now,:now,1,'local-tx')`).run({ now });
  db.prepare(`INSERT INTO memory_migration_sources
    (run_id,source_id,kind,relative_path,raw_sha256,byte_length,phase,disposition,result_count,updated_at)
    VALUES ('run','source','entry','memory/global/profile/a.md',:hash,1,'verified','converted-one',1,:now)`)
    .run({ hash: "a".repeat(64), now });
}

describe("Hindsight import ledger", () => {
  it("reopens the exact deterministic operation and refuses changed content", () => {
    const { repo, lease } = setup();
    const input = { lease, sourceId: "source", bankId: "bank", documentId: "doc", operationIdentity: "sha256:identity", remoteOperationId: "11111111-1111-5111-8111-111111111111", contentIdentity: `sha256:${"b".repeat(64)}`, providerContentHash: "c".repeat(64), zeroFactAllowed: false, now };
    expect(repo.ensureOperation(input)).toMatchObject({ status: "pending", attemptNo: 0 });
    expect(repo.ensureOperation(input)).toEqual(repo.read("run", "source"));
    expect(() => repo.ensureOperation({ ...input, providerContentHash: "d".repeat(64) })).toThrow("HINDSIGHT_IMPORT_CONFLICT");
  });

  it("persists attempts and zero/one/many mappings without provider payloads", () => {
    const { db, repo, lease } = setup();
    repo.ensureOperation({ lease, sourceId: "source", bankId: "bank", documentId: "doc", operationIdentity: "identity", remoteOperationId: "remote", contentIdentity: `sha256:${"b".repeat(64)}`, providerContentHash: "c".repeat(64), zeroFactAllowed: true, now });
    expect(repo.beginAttempt({ lease, sourceId: "source", now }).attemptNo).toBe(1);
    expect(repo.setMappings({ lease, sourceId: "source", mappings: [], now })).toMatchObject({ status: "mapped", mappingComplete: true, derivedUnitCount: 0 });
    expect(repo.mappings("run", "source")).toEqual([]);
    expect(Object.keys(db.prepare("SELECT * FROM hindsight_import_operations").get() ?? {})).not.toContain("raw_provider_payload");
  });

  it("records ordered many-fact mappings and keeps terminal rows immutable", () => {
    const { repo, lease } = setup();
    repo.ensureOperation({ lease, sourceId: "source", bankId: "bank", documentId: "doc", operationIdentity: "identity", remoteOperationId: "remote", contentIdentity: `sha256:${"b".repeat(64)}`, providerContentHash: "c".repeat(64), zeroFactAllowed: false, now });
    repo.setMappings({ lease, sourceId: "source", mappings: [
      { factOrdinal: 0, factId: "fact-a", revision: 1, payloadHash: "c".repeat(64) },
      { factOrdinal: 1, factId: "fact-b", revision: 2, payloadHash: "d".repeat(64) },
    ], now });
    expect(repo.mappings("run", "source").map((item) => item.factId)).toEqual(["fact-a", "fact-b"]);
    expect(() => repo.beginAttempt({ lease, sourceId: "source", now })).toThrow("HINDSIGHT_IMPORT_STATE_CONFLICT");
  });

  it("rejects a worker whose B2 lease fence was superseded", () => {
    const { db, repo, lease } = setup();
    const input = { lease, sourceId: "source", bankId: "bank", documentId: "doc", operationIdentity: "identity", remoteOperationId: "remote", contentIdentity: `sha256:${"b".repeat(64)}`, providerContentHash: "c".repeat(64), zeroFactAllowed: false, now };
    repo.ensureOperation(input);
    db.prepare("UPDATE hindsight_cutover_runs SET lease_owner='new-owner',lease_fence=lease_fence+1,lease_expires_at='2026-08-21T02:00:00.000Z' WHERE run_id='run'").run();
    expect(() => repo.beginAttempt({ lease, sourceId: "source", now })).toThrow("LEASE_LOST");
  });
});
