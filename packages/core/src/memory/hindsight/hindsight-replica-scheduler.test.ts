import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
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
const roots: string[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at); });
afterEach(async () => {
  for (const scheduler of schedulers.splice(0)) await scheduler.stop();
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-b5-config-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
  vi.useRealTimers();
});

function fixture(banks = [globalBank], now = () => new Date().toISOString(), path = ":memory:") {
  const db = openDatabase({ path, migrations: MIGRATIONS }); dbs.push(db);
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
  it("projects observed Banks with ordinary ordering and fresh checkpoints without scheduling work", () => {
    const second: MemoryReplicaBank = { bankId: "a-character", scope: "character", characterId: "second" };
    const banks = [characterBank, globalBank, second]; const f = fixture(banks);
    const run = vi.fn(async (input: HindsightReplicaRunInput) => f.result(input));
    const scheduler = f.create({ run, rebuild: run });
    const before = scheduler.statusForBanks(banks);
    expect(before).toEqual(scheduler.status());
    expect(before.map((row) => row.bankId)).toEqual(["global", "a-character", "character"]);
    expect(banks.map((bank) => bank.bankId)).toEqual(["character", "global", "a-character"]);
    const previous = readReplicaCheckpoint(f.db, "global")!;
    publishReplicaCheckpoint(f.db, { previous, next: { ...previous, endCursor: 10 } });
    const current = scheduler.statusForBanks(banks);
    expect(current).toEqual(scheduler.status());
    expect(current[0]?.checkpoint?.endCursor).toBe(10);
    expect(before[0]?.checkpoint?.endCursor).toBe(8);
    expect(() => scheduler.statusForBanks([globalBank, globalBank])).toThrow("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
    expect(run).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it("persists per-Bank settings across actual SQLite reopen without changing new-Bank defaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "taki-b5-config-")); roots.push(root);
    const path = join(root, "schedule.db"); const f = fixture([globalBank, characterBank], undefined, path);
    const run = vi.fn(async (input: HindsightReplicaRunInput) => f.result(input));
    const scheduler = f.create({ run, rebuild: run }); scheduler.start();
    const config = { automatic: false, autoIntervalMs: 120_000, fullReconciliationIntervalMs: 864_000_000 };
    expect(scheduler.configure("global", config)).toMatchObject(config);
    expect(scheduler.status("character")[0]).toMatchObject({ automatic: true, autoIntervalMs: 21_600_000, fullReconciliationIntervalMs: 604_800_000 });
    await scheduler.stop(); f.db.close(); dbs.splice(dbs.indexOf(f.db), 1);
    const reopened = openDatabase({ path, migrations: MIGRATIONS }); dbs.push(reopened);
    const repo = createHindsightReplicaSchedulerRepo(reopened);
    expect(repo.ensureBank({ bank: globalBank })).toMatchObject({ ...config, nextDueAt: null, nextFullDueAt: null });
    const restored = createHindsightReplicaScheduler({ repo, banks: [globalBank], ownerId: "reopened",
      replica: { leases: createHindsightReplicaLeaseRepo(reopened, () => new Date().toISOString()), checkpoint: (id) => readReplicaCheckpoint(reopened, id) },
      runner: { run: async () => { throw new Error("manual Bank must stay idle"); }, rebuild: async () => { throw new Error("manual Bank must stay idle"); } } });
    schedulers.push(restored); restored.start(); await restored.tick();
    expect(restored.status("global")[0]).toMatchObject({ ...config, mode: "idle", lastAttemptAt: null });
    expect(repo.ensureBank({ bank: { bankId: "new-character", scope: "character", characterId: "new" } })).toMatchObject({ automatic: true, autoIntervalMs: 21_600_000, fullReconciliationIntervalMs: 604_800_000 });
  });

  it("rearms shorter intervals and removes background wakes immediately in manual mode", async () => {
    const f = fixture(); const run = vi.fn(async (input: HindsightReplicaRunInput) => f.result(input));
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); await scheduler.tick();
    scheduler.configure("global", { automatic: true, autoIntervalMs: 60_000, fullReconciliationIntervalMs: 604_800_000 });
    await vi.advanceTimersByTimeAsync(59_999); expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2);
    scheduler.configure("global", { automatic: false, autoIntervalMs: 120_000, fullReconciliationIntervalMs: 864_000_000 });
    await vi.advanceTimersByTimeAsync(3_600_000); expect(run).toHaveBeenCalledTimes(2);
    scheduler.configure("global", { automatic: true, autoIntervalMs: 120_000, fullReconciliationIntervalMs: 864_000_000 });
    await vi.advanceTimersByTimeAsync(0); expect(run).toHaveBeenCalledTimes(3);
  });

  it("replaces the ordinary sleep with a foreground Pending retry and retains normal failure backoff", async () => {
    const f = fixture(); const run = vi.fn(async (input: HindsightReplicaRunInput) => f.result(input));
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); await scheduler.tick();
    run.mockRejectedValueOnce(new Error("HINDSIGHT_PENDING_REMAINS"));
    scheduler.requestRetry("global", "2026-09-06T00:01:00.000Z");
    expect(scheduler.status()[0]).toMatchObject({ retryDueAt: "2026-09-06T00:01:00.000Z", consecutiveFailures: 0 });
    await vi.advanceTimersByTimeAsync(59_999); expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0].run).toMatchObject({ trigger: "retry", kind: "incremental" });
    expect(scheduler.status()[0]).toMatchObject({ errorCode: "HINDSIGHT_PENDING_REMAINS", retryAttempt: 2,
      retryDueAt: "2026-09-06T00:06:00.000Z", consecutiveFailures: 1 });
    await vi.advanceTimersByTimeAsync(299_999); expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(3);
    expect(scheduler.status()[0]).toMatchObject({ retryDueAt: null, consecutiveFailures: 0 });
  });

  it("selects the Pending poll inside settlement without shortening it to the expired run's lease", async () => {
    const f = fixture(); const dueAt = "2026-09-06T00:11:00.000Z";
    // A queued, unaccepted row stays a failure; its retry still bounds the automatic wake.
    f.db.prepare(`INSERT INTO canonical_memory_authority_epochs(epoch_id,provider_id,provider_lineage_id,status,started_at,reason)
      VALUES ('epoch','hindsight','lineage','active',:at,'planned-switch')`).run({ at });
    f.db.prepare("INSERT INTO canonical_memory_authority_state VALUES (1,'epoch',:at)").run({ at });
    f.db.prepare(`INSERT INTO pending_memory(authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash,phase,version,state_json)
      VALUES ('epoch','global','queued','retain',:hash,'queued',1,:json)`)
      .run({ hash: "a".repeat(64), json: JSON.stringify({ nextRetryAt: dueAt, acceptedAt: null }) });
    const run = vi.fn(async (input: HindsightReplicaRunInput) => f.result(input));
    run.mockRejectedValueOnce(new Error("HINDSIGHT_UNREACHABLE"))
      .mockRejectedValueOnce(new Error("HINDSIGHT_UNREACHABLE"))
      .mockRejectedValueOnce(new Error("HINDSIGHT_PENDING_REMAINS"));
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); await scheduler.tick();
    await vi.advanceTimersByTimeAsync(60_000); await vi.advanceTimersByTimeAsync(300_000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(scheduler.status()[0]).toMatchObject({ mode: "failed", retryAttempt: 3,
      consecutiveFailures: 3, errorCode: "HINDSIGHT_PENDING_REMAINS", retryDueAt: dueAt });
    await vi.advanceTimersByTimeAsync(61_000); expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(238_999); expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(4);
    expect(run.mock.calls[3]?.[0].run.trigger).toBe("retry");
    expect(scheduler.status()[0]).toMatchObject({ mode: "idle", retryDueAt: null, consecutiveFailures: 0 });
  });

  it("keeps a foreground Pending retry through active-run success and wakes at its due time", async () => {
    const f = fixture(); let release!: () => void; let calls = 0;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn(async (input: HindsightReplicaRunInput) => {
      if (++calls === 1) await blocked;
      return f.result(input);
    });
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); const active = scheduler.tick();
    try {
      expect(scheduler.status()[0]?.mode).toBe("running");
      const dueAt = "2026-09-06T00:00:30.000Z";
      scheduler.requestRetry("global", dueAt);
      await vi.advanceTimersByTimeAsync(10_000); expect(run).toHaveBeenCalledTimes(1);
      release(); await active;
      expect(scheduler.status()[0]).toMatchObject({ run: null, mode: "idle", retryDueAt: dueAt, retryAttempt: 1, retryKind: "incremental" });
      await vi.advanceTimersByTimeAsync(19_999); expect(run).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2);
      expect(run.mock.calls[1]?.[0].run).toMatchObject({ trigger: "retry", kind: "incremental" });
      expect(scheduler.status()[0]).toMatchObject({ run: null, retryDueAt: null, retryAttempt: 0, retryKind: null });
    } finally { release(); }
  });

  it("does not arm foreground Pending recovery in manual-only mode", async () => {
    const f = fixture(); const run = vi.fn(async (input: HindsightReplicaRunInput) => f.result(input));
    const scheduler = f.create({ run, rebuild: run });
    scheduler.configure("global", MemoryReplicaScheduleConfigSchema.parse({ automatic: false })); scheduler.start();
    scheduler.requestRetry("global", "2026-09-06T00:01:00.000Z");
    expect(scheduler.status()[0]).toMatchObject({ retryDueAt: null, retryAttempt: 0, catchUpRequested: false });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(6 * 3_600_000); expect(run).not.toHaveBeenCalled();
    scheduler.requestManual("global"); await scheduler.tick(); expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports a failed retry handoff without changing the foreground receipt or inventing a scheduled retry", async () => {
    const f = fixture(); const run = vi.fn(async (input: HindsightReplicaRunInput) => f.result(input));
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); await scheduler.tick();
    f.db.exec(`CREATE TRIGGER fail_retry BEFORE UPDATE ON hindsight_replica_sync_schedule
      BEGIN SELECT RAISE(ABORT, 'retry storage unavailable'); END;`);
    expect(() => scheduler.requestRetry("global", "2026-09-06T00:01:00.000Z")).not.toThrow();
    expect(scheduler.lastError()).toBe("HINDSIGHT_REPLICA_SYNC_FAILED");
    expect(scheduler.status()[0]).toMatchObject({ retryDueAt: null, consecutiveFailures: 0 });
    await vi.advanceTimersByTimeAsync(60_000); expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(["retry", "interval", "full"] as const)("never pushes an earlier %s wake later when another Pending write arms recovery", async (kind) => {
    const f = fixture(); const run = vi.fn(async (input: HindsightReplicaRunInput) => f.result(input));
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); await scheduler.tick();
    if (kind === "retry") scheduler.requestRetry("global", "2026-09-06T00:01:00.000Z");
    else scheduler.configure("global", MemoryReplicaScheduleConfigSchema.parse(kind === "full"
      ? { fullReconciliationIntervalMs: 60_000 } : { autoIntervalMs: 60_000 }));
    scheduler.requestRetry("global", "2026-09-06T00:02:00.000Z");
    expect(scheduler.status()[0]?.retryDueAt).toBe("2026-09-06T00:01:00.000Z");
    await vi.advanceTimersByTimeAsync(60_000); expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0].run.kind).toBe(kind === "full" ? "full" : "incremental");
  });

  it("preserves the active lease and exact queued full request while changing mode and intervals", async () => {
    const f = fixture(); let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const kinds: string[] = [];
    const run = vi.fn(async (input: HindsightReplicaRunInput) => {
      kinds.push(input.run.kind); if (kinds.length === 1) await blocked; return f.result(input);
    });
    const scheduler = f.create({ run, rebuild: run }); scheduler.start(); const active = scheduler.tick();
    const lease = scheduler.status("global")[0]?.run;
    const requestId = "22222222-2222-4222-8222-222222222222";
    scheduler.requestManual("global", "full", requestId);
    const config = { automatic: false, autoIntervalMs: 180_000, fullReconciliationIntervalMs: 172_800_000 };
    expect(scheduler.configure("global", config)).toMatchObject({ ...config, run: lease, pendingManualKind: "full", pendingManualRequestId: requestId });
    expect(scheduler.started()).toBe(true); expect(scheduler.request(requestId)?.state).toBe("queued");
    release(); await active;
    expect(kinds).toEqual(["incremental", "full"]);
    expect(scheduler.request(requestId)?.state).toBe("succeeded");
    expect(scheduler.status("global")[0]).toMatchObject({ ...config, nextDueAt: null, nextFullDueAt: null, run: null, lastFullReconciliationAt: at });
    await vi.advanceTimersByTimeAsync(180_000); expect(kinds).toHaveLength(2);
    expect(() => scheduler.configure("unknown", config)).toThrow("HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED");
    await scheduler.pause();
    expect(() => scheduler.configure("global", config)).toThrow("MEMORY_AUTHORITY_FENCED");
  });
  it("transition pause drains the accepted run, cancels only queued manual work and refuses later admission", async () => {
    const f = fixture(); let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn(async (input: HindsightReplicaRunInput) => { await blocked; return f.result(input); });
    const scheduler = f.create({ run, rebuild: run }); scheduler.start();
    const active = scheduler.tick();
    const queuedId = "22222222-2222-4222-8222-222222222222";
    scheduler.requestManual("global", "incremental", queuedId);
    let settled = false; const pause = scheduler.pause().then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    expect(() => scheduler.requestManual("global", "incremental", "late")).toThrow("MEMORY_AUTHORITY_FENCED");
    expect(() => scheduler.start()).toThrow("MEMORY_AUTHORITY_FENCED");
    expect(scheduler.request("late")).toBeUndefined();
    release(); await active; await pause;
    expect(run).toHaveBeenCalledTimes(1); expect(scheduler.started()).toBe(false);
    expect(scheduler.request(queuedId)).toMatchObject({ state: "cancelled" });
  });
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

  it("records a refused Bank read while re-arming as lastError instead of rejecting the settled tick", async () => {
    const f = fixture(); let refuse = false;
    const run = vi.fn(async (input: HindsightReplicaRunInput) => { refuse = true; return f.result(input); });
    const scheduler = createHindsightReplicaScheduler({ repo: f.repo, replica: { leases: f.leases, checkpoint: (id) => readReplicaCheckpoint(f.db, id) },
      ownerId: "process", runner: { run, rebuild: run },
      banks: () => { if (refuse) throw new Error("MEMORY_AUTHORITY_MISMATCH"); return [globalBank]; } });
    schedulers.push(scheduler); scheduler.start();
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.lastError()).toBe("HINDSIGHT_REPLICA_SYNC_FAILED");
    expect(vi.getTimerCount()).toBe(0);
  });
});
