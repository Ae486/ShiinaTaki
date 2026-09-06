import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryReplicaScheduleConfigSchema, type MemoryReplicaBank, type MemoryReplicaScheduledRun } from "@taki/shared";
import { createHindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import { createHindsightReplicaLeaseRepo } from "../../db/hindsight-replica-lease-repo.ts";
import { publishReplicaCheckpoint, readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createHindsightReplicaScheduler, type HindsightReplicaScheduler } from "./hindsight-replica-scheduler.ts";
import type { HindsightReplicaRunInput, HindsightReplicaSchedulerRunner } from "./hindsight-replica-sync-runner.ts";

const at = "2026-09-06T00:00:00.000Z";
const globalBank: MemoryReplicaBank = { bankId: "global", scope: "global", characterId: null };
const characterBank: MemoryReplicaBank = { bankId: "character", scope: "character", characterId: "taki" };
const dbs: Database[] = []; const schedulers: HindsightReplicaScheduler[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at); });
afterEach(async () => {
  for (const scheduler of schedulers.splice(0)) await scheduler.stop();
  for (const db of dbs.splice(0)) db.close();
  vi.useRealTimers();
});

function fixture(banks = [globalBank], now = () => new Date().toISOString()) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const repo = createHindsightReplicaSchedulerRepo(db, now);
  const leases = createHindsightReplicaLeaseRepo(db, now);
  const uuid = "11111111-1111-4111-8111-111111111111";
  for (const bank of banks) {
    repo.ensureBank({ bank });
    publishReplicaCheckpoint(db, { previous: null, next: { bankId: bank.bankId, providerLineageId: uuid,
      bankGeneration: uuid, authorityEpochId: "authority", replicaEpochId: uuid, endCursor: 8,
      snapshotId: uuid, snapshotCursor: 8, snapshotManifestDigest: "a".repeat(64), manifestDigest: "b".repeat(64), verifiedAt: now() } });
  }
  const result = (input: HindsightReplicaRunInput) => {
    const checkpoint = readReplicaCheckpoint(db, input.bank.bankId);
    if (!checkpoint) throw new Error("fixture missing checkpoint");
    return { checkpoint, observedCursor: checkpoint.endCursor };
  };
  const create = (runner: HindsightReplicaSchedulerRunner, options: { runTimeoutMs?: number; setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout> } = {}) => {
    const scheduler = createHindsightReplicaScheduler({ banks, repo, replica: { leases, checkpoint: (id) => readReplicaCheckpoint(db, id) },
      ownerId: "process", runner, ...options });
    schedulers.push(scheduler); return scheduler;
  };
  return { db, repo, leases, result, create };
}

describe("B5 asynchronous single-flight scheduler", () => {
  it("keeps start non-blocking and isolates one failed Bank from another Bank's progress", async () => {
    const f = fixture([globalBank, characterBank]);
    const run = vi.fn(async (input: HindsightReplicaRunInput) => {
      if (input.bank.bankId === "global") throw new Error("private credential in upstream failure");
      return f.result(input);
    });
    const scheduler = f.create({ run, rebuild: async (input) => f.result(input) });
    scheduler.start(); expect(run).not.toHaveBeenCalled();
    await scheduler.tick();
    expect(run).toHaveBeenCalledTimes(2);
    expect(scheduler.status("global")[0]).toMatchObject({ mode: "failed", errorCode: "HINDSIGHT_REPLICA_SYNC_FAILED",
      lastSuccessAt: null, lag: null, checkpoint: { endCursor: 8 } });
    expect(scheduler.status("character")[0]).toMatchObject({ mode: "idle", lastSuccessAt: at, lag: 0, checkpoint: { endCursor: 8 } });
    expect(JSON.stringify(scheduler.status())).not.toContain("credential");
    expect(scheduler.status()[0]).not.toHaveProperty("pendingCount");
  });

  it("coalesces concurrent ticks and preserves a manual full request arriving in flight", async () => {
    const f = fixture(); const kinds: string[] = [];
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const runner = { run: async (input: HindsightReplicaRunInput) => {
      kinds.push(input.run.kind); if (kinds.length === 1) await pending; return f.result(input);
    }, rebuild: async (input: HindsightReplicaRunInput) => f.result(input) };
    const scheduler = f.create(runner); scheduler.start();
    const first = scheduler.tick();
    expect(scheduler.tick()).toBe(first);
    expect(scheduler.requestManual("global", "full").pendingManualKind).toBe("full");
    scheduler.requestManual("global", "incremental");
    expect(kinds).toEqual(["incremental"]);
    release(); await first;
    expect(kinds).toEqual(["incremental", "full"]);
    expect(scheduler.status()[0]).toMatchObject({ pendingManualKind: null, lastFullReconciliationAt: at });
  });

  it("does not let overdue ordinary/full polls bypass automatic retry backoff", async () => {
    const f = fixture();
    f.repo.ensureBank({ bank: globalBank, config: MemoryReplicaScheduleConfigSchema.parse({ fullReconciliationIntervalMs: 60_000 }) });
    const run = vi.fn(async (input: HindsightReplicaRunInput) => { void input; throw new Error("HINDSIGHT_UNREACHABLE"); });
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); await scheduler.tick();
    await vi.advanceTimersByTimeAsync(59_999); expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map(([input]) => input.run.kind)).toEqual(["incremental", "incremental"]);
    await vi.advanceTimersByTimeAsync(299_999); expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps full reconciliation independently scheduled from successful ordinary polling", async () => {
    const f = fixture();
    f.repo.ensureBank({ bank: globalBank, config: MemoryReplicaScheduleConfigSchema.parse({ autoIntervalMs: 600_000, fullReconciliationIntervalMs: 60_000 }) });
    const run = vi.fn(async (input: HindsightReplicaRunInput) => f.result(input));
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); await scheduler.tick();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run.mock.calls.map(([input]) => input.run.kind)).toEqual(["incremental", "full"]);
    expect(scheduler.status()[0]?.lastFullReconciliationAt).toBe("2026-09-06T00:01:00.000Z");
  });

  it("allows immediate manual action before backoff while manual mode never arms a retry", async () => {
    const f = fixture();
    const run = vi.fn(async (input: HindsightReplicaRunInput) => { void input; throw new Error("HINDSIGHT_UNREACHABLE"); });
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); await scheduler.tick();
    scheduler.requestManual("global"); await scheduler.tick(); expect(run).toHaveBeenCalledTimes(2);
    f.repo.ensureBank({ bank: globalBank, config: MemoryReplicaScheduleConfigSchema.parse({ automatic: false }) });
    scheduler.requestManual("global", "full"); await scheduler.tick();
    expect(scheduler.status()[0]).toMatchObject({ retryDueAt: null, nextDueAt: null, nextFullDueAt: null, consecutiveFailures: 3 });
    await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60_000); expect(run).toHaveBeenCalledTimes(3);
  });

  it("performs exactly one restart/reconnection catch-up before a persisted retry is due", async () => {
    const f = fixture();
    const failed = f.create({ run: async () => { throw new Error("HINDSIGHT_UNREACHABLE"); }, rebuild: async (input) => f.result(input) });
    failed.start(); await failed.tick(); await failed.stop();
    const run = vi.fn(async (input: HindsightReplicaRunInput) => f.result(input));
    const resumed = f.create({ run, rebuild: run }); resumed.start(); resumed.start();
    resumed.verifiedReconnect(); resumed.verifiedReconnect(); await resumed.tick();
    expect(run).toHaveBeenCalledTimes(1);
    resumed.verifiedReconnect(); await resumed.tick(); expect(run).toHaveBeenCalledTimes(1);
    expect(resumed.status()[0]).toMatchObject({ consecutiveFailures: 0, retryDueAt: null, catchUpRequested: false });
  });

  it("bounds stop even when an adapter ignores abort, rejects late settlement, and uses a fresh controller after restart", async () => {
    const f = fixture(); const calls: HindsightReplicaRunInput[] = [];
    f.repo.ensureBank({ bank: globalBank, config: MemoryReplicaScheduleConfigSchema.parse({ automatic: false }) });
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const run = async (input: HindsightReplicaRunInput) => { calls.push(input); if (calls.length === 1) await pending; return f.result(input); };
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); scheduler.requestManual("global");
    const active = scheduler.tick(); const old = calls[0]!;
    await scheduler.stop(); await active;
    expect(old.signal.aborted).toBe(true);
    expect(scheduler.status()[0]).toMatchObject({ mode: "failed", errorCode: "HINDSIGHT_CANCELLED", retryDueAt: null, lastSuccessAt: null });
    expect(() => f.repo.succeed({ run: old.run, result: f.result(old) })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    scheduler.start(); scheduler.requestManual("global"); await scheduler.tick();
    expect(calls[1]?.signal.aborted).toBe(false);
    const settled = scheduler.status()[0]; release(); await Promise.resolve(); await Promise.resolve();
    expect(scheduler.status()[0]).toEqual(settled);
  });

  it("times out a stalled Bank without blocking the next Bank", async () => {
    const f = fixture([globalBank, characterBank]);
    const runner = { run: async (input: HindsightReplicaRunInput) => {
      if (input.bank.bankId === "global") await new Promise<void>(() => undefined);
      return f.result(input);
    }, rebuild: async (input: HindsightReplicaRunInput) => f.result(input) };
    const scheduler = f.create(runner, { runTimeoutMs: 100 }); scheduler.start(); const active = scheduler.tick();
    await vi.advanceTimersByTimeAsync(100); await active;
    expect(scheduler.status("global")[0]).toMatchObject({ errorCode: "HINDSIGHT_TIMEOUT", lastSuccessAt: null });
    expect(scheduler.status("character")[0]?.lastSuccessAt).not.toBeNull();
  });

  it("uses the injected repository clock when calculating the next wake", async () => {
    const f = fixture([globalBank], () => "2020-01-01T00:00:00.000Z");
    const setTimer = vi.fn((callback: () => void, ms: number) => setTimeout(callback, ms));
    const run = async (input: HindsightReplicaRunInput) => f.result(input);
    const scheduler = f.create({ run, rebuild: run }, { setTimer }); scheduler.start(); await scheduler.tick();
    expect(setTimer.mock.calls.at(-1)?.[1]).toBe(60 * 60_000);
  });

  it("bounds a supervisor claim failure without preventing another Bank from completing", async () => {
    const f = fixture([globalBank, characterBank]);
    const setTimer = vi.fn((callback: () => void, ms: number) => setTimeout(callback, ms));
    const run = vi.fn(async (input: HindsightReplicaRunInput) => f.result(input));
    const scheduler = f.create({ run, rebuild: run }, { setTimer }); scheduler.start();
    f.db.exec(`CREATE TRIGGER fail_claim BEFORE UPDATE ON hindsight_replica_sync_schedule
      WHEN NEW.bank_id='global' BEGIN SELECT RAISE(ABORT, 'private database failure'); END;`);
    await scheduler.tick();
    expect(run.mock.calls.map(([input]) => input.bank.bankId)).toEqual(["character"]);
    expect(scheduler.lastError()).toBe("HINDSIGHT_REPLICA_SYNC_FAILED");
    expect(setTimer.mock.calls.at(-1)?.[1]).toBe(60_000);
    f.db.exec("DROP TRIGGER fail_claim");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run.mock.calls.map(([input]) => input.bank.bankId)).toEqual(["character", "global"]);
  });

  it("does not retry a failed manual claim until another explicit request", async () => {
    const f = fixture();
    f.repo.ensureBank({ bank: globalBank, config: MemoryReplicaScheduleConfigSchema.parse({ automatic: false }) });
    const run = vi.fn(async (input: HindsightReplicaRunInput) => f.result(input));
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); scheduler.requestManual("global", "full");
    f.db.exec("CREATE TRIGGER fail_claim BEFORE UPDATE ON hindsight_replica_sync_schedule BEGIN SELECT RAISE(ABORT, 'private database failure'); END;");
    await scheduler.tick();
    expect(scheduler.lastError()).toBe("HINDSIGHT_REPLICA_SYNC_FAILED");
    expect(scheduler.status()[0]?.pendingManualKind).toBe("full");
    expect(vi.getTimerCount()).toBe(0);
    f.db.exec("DROP TRIGGER fail_claim");
    await vi.advanceTimersByTimeAsync(60_000); expect(run).not.toHaveBeenCalled();
    scheduler.requestManual("global"); await scheduler.tick();
    expect(run.mock.calls.map(([input]) => input.run.kind)).toEqual(["full"]);
  });

  it("does not publish status from a superseded run that completes late", async () => {
    const f = fixture(); let release: () => void = () => undefined; let old: MemoryReplicaScheduledRun | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const run = async (input: HindsightReplicaRunInput) => { old = input.run; await pending; return f.result(input); };
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); const active = scheduler.tick();
    vi.setSystemTime(new Date(Date.parse(at) + 61_000)); f.repo.recover("global");
    const next = f.repo.claim({ bankId: "global", ownerId: "replacement", leaseDurationMs: 60_000 });
    expect(next?.lease.fence).toBe(old!.lease.fence + 1);
    const before = f.repo.get("global"); release(); await active;
    expect(f.repo.get("global")).toEqual(before);
  });
});
