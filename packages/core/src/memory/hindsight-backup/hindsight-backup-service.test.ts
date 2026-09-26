import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryReplicaBank } from "@taki/shared";
import { publishReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { createCanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import { seedHindsightAuthority } from "../operations/memory-operation-fixtures.ts";
import { AT, BACKUP_ID, backupManifest } from "./hindsight-backup-fixtures.ts";
import { createNativeBackupRouteDouble } from "./hindsight-backup-route-fixtures.ts";
import { createHindsightBackupService, type HindsightBackupRuntime, type HindsightBackupServiceInput } from "./hindsight-backup-service.ts";
import { createHindsightBackupStore, type HindsightBackupStore } from "./hindsight-backup-store.ts";

const LINEAGE = "11111111-1111-4111-8111-111111111111";
const GENERATION = "33333333-3333-4333-8333-333333333333";
const OPERATION_ID = "44444444-4444-4444-8444-444444444444";
const BANK: MemoryReplicaBank = { bankId: "taki-hs-g", scope: "global", characterId: null };
const hex = (character: string) => character.repeat(64);

const dirs: string[] = []; const dbs: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });

interface HarnessOptions {
  wrapStore?: (store: HindsightBackupStore) => HindsightBackupStore;
  custody?: HindsightBackupServiceInput["custody"];
  quiesceTimeoutMs?: number; nativeTimeoutMs?: number;
}

function harness(options: HarnessOptions = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-backup-service-")); dirs.push(dataDir);
  const db = openDatabase({ path: join(dataDir, "state.db"), migrations: MIGRATIONS }); dbs.push(db);
  seedHindsightAuthority(db);
  publishReplicaCheckpoint(db, { previous: null, next: { providerLineageId: LINEAGE, bankId: BANK.bankId, bankGeneration: GENERATION,
    authorityEpochId: "epoch", replicaEpochId: "55555555-5555-4555-8555-555555555555", endCursor: 5,
    snapshotId: "66666666-6666-4666-8666-666666666666", snapshotCursor: 0, snapshotManifestDigest: hex("a"), manifestDigest: hex("b"), verifiedAt: AT } });
  const store = createHindsightBackupStore(dataDir);
  const route = createNativeBackupRouteDouble({ providerLineage: LINEAGE, receipts: new Set(),
    banks: new Map([[BANK.bankId, { bankGeneration: GENERATION, currentCursor: 5, application: null }]]) });
  let started = true;
  const scheduler = { started: vi.fn(() => started), stop: vi.fn(async () => { started = false; }), start: vi.fn(() => { started = true; }) };
  const runtime: HindsightBackupRuntime = { epochId: "epoch", configFingerprint: hex("f"), deploymentMode: "existing-instance",
    banks: () => [BANK], scheduler, writeFence: createCanonicalLocalWriteFence() };
  const fence = runtime.writeFence as ReturnType<typeof createCanonicalLocalWriteFence>;
  const { logger, records: logs } = createCaptureLogger();
  const service = createHindsightBackupService({ db, store: options.wrapStore?.(store) ?? store, route, logger, now: () => AT,
    custody: options.custody ?? (() => backupManifest({ sha256: hex("0"), bytes: 1, pages: 1 }).custody),
    quiesceTimeoutMs: options.quiesceTimeoutMs ?? 1_000, nativeTimeoutMs: options.nativeTimeoutMs ?? 5_000 });
  const phases: string[] = [];
  const capture = () => service.capture({ operationId: OPERATION_ID, backupId: BACKUP_ID, runtime, checkpoint: (phase) => { phases.push(phase); } });
  return { dataDir, db, store, route, scheduler, runtime, fence, logs, service, phases, capture };
}
type Harness = ReturnType<typeof harness>;

/** A native-confirmed tracked Pending row: its Core terminal id is `native-operation:<bank>:<gen>:retain:<remote>`. */
function seedConfirmedRetain(db: Database, remote: string): string {
  db.prepare(`INSERT INTO pending_memory (authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash,phase,version,state_json)
    VALUES ('epoch',:bank,:operation,'retain',:hash,'completed',1,:state)`).run({ bank: BANK.bankId, operation: `op-${remote}`, hash: hex("c"),
    state: JSON.stringify({ remoteOperationId: remote, intent: { bankGeneration: GENERATION }, dispatch: { protocol: "tracked_native_v1" }, nativeReceipt: {} }) });
  return `native-operation:${BANK.bankId}:${GENERATION}:retain:${remote}`;
}

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
    h.service.stop();
    expect(await pending).toMatchObject({ ok: false, code: "HINDSIGHT_BACKUP_NATIVE_FAILED" });
    expect(h.fence.writable()).toBe(true);
    expect(h.scheduler.start).toHaveBeenCalledTimes(1);
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
    expect(outcome).toMatchObject({ ok: true, manifest: { terminalOperations: { count: 1 }, banks: [{ core: { replicaCursor: 5 } }] } });
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
