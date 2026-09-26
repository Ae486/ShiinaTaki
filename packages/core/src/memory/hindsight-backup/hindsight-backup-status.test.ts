import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/sqlite.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { AT } from "./hindsight-backup-fixtures.ts";
import { backupHarness, HARNESS_BANK, seedVerifiedBank } from "./hindsight-backup-harness.ts";
import { readHindsightBackupStatus } from "./hindsight-backup-status.ts";

const dirs: string[] = []; const dbs: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });

const LATER = "2026-09-26T00:01:30.000Z";

function queued(db: Database): void {
  db.prepare(`INSERT INTO pending_memory (authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash,phase,version,state_json)
    VALUES ('epoch',:bank,'op-queued','retain',:hash,'queued',1,'{}')`).run({ bank: HARNESS_BANK.bankId, hash: "c".repeat(64) });
}

describe("hindsight.backup status section", () => {
  it("reports no backup with each verified Bank's current Core checkpoint and unsettled writes", () => {
    const h = backupHarness({ dirs, dbs });
    seedVerifiedBank(h.db); queued(h.db);
    expect(readHindsightBackupStatus(h.db, { epochId: "epoch", lastVerified: null, now: AT })).toEqual({ lastVerified: null, ageSeconds: null,
      missingInterval: [{ bankId: HARNESS_BANK.bankId, fromNativeCursor: null, toReplicaCursor: 5, pendingCount: 1 }] });
    expect(readHindsightBackupStatus(h.db, { epochId: null, lastVerified: null, now: AT }).missingInterval[0]!.pendingCount).toBeNull();
  });

  it("measures age and the interval from the last verified native cursor", async () => {
    const h = backupHarness({ dirs, dbs });
    seedVerifiedBank(h.db);
    await h.capture();
    const status = readHindsightBackupStatus(h.db, { epochId: "epoch", lastVerified: h.service.lastVerified(), now: LATER });
    expect(status).toEqual({ ageSeconds: 90,
      lastVerified: { backupId: h.service.lastVerified()!.backupId, createdAt: AT, verifiedAt: AT, nativeCursors: [{ bankId: HARNESS_BANK.bankId, currentCursor: 5 }] },
      missingInterval: [{ bankId: HARNESS_BANK.bankId, fromNativeCursor: 5, toReplicaCursor: 5, pendingCount: 0 }] });
    const unverified = { ...h.service.lastVerified()!, verifiedAt: null };
    expect(readHindsightBackupStatus(h.db, { epochId: "epoch", lastVerified: unverified, now: LATER })).toMatchObject({ lastVerified: null, ageSeconds: null });
  });
});
