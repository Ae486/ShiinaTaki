/**
 * INPUT:  none — test-only composition of a migrated Core DB under a committed Hindsight marker, one replica checkpoint, the
 *         artifact store, the native route double, a scheduler/fence runtime and a capture logger
 * OUTPUT: backupHarness() (service + capture(route) + phases), seedConfirmedRetain(), seedVerifiedBank(), operatorZip() building the route-b ZIP the
 *         native CLI must produce from a staged native-request.json, withoutTaki(), putInbox() and harnessStaged()
 * POS:    core/memory/hindsight-backup — test support; not in the production path
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { HindsightBackupNativeRequestSchema, type HindsightBackupRoute, type MemoryReplicaBank } from "@taki/shared";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { publishReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { createCanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import { seedHindsightAuthority } from "../operations/memory-operation-fixtures.ts";
import { AT, BACKUP_ID, backupManifest } from "./hindsight-backup-fixtures.ts";
import { createNativeBackupRouteDouble, type NativeBackupRouteDouble } from "./hindsight-backup-route-fixtures.ts";
import { createHindsightBackupService, type HindsightBackupRuntime, type HindsightBackupServiceInput } from "./hindsight-backup-service.ts";
import { createHindsightBackupStore, HINDSIGHT_BACKUP_REQUEST_FILE, type HindsightBackupStore } from "./hindsight-backup-store.ts";

export const HARNESS_LINEAGE = "11111111-1111-4111-8111-111111111111";
export const HARNESS_GENERATION = "33333333-3333-4333-8333-333333333333";
export const HARNESS_OPERATION_ID = "44444444-4444-4444-8444-444444444444";
export const HARNESS_BANK: MemoryReplicaBank = { bankId: "taki-hs-g", scope: "global", characterId: null };
const hex = (character: string) => character.repeat(64);

export interface BackupHarnessOptions {
  wrapStore?: (store: HindsightBackupStore) => HindsightBackupStore;
  custody?: HindsightBackupServiceInput["custody"];
  missingCredentials?: HindsightBackupServiceInput["missingCredentials"];
  quiesceTimeoutMs?: number; nativeTimeoutMs?: number;
}

/** Every created dir and DB is pushed to `cleanup` so the caller's afterEach can release them. */
export function backupHarness(cleanup: { dirs: string[]; dbs: Database[] }, options: BackupHarnessOptions = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-backup-")); cleanup.dirs.push(dataDir);
  const db = openDatabase({ path: join(dataDir, "state.db"), migrations: MIGRATIONS }); cleanup.dbs.push(db);
  seedHindsightAuthority(db);
  publishReplicaCheckpoint(db, { previous: null, next: { providerLineageId: HARNESS_LINEAGE, bankId: HARNESS_BANK.bankId,
    bankGeneration: HARNESS_GENERATION, authorityEpochId: "epoch", replicaEpochId: "55555555-5555-4555-8555-555555555555", endCursor: 5,
    snapshotId: "66666666-6666-4666-8666-666666666666", snapshotCursor: 0, snapshotManifestDigest: hex("a"), manifestDigest: hex("b"), verifiedAt: AT } });
  const store = createHindsightBackupStore(dataDir);
  const route = createNativeBackupRouteDouble({ providerLineage: HARNESS_LINEAGE, receipts: new Set(),
    banks: new Map([[HARNESS_BANK.bankId, { bankGeneration: HARNESS_GENERATION, currentCursor: 5, application: null }]]) });
  let started = true;
  const scheduler = { started: vi.fn(() => started), stop: vi.fn(async () => { started = false; }), start: vi.fn(() => { started = true; }) };
  const runtime: HindsightBackupRuntime = { epochId: "epoch", configFingerprint: hex("f"), deploymentMode: "existing-instance",
    banks: () => [HARNESS_BANK], scheduler, writeFence: createCanonicalLocalWriteFence() };
  const fence = runtime.writeFence as ReturnType<typeof createCanonicalLocalWriteFence>;
  const { logger, records: logs } = createCaptureLogger();
  const service = createHindsightBackupService({ db, store: options.wrapStore?.(store) ?? store, route, logger, now: () => AT,
    custody: options.custody ?? (() => backupManifest({ sha256: hex("0"), bytes: 1, pages: 1 }).custody),
    missingCredentials: options.missingCredentials ?? (() => []),
    quiesceTimeoutMs: options.quiesceTimeoutMs ?? 1_000, nativeTimeoutMs: options.nativeTimeoutMs ?? 5_000 });
  const phases: string[] = [];
  const capture = (route: HindsightBackupRoute = "native-endpoint") => service.capture({ operationId: HARNESS_OPERATION_ID, backupId: BACKUP_ID,
    route, runtime, checkpoint: (phase) => { phases.push(phase); } });
  return { dataDir, db, store, route, scheduler, runtime, fence, logs, service, phases, capture };
}
export type BackupHarness = ReturnType<typeof backupHarness>;

/** A native-confirmed tracked Pending row: its Core terminal id is `native-operation:<bank>:<gen>:retain:<remote>`. */
export function seedConfirmedRetain(db: Database, remote: string): string {
  db.prepare(`INSERT INTO pending_memory (authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash,phase,version,state_json)
    VALUES ('epoch',:bank,:operation,'retain',:hash,'completed',1,:state)`).run({ bank: HARNESS_BANK.bankId, operation: `op-${remote}`, hash: hex("c"),
    state: JSON.stringify({ remoteOperationId: remote, intent: { bankGeneration: HARNESS_GENERATION }, dispatch: { protocol: "tracked_native_v1" }, nativeReceipt: {} }) });
  return `native-operation:${HARNESS_BANK.bankId}:${HARNESS_GENERATION}:retain:${remote}`;
}

/** The harness Bank as a verified B3 setup row, which is what the backup status reads as a Bank to account for. */
export function seedVerifiedBank(db: Database): void {
  createHindsightBankSetupRepo(db).upsert({ scope: "global", canonicalIdentity: "global", externalBankId: HARNESS_BANK.bankId,
    templateRevision: "taki-bank-v1", templateDigest: hex("a"), status: "verified", operationIds: [], lastVerifiedAt: AT, lastError: null });
}

export interface OperatorZipOptions {
  /** Edits the parsed native manifest (with its `taki` object) before it is zipped. */
  manifest?: (manifest: Record<string, unknown>) => Record<string, unknown>;
  /** Extra or replacement ZIP entries. */
  entries?: Record<string, Uint8Array>;
}

/**
 * What the native CLI must write for route b (W5 contract): `<table>.bin` binary-COPY entries plus `manifest.json` v2 whose
 * `taki` object echoes the request's backupId, carries the native proof read in the snapshot transaction (no ZIP digest)
 * and pins each `.bin` entry's bytes and sha256. The proof here comes from the route double's state for the staged request.
 */
export async function operatorZip(staged: { root: string; backupId: string; route: NativeBackupRouteDouble }, options: OperatorZipOptions = {}): Promise<Buffer> {
  const path = join(staged.root, `${staged.backupId}.staged`, HINDSIGHT_BACKUP_REQUEST_FILE);
  const request = HindsightBackupNativeRequestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const { proof } = await staged.route.snapshot({ ...request, signal: new AbortController().signal });
  const body = Object.fromEntries(Object.entries(proof).filter(([key]) => key !== "zipSha256" && key !== "zipBytes"));
  const table = strToU8("PGCOPY\n\xff\r\n\0memory-units");
  const taki = { version: 1, backupId: request.backupId, proof: body,
    entries: [{ name: "memory_units.bin", bytes: table.length, sha256: createHash("sha256").update(table).digest("hex") }] };
  const native = { version: "2", created_at: AT, schema: "public",
    tables: { memory_units: { rows: 1, size_bytes: table.length, columns: [{ name: "id", type_name: "uuid" }] } }, taki };
  const manifest = options.manifest?.(native) ?? native;
  return Buffer.from(zipSync({ "memory_units.bin": table, "manifest.json": strToU8(JSON.stringify(manifest)), ...options.entries }));
}

/** Where the operator drops a native ZIP for backup.admit. */
/** A native manifest edit dropping the `taki` object: what an unpatched native CLI writes. */
export function withoutTaki(manifest: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "taki"));
}

export function putInbox(root: string, input: { name: string; bytes: Buffer }): string {
  mkdirSync(join(root, "inbox"), { recursive: true });
  writeFileSync(join(root, "inbox", input.name), input.bytes);
  return join(root, "inbox", input.name);
}

/** The harness's staged route-b capture, as operatorZip() reads it. */
export const harnessStaged = (h: BackupHarness) => ({ root: h.store.root, backupId: BACKUP_ID, route: h.route });
