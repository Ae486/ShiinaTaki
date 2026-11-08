import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { createMaintenanceAutoMemory } from "../auto-memory.ts";
import { fenceHindsightWriters, type HindsightWriters } from "../hindsight/hindsight-writer-fence.ts";
import { AT, BACKUP_ID } from "./hindsight-backup-fixtures.ts";
import {
  backupHarness, HARNESS_BANK as BANK, HARNESS_GENERATION as GENERATION, HARNESS_LINEAGE as LINEAGE, HARNESS_OPERATION_ID as OPERATION_ID, seedConfirmedRetain,
  type BackupHarness as Harness, type BackupHarnessOptions as HarnessOptions,
} from "./hindsight-backup-harness.ts";

const dirs: string[] = []; const dbs: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });

const harness = (options?: HarnessOptions) => backupHarness({ dirs, dbs }, options);

function leftovers(h: Harness): string[] {
  return existsSync(h.store.root) ? readdirSync(h.store.root).filter((name) => name !== "quarantine") : [];
}

describe("hindsight backup capture producer", () => {
  it("pauses writers and the scheduler, copies Core, pairs the native proof and seals a listed manifest", async () => {
    const h = harness();
    const terminal = seedConfirmedRetain(h.db, "remote-1"); h.route.state.receipts.add(terminal);
    let duringNative: unknown;
    h.route.onSnapshot = async () => {
      duringNative = { writable: h.fence.writable(), stopped: h.scheduler.stop.mock.calls.length, started: h.scheduler.start.mock.calls.length,
        write: await h.fence.admit(() => "written").catch((error: Error) => error.message) };
    };
    const outcome = await h.capture();
    expect(outcome).toMatchObject({ ok: true });
    expect(duringNative).toEqual({ writable: false, stopped: 1, started: 0, write: "MEMORY_AUTHORITY_FENCED" });
    expect(h.phases).toEqual(["quiescing", "capturing-core", "capturing-native", "verifying", "sealing"]);
    expect(h.route.requests[0]).toMatchObject({ backupId: BACKUP_ID, providerLineageId: LINEAGE, nativeBankIds: [BANK.bankId], operationIds: [terminal] });
    const [listed] = await h.store.list();
    expect(listed).toMatchObject({ backupId: BACKUP_ID, operationId: OPERATION_ID, route: "native-endpoint", verifiedAt: AT,
      core: { migrationHead: Math.max(...MIGRATIONS.map((migration) => migration.version)) },
      authority: { epochId: "epoch", activationTransactionId: "tx", providerLineageId: LINEAGE, deploymentMode: "existing-instance" },
      banks: [{ bankId: "global", nativeBankId: BANK.bankId, bankGeneration: GENERATION, core: { replicaCursor: 5, applicationNativeCursor: null } }],
      terminalOperations: { count: 1 } });
    expect(h.fence.writable()).toBe(true);
    expect(h.scheduler.start).toHaveBeenCalledTimes(1);
    expect(leftovers(h)).toEqual([BACKUP_ID]);
  });

  it("leaves a scheduler that was not running stopped", async () => {
    const h = harness();
    await h.scheduler.stop(); h.scheduler.stop.mockClear();
    expect(await h.capture()).toMatchObject({ ok: true });
    expect(h.scheduler.start).not.toHaveBeenCalled();
  });

  it("logs a scheduler that fails to restart without failing the sealed capture", async () => {
    const h = harness();
    h.scheduler.start.mockImplementation(() => { throw new Error("HINDSIGHT_REPLICA_BUSY"); });
    expect(await h.capture()).toMatchObject({ ok: true });
    expect(h.logs.some((log) => (log.obj as { code?: string } | undefined)?.code === "HINDSIGHT_REPLICA_SCHEDULE_STALE")).toBe(true);
  });

  it("times out behind detached post-turn maintenance, then retries after the same owner settles without repeating work", async () => {
    const h = harness({ quiesceTimeoutMs: 20 });
    let finish = (): void => undefined;
    const maintenance = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const raw = { maintenance: { run: maintenance } } as unknown as HindsightWriters;
    const writers = fenceHindsightWriters(raw, h.fence);
    const autoMemory = createMaintenanceAutoMemory({ maintenance: () => writers.maintenance,
      logger: { info: vi.fn(), warn: vi.fn() } });

    const detached = autoMemory.onTurnCompleted("taki");
    try {
      await vi.waitFor(() => { expect(maintenance).toHaveBeenCalledOnce(); });

      expect(await h.capture()).toMatchObject({ ok: false, code: "HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT" });
      expect(await h.store.list()).toEqual([]);
      expect(leftovers(h)).toEqual([]);
      expect(h.fence.writable()).toBe(true);

      finish();
      await detached;
      await autoMemory.settle();

      expect(await h.capture()).toMatchObject({ ok: true, verifiedAt: AT });
      expect(maintenance).toHaveBeenCalledOnce();
      expect(await h.store.list()).toHaveLength(1);
      expect(leftovers(h)).toEqual([BACKUP_ID]);
      expect(h.fence.writable()).toBe(true);
    } finally {
      finish();
      await autoMemory.stop();
    }
  });
});

type FailureCase = { name: string; code: string; paused: boolean; options?: HarnessOptions; arrange?: (h: Harness) => (() => void) | void };

const FAILURES: FailureCase[] = [
  { name: "no native route", code: "HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE", paused: false, arrange: (h) => { h.route.unavailable = true; } },
  { name: "an admitted write outlives quiescence", code: "HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT", paused: false, options: { quiesceTimeoutMs: 20 },
    arrange: (h) => { let finish = (): void => undefined; void h.fence.admit(() => new Promise<void>((done) => { finish = done; })); return () => finish(); } },
  { name: "the marker epoch moved", code: "MEMORY_AUTHORITY_MISMATCH", paused: true, arrange: (h) => { h.runtime.epochId = "other-epoch"; } },
  { name: "custody cannot be read", code: "HINDSIGHT_BACKUP_INTERNAL_ERROR", paused: true, options: { custody: () => { throw new Error("catalog"); } } },
  { name: "the backup dir cannot be created", code: "HINDSIGHT_BACKUP_STORAGE_FAILED", paused: true,
    options: { wrapStore: (store) => ({ ...store, begin: () => Promise.reject(new Error("EACCES")) }) } },
  { name: "the SQLite online backup fails", code: "HINDSIGHT_BACKUP_CORE_CAPTURE_FAILED", paused: true,
    arrange: (h) => { vi.spyOn(h.db, "backupTo").mockRejectedValue(new Error("SQLITE_IOERR")); } },
  { name: "the native snapshot fails", code: "HINDSIGHT_BACKUP_NATIVE_FAILED", paused: true, arrange: (h) => { h.route.fail = new Error("pg_dump"); } },
  { name: "the native proof is malformed", code: "HINDSIGHT_BACKUP_NATIVE_FAILED", paused: true, arrange: (h) => { h.route.fail = { proof: { banks: [] } }; } },
  { name: "the native route ignores its deadline", code: "HINDSIGHT_BACKUP_NATIVE_FAILED", paused: true, options: { nativeTimeoutMs: 30 },
    arrange: (h) => { h.route.fail = "hang"; } },
  { name: "native is behind the Core copy", code: "HINDSIGHT_BACKUP_PAIR_MISMATCH", paused: true,
    arrange: (h) => { h.route.state.banks.get(BANK.bankId)!.currentCursor = 4; } },
  { name: "the manifest cannot be sealed", code: "HINDSIGHT_BACKUP_STORAGE_FAILED", paused: true,
    options: { wrapStore: (store) => ({ ...store, seal: () => Promise.reject(new Error("EIO")) }) } },
];

describe("hindsight backup capture failures (§4 Capture)", () => {
  it.each(FAILURES)("$name settles $code with no listed artifact, the fence released and the scheduler resumed", async (failure) => {
    const h = harness(failure.options);
    const cleanup = failure.arrange?.(h);
    const outcome = await h.capture();
    cleanup?.();
    expect(outcome).toMatchObject({ ok: false, code: failure.code });
    expect(await h.store.list()).toEqual([]);
    expect(leftovers(h)).toEqual([]);
    expect(h.fence.writable()).toBe(true);
    expect(h.scheduler.stop).toHaveBeenCalledTimes(failure.paused ? 1 : 0);
    expect(h.scheduler.start).toHaveBeenCalledTimes(failure.paused ? 1 : 0);
  });

  it("names the Bank and reason of a pair mismatch", async () => {
    const h = harness();
    h.route.state.banks.get(BANK.bankId)!.currentCursor = 4;
    expect(await h.capture()).toEqual({ ok: false, code: "HINDSIGHT_BACKUP_PAIR_MISMATCH", mismatch: { reason: "replica_cursor", bankId: "global" } });
  });

  it("stop() aborts an in-flight native snapshot and releases everything", async () => {
    const h = harness();
    h.route.fail = "hang";
    const pending = h.capture();
    await vi.waitFor(() => { expect(h.route.requests).toHaveLength(1); });
    await h.service.stop();
    expect(await pending).toMatchObject({ ok: false, code: "HINDSIGHT_BACKUP_NATIVE_FAILED" });
    expect(h.fence.writable()).toBe(true);
    expect(h.scheduler.start).toHaveBeenCalledTimes(1);
  });

  it("stop() during the Core copy resolves only after the capture released its pause and restarted the scheduler", async () => {
    const h = harness();
    let copied = (): void => undefined;
    const copy = h.db.backupTo.bind(h.db);
    const backupTo = vi.spyOn(h.db, "backupTo").mockImplementation(async (path) => {
      await new Promise<void>((done) => { copied = done; });
      return copy(path);
    });
    const pending = h.capture();
    await vi.waitFor(() => { expect(backupTo).toHaveBeenCalledTimes(1); });
    const stopped = h.service.stop();
    setTimeout(() => copied(), 20);
    await stopped;
    expect(h.scheduler.start).toHaveBeenCalledTimes(1);
    expect(h.fence.writable()).toBe(true);
    expect(await pending).toMatchObject({ ok: false, code: "HINDSIGHT_BACKUP_NATIVE_FAILED" });
  });

  it("quarantines a leftover partial dir exactly once and never lists it", async () => {
    const h = harness();
    await h.store.begin(BACKUP_ID);
    expect(h.service.quarantine(BACKUP_ID)).toBe(true);
    expect(h.service.quarantine(BACKUP_ID)).toBe(false);
    expect(leftovers(h)).toEqual([]);
    expect(await h.store.list()).toEqual([]);
  });
});

describe("inter-capture writes (§5.4)", () => {
  it("accepts a write landing natively after the Core copy: native is a superset, the copy stays at its own lower bound", async () => {
    const h = harness();
    const before = seedConfirmedRetain(h.db, "remote-1"); h.route.state.receipts.add(before);
    h.route.onSnapshot = () => {
      // Ingestion is not fenced: its primary witness keeps committing while the native half is taken.
      const after = seedConfirmedRetain(h.db, "remote-2");
      h.route.state.receipts.add(after); h.route.state.banks.get(BANK.bankId)!.currentCursor = 6;
    };
    const outcome = await h.capture();
    expect(outcome).toEqual({ ok: true, verifiedAt: AT });
    expect(await h.store.list()).toMatchObject([{ terminalOperations: { count: 1 }, banks: [{ core: { replicaCursor: 5 } }] }]);
    const copy = openDatabase({ path: join(h.store.root, BACKUP_ID, "core.sqlite"), migrations: MIGRATIONS }); dbs.push(copy);
    expect(copy.prepare("SELECT count(*) AS n FROM pending_memory").get()?.n).toBe(1);
  });

  it("refuses a Core terminal success whose native receipt is missing", async () => {
    const h = harness();
    seedConfirmedRetain(h.db, "remote-1");
    expect(await h.capture()).toEqual({ ok: false, code: "HINDSIGHT_BACKUP_PAIR_MISMATCH", mismatch: { reason: "receipt_missing", bankId: null } });
    expect(await h.store.list()).toEqual([]);
  });
});
