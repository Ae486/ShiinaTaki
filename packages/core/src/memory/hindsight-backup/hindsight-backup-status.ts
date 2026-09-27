/**
 * INPUT:  Core SQLite (B3 Bank setup rows, replica checkpoints, Pending and D77 parent-write counts), the selected epoch, the
 *         last verified backup manifest, the newest sealed backup and staged route-b captures, and the read time
 * OUTPUT: readHindsightBackupStatus() -> the memory.authority.status `hindsight.backup` section: last verified backup, its age,
 *         per verified native Bank the interval from the backup's native cursor to the current Core replica checkpoint
 *         plus unsettled Core writes, the newest sealed backup whatever its verification and the current epoch's staged captures
 * POS:    core/memory/hindsight-backup — pure synchronous local read shared by status and the emergency seal; never probes the
 *         network; an unreadable count stays null, never a fabricated zero
 */
import { HindsightBackupStatusSectionSchema, type HindsightBackupManifest, type HindsightBackupStatusSection } from "@taki/shared";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { countPendingHindsightMemoryWrites } from "../../db/hindsight-memory-write-repo.ts";
import { readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { createPendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import type { HindsightBackupStagedSummary } from "./hindsight-backup-store.ts";

const MAX_BANKS = 256;
const MAX_STAGED = 16;

export interface HindsightBackupStatusInput {
  epochId: string | null;
  lastVerified: HindsightBackupManifest | null;
  /** The newest sealed backup and the staged route-b captures; the emergency seal, which records neither, omits them. */
  inventory?: { latest: HindsightBackupManifest | null; staged: readonly HindsightBackupStagedSummary[] };
  now: string;
}

export function readHindsightBackupStatus(db: Database, input: HindsightBackupStatusInput): HindsightBackupStatusSection {
  const backup = input.lastVerified;
  const verifiedAt = backup?.verifiedAt ?? null;
  const nativeCursors = new Map(verifiedAt === null ? [] : backup?.native.proof.banks.map((bank) => [bank.bankId, bank.currentCursor] as const));
  const missingInterval = verifiedNativeBanks(db).map((bankId) => ({
    bankId, fromNativeCursor: nativeCursors.get(bankId) ?? null,
    toReplicaCursor: quiet(() => readReplicaCheckpoint(db, bankId)?.endCursor ?? null),
    pendingCount: input.epochId === null ? null : pendingCount(db, { epochId: input.epochId, bankId }),
  }));
  return HindsightBackupStatusSectionSchema.parse({
    lastVerified: backup && verifiedAt !== null ? { backupId: backup.backupId, createdAt: backup.createdAt, verifiedAt,
      nativeCursors: [...nativeCursors].map(([bankId, currentCursor]) => ({ bankId, currentCursor })) } : null,
    ageSeconds: backup && verifiedAt !== null ? Math.max(0, Math.floor((Date.parse(input.now) - Date.parse(backup.createdAt)) / 1000)) : null,
    missingInterval, ...inventorySection(input),
  });
}

/** Only a capture staged under the current epoch is admissible, so older epochs' staged dirs are not offered. */
function inventorySection(input: HindsightBackupStatusInput): Pick<HindsightBackupStatusSection, "latest" | "staged"> {
  const latest = input.inventory ? input.inventory.latest : input.lastVerified;
  const staged = (input.inventory?.staged ?? []).filter((capture) => capture.epochId === input.epochId).slice(0, MAX_STAGED);
  return { latest: latest && { backupId: latest.backupId, createdAt: latest.createdAt, verifiedAt: latest.verifiedAt },
    staged: staged.map(({ backupId, createdAt }) => ({ backupId, createdAt })) };
}

function verifiedNativeBanks(db: Database): string[] {
  const rows = quiet(() => createHindsightBankSetupRepo(db).list()) ?? [];
  return [...new Set(rows.filter((row) => row.status === "verified").map((row) => row.externalBankId))].slice(0, MAX_BANKS);
}

/** Pending intents not yet in native plus D77 parent writes still open: Core writes a native restore alone would not hold. */
function pendingCount(db: Database, input: { epochId: string; bankId: string }): number | null {
  return quiet(() => createPendingMemoryRepo(db).summary({ authorityEpochId: input.epochId, bankId: input.bankId }).pendingCount
    + countPendingHindsightMemoryWrites(db, { authorityEpochId: input.epochId, bankId: input.bankId }));
}

function quiet<T>(read: () => T): T | null {
  try { return read(); }
  catch { return null; }
}
