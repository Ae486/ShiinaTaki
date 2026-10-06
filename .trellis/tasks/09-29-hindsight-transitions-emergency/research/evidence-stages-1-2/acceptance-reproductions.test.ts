import { describe, expect, it } from "vitest";
import { createCanonicalMemoryAuthorityRepo } from "../../../../../packages/core/src/db/canonical-memory-authority-repo.ts";
import { createHindsightReplicaLeaseRepo } from "../../../../../packages/core/src/db/hindsight-replica-lease-repo.ts";
import { publishReplicaCheckpoint, readReplicaCheckpoint } from "../../../../../packages/core/src/db/hindsight-replica-checkpoint-store.ts";
import { createHindsightReplicaSchedulerRepo } from "../../../../../packages/core/src/db/hindsight-replica-scheduler-repo.ts";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { openDatabase } from "../../../../../packages/core/src/db/sqlite.ts";
import { createLogger } from "../../../../../packages/core/src/logging/logger.ts";
import { createHindsightReplicaScheduler } from "../../../../../packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts";
import type { HindsightReplicaRunInput } from "../../../../../packages/core/src/memory/hindsight/hindsight-replica-sync-runner.ts";
import { createMemoryOperationService } from "../../../../../packages/core/src/memory/operations/memory-operation-service.ts";
import { AT, GLOBAL, fakeRuntime, fakeSetup } from "../../../../../packages/core/src/memory/operations/memory-operation-fixtures.ts";
import { createHindsightActivationJourney, onboardLocal } from "../../../../../packages/core/src/memory/hindsight-activation/hindsight-activation-journey-fixture.ts";

// Review-only counterexamples. This file intentionally asserts the documented contract and remains red on the reviewed HEAD.
// All state is either in-memory SQLite or the established mkdtemp-based journey; the data-plane runner never calls a service.
describe("Stage 1/2 independent acceptance counterexamples", () => {
  it("does not settle a failed manual sync from the preceding in-flight run's success", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    db.prepare("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id='epoch',verified_snapshot_id='snapshot',activation_transaction_id='tx' WHERE singleton=1").run();
    let time = AT;
    const clock = () => time;
    const repo = createHindsightReplicaSchedulerRepo(db, clock);
    const leases = createHindsightReplicaLeaseRepo(db, clock);
    const uuid = "11111111-1111-4111-8111-111111111111";
    repo.ensureBank({ bank: GLOBAL });
    publishReplicaCheckpoint(db, { previous: null, next: { bankId: GLOBAL.bankId, providerLineageId: uuid, bankGeneration: uuid,
      authorityEpochId: "epoch", replicaEpochId: uuid, endCursor: 8, snapshotId: uuid, snapshotCursor: 8,
      snapshotManifestDigest: "a".repeat(64), manifestDigest: "b".repeat(64), verifiedAt: AT } });
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const triggers: string[] = [];
    const run = async (input: HindsightReplicaRunInput) => {
      triggers.push(input.run.trigger);
      if (triggers.length === 1) {
        await gate;
        time = "2026-09-19T00:00:02.000Z";
        const checkpoint = readReplicaCheckpoint(db, input.bank.bankId)!;
        return { checkpoint, observedCursor: checkpoint.endCursor };
      }
      time = "2026-09-19T00:00:03.000Z";
      throw new Error("HINDSIGHT_UNREACHABLE");
    };
    const scheduler = createHindsightReplicaScheduler({ banks: [GLOBAL], repo,
      replica: { leases, checkpoint: (id) => readReplicaCheckpoint(db, id) }, ownerId: "acceptance",
      runner: { run, rebuild: run }, setTimer: () => setTimeout(() => undefined, 0) });
    const runtime = { ...fakeRuntime([GLOBAL], clock), scheduler };
    const service = createMemoryOperationService({ db, live: () => runtime, setup: fakeSetup(), bootId: "acceptance",
      now: clock, logger: createLogger("fatal"), onChanged: () => {} });
    try {
      scheduler.start();
      const drain = scheduler.tick();
      while (triggers.length < 1) await new Promise<void>((resolve) => setImmediate(resolve));
      time = "2026-09-19T00:00:01.000Z";
      const operation = service.submit({ kind: "replica.sync", bankId: GLOBAL.bankId, syncKind: "incremental" });
      release();
      await drain;
      await service.stop();
      const bank = scheduler.status(GLOBAL.bankId)[0]!;
      const settled = service.status(operation.operationId);
      expect(triggers).toEqual(["catch_up", "manual"]);
      expect(bank).toMatchObject({ mode: "failed", errorCode: "HINDSIGHT_UNREACHABLE",
        lastSuccessAt: "2026-09-19T00:00:02.000Z", lastAttemptAt: "2026-09-19T00:00:02.000Z" });
      console.log(JSON.stringify({ counterexample: "manual-sync-outcome", admittedAt: operation.createdAt, bank, settled }));
      expect(settled).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_UNREACHABLE" });
    } finally {
      release(); await service.stop(); await scheduler.stop(); db.close();
    }
  });

  it("keeps a new Character capture from writing a Local Bank while the Local fence is quiesced", async () => {
    const journey = createHindsightActivationJourney();
    try {
      const epochId = await onboardLocal(journey.session);
      const authority = createCanonicalMemoryAuthorityRepo(journey.session.db);
      const fence = journey.session.runtime.activationLocalRuntime().fence;
      const before = authority.listBanks(epochId);
      await fence.quiesce({ timeoutMs: 1000 });
      try {
        const captured = await journey.session.runtime.captureRun("acceptance-new-character");
        const after = authority.listBanks(epochId);
        console.log(JSON.stringify({ counterexample: "fenced-bank-write", before: before.length, after: after.length,
          writable: fence.writable(), provider: captured.snapshot.providerId, created: after.filter((bank) => !before.some((old) => old.bankId === bank.bankId)) }));
        expect(after).toEqual(before);
      } finally { fence.release(); }
    } finally { await journey.close(); }
  });
});
