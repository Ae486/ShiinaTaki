import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createHindsightReplicaSchedulerRepo } from "./hindsight-replica-scheduler-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase } from "./sqlite.ts";
import { createMemoryOperationService } from "../memory/operations/memory-operation-service.ts";
import { createMemoryOperationRepo } from "./memory-operation-repo.ts";
import { fakeSetup } from "../memory/operations/memory-operation-fixtures.ts";
import { createLogger } from "../logging/logger.ts";
import { publishReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";

const AT = "2026-09-29T00:00:00.000Z";
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const BANK = { bankId: "bank", scope: "global" as const, characterId: null };

describe("durable replica request evidence", () => {
  it("upgrades an active pre-051 manual run without inventing producer identity or success", async () => {
    const root = mkdtempSync(join(tmpdir(), "taki-replica-legacy-")); const path = join(root, "state.sqlite");
    let db = openDatabase({ path, migrations: MIGRATIONS.slice(0, 50) });
    try {
      const old = createHindsightReplicaSchedulerRepo(db, () => AT); old.ensureBank({ bank: BANK });
      old.requestManual({ bankId: BANK.bankId, kind: "full" });
      const run = old.claim({ bankId: BANK.bankId, ownerId: "old", leaseDurationMs: 1000 })!;
      createMemoryOperationRepo(db, () => AT).insertAdmitted({ operationId: ID, kind: "replica.sync", family: "replica:bank",
        request: { kind: "replica.sync", bankId: BANK.bankId, syncKind: "full" }, bootId: "old", authorityEpochId: null,
        producer: { kind: "replica", bankId: BANK.bankId, admittedAt: AT } });
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      const repo = createHindsightReplicaSchedulerRepo(db, () => "2026-09-29T00:00:02.000Z");
      expect(repo.get(BANK.bankId)?.run).toEqual(run);
      expect(repo.recover(BANK.bankId)).toMatchObject({ run: null, errorCode: "HINDSIGHT_REPLICA_LEASE_LOST" });
      expect(db.prepare("SELECT count(*) AS count FROM hindsight_replica_manual_requests").get()?.count).toBe(0);
      const service = createMemoryOperationService({ db, live: () => null, setup: fakeSetup(), bootId: "new", now: () => AT,
        logger: createLogger("fatal"), onChanged: () => {} });
      expect(service.status(ID)).toMatchObject({ state: "outcome_unknown", reason: "core_restart",
        producer: { kind: "replica", bankId: BANK.bankId, admittedAt: AT } });
      await service.stop();
    } finally { db.close(); rmTempDir(root); }
  });

  it.each(["failed", "cancelled", "succeeded"] as const)("reopens exact %s evidence after a later run and recovers the original operation without a runtime", async (outcome) => {
    const root = mkdtempSync(join(tmpdir(), "taki-replica-request-")); const path = join(root, "state.sqlite");
    let db = openDatabase({ path, migrations: MIGRATIONS.slice(0, 50) });
    try {
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      const repo = createHindsightReplicaSchedulerRepo(db, () => AT);
      repo.ensureBank({ bank: BANK }); repo.requestManual({ bankId: BANK.bankId, kind: "full", requestId: ID });
      createMemoryOperationRepo(db, () => AT).insertAdmitted({ operationId: OTHER, kind: "replica.sync", family: "replica:bank",
        request: { kind: "replica.sync", bankId: BANK.bankId, syncKind: "full" }, bootId: "old", authorityEpochId: null,
        producer: { kind: "replica", bankId: BANK.bankId, admittedAt: AT, requestId: ID } });
      if (outcome === "cancelled") repo.cancelManual(BANK.bankId, ID);
      else {
        const run = repo.claim({ bankId: BANK.bankId, ownerId: "old", leaseDurationMs: 1000 })!;
        expect(run.manualRequestId).toBe(ID);
        expect(() => repo.cancelManual(BANK.bankId, ID)).toThrow("HINDSIGHT_REPLICA_BUSY");
        if (outcome === "succeeded") {
          const checkpoint = { bankId: BANK.bankId, providerLineageId: ID, bankGeneration: ID, authorityEpochId: "epoch", replicaEpochId: ID,
            endCursor: 1, snapshotId: ID, snapshotCursor: 1, snapshotManifestDigest: "a".repeat(64), manifestDigest: "b".repeat(64), verifiedAt: AT };
          publishReplicaCheckpoint(db, { previous: null, next: checkpoint });
          repo.succeed({ run, result: { checkpoint, observedCursor: 1 } });
        } else repo.fail({ run, errorCode: "HINDSIGHT_UNREACHABLE" });
      }
      const exact = repo.request(ID);
      repo.requestManual({ bankId: BANK.bankId, kind: "incremental", requestId: OTHER });
      const later = repo.claim({ bankId: BANK.bankId, ownerId: "later", leaseDurationMs: 1000 })!;
      repo.fail({ run: later, errorCode: "HINDSIGHT_TIMEOUT" });
      expect(repo.request(ID)).toEqual(exact);
      expect(() => db.prepare("DELETE FROM hindsight_replica_manual_requests WHERE request_id=:id").run({ id: ID })).toThrow("IMMUTABLE");
      expect(() => db.prepare("UPDATE hindsight_replica_manual_requests SET state='queued' WHERE request_id=:id").run({ id: ID })).toThrow("TERMINAL");
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      expect(createHindsightReplicaSchedulerRepo(db).request(ID)).toEqual(exact);
      const service = createMemoryOperationService({ db, live: () => null, setup: fakeSetup(), bootId: "new", now: () => AT,
        logger: createLogger("fatal"), onChanged: () => {} });
      expect(service.status(OTHER)).toMatchObject({ state: outcome === "succeeded" ? "completed" : outcome,
        errorCode: outcome === "failed" ? "HINDSIGHT_UNREACHABLE" : null });
      await service.stop();
    } finally { db.close(); rmTempDir(root); }
  });

  it("keeps queued cancellation atomic and never replaces a different request", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const repo = createHindsightReplicaSchedulerRepo(db, () => AT); repo.ensureBank({ bank: BANK });
      repo.requestManual({ bankId: BANK.bankId, kind: "incremental", requestId: ID });
      expect(() => repo.requestManual({ bankId: BANK.bankId, kind: "full", requestId: OTHER })).toThrow("BUSY");
      expect(() => repo.cancelManual(BANK.bankId, OTHER)).toThrow("BUSY");
      expect(repo.get(BANK.bankId)?.pendingManualRequestId).toBe(ID);
      db.exec("CREATE TRIGGER fail_cancel BEFORE UPDATE ON hindsight_replica_sync_schedule BEGIN SELECT RAISE(ABORT,'fixture refusal'); END;");
      expect(() => repo.cancelManual(BANK.bankId, ID)).toThrow("fixture refusal");
      expect(repo.request(ID)?.state).toBe("queued");
      db.exec("DROP TRIGGER fail_cancel;");
      repo.cancelManual(BANK.bankId, ID);
      repo.requestManual({ bankId: BANK.bankId, kind: "incremental", requestId: ID });
      expect(repo.get(BANK.bankId)?.pendingManualKind).toBeNull();
    } finally { db.close(); }
  });

  it("recovers only the lost claim while retaining and then cancelling a later queued request", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); let now = AT;
    try {
      const repo = createHindsightReplicaSchedulerRepo(db, () => now); repo.ensureBank({ bank: BANK });
      repo.requestManual({ bankId: BANK.bankId, kind: "full", requestId: ID });
      const old = repo.claim({ bankId: BANK.bankId, ownerId: "old", leaseDurationMs: 1000 })!;
      repo.requestManual({ bankId: BANK.bankId, kind: "incremental", requestId: OTHER });
      now = "2026-09-29T00:00:02.000Z";
      repo.recover(BANK.bankId);
      const failed = repo.request(ID);
      expect(failed).toMatchObject({ state: "failed", claim: old.lease, errorCode: "HINDSIGHT_REPLICA_LEASE_LOST" });
      expect(repo.request(OTHER)?.state).toBe("queued");
      expect(repo.get(BANK.bankId)?.pendingManualRequestId).toBe(OTHER);
      expect(() => repo.fail({ run: old, errorCode: "HINDSIGHT_TIMEOUT" })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
      repo.cancelManual(BANK.bankId, OTHER);
      const retry = repo.claim({ bankId: BANK.bankId, ownerId: "new", leaseDurationMs: 1000 })!;
      expect(retry.manualRequestId).toBeUndefined();
      repo.fail({ run: retry, errorCode: "HINDSIGHT_TIMEOUT" });
      expect(repo.request(ID)).toEqual(failed);
      expect(repo.request(OTHER)?.state).toBe("cancelled");
    } finally { db.close(); }
  });

  it("rolls back request admission, claim and outcome with their schedule write", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const block = () => db.exec("CREATE TRIGGER fail_schedule BEFORE UPDATE ON hindsight_replica_sync_schedule BEGIN SELECT RAISE(ABORT,'fixture refusal'); END;");
    const unblock = () => db.exec("DROP TRIGGER fail_schedule;");
    try {
      const repo = createHindsightReplicaSchedulerRepo(db, () => AT); repo.ensureBank({ bank: BANK });
      block();
      expect(() => repo.requestManual({ bankId: BANK.bankId, kind: "full", requestId: ID })).toThrow("fixture refusal");
      expect(repo.request(ID)).toBeUndefined(); unblock();
      repo.requestManual({ bankId: BANK.bankId, kind: "full", requestId: ID }); block();
      expect(() => repo.claim({ bankId: BANK.bankId, ownerId: "owner", leaseDurationMs: 1000 })).toThrow("fixture refusal");
      expect(repo.request(ID)?.state).toBe("queued"); expect(repo.get(BANK.bankId)?.run).toBeNull(); unblock();
      const run = repo.claim({ bankId: BANK.bankId, ownerId: "owner", leaseDurationMs: 1000 })!; block();
      expect(() => repo.fail({ run, errorCode: "HINDSIGHT_TIMEOUT" })).toThrow("fixture refusal");
      expect(repo.request(ID)?.state).toBe("claimed"); expect(repo.get(BANK.bankId)?.run).toEqual(run); unblock();
      repo.fail({ run, errorCode: "HINDSIGHT_TIMEOUT" });
      expect(repo.request(ID)?.state).toBe("failed");
    } finally { db.close(); }
  });
});
