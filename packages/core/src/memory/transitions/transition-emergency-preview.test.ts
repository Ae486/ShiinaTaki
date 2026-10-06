import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { seedHindsightAuthority } from "../operations/memory-operation-fixtures.ts";
import { readEmergencyPreviewDisclosure } from "./transition-emergency-preview.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { backupManifest } from "../hindsight-backup/hindsight-backup-fixtures.ts";

let db: Database | undefined;
afterEach(() => db?.close());
describe("offline emergency disclosure", () => {
  it("accounts for every one of 301 scopes despite partial setup and the display's 256 limit", () => {
    db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); seedHindsightAuthority(db);
    const setup = createHindsightBankSetupRepo(db);
    for (let index = 0; index < 301; index++) setup.upsert({ scope: index === 0 ? "global" : "character",
      canonicalIdentity: index === 0 ? "global" : `character:owned-${index}`, externalBankId: `native-${index}`,
      templateRevision: "taki-bank-v1", templateDigest: "a".repeat(64), status: index % 2 ? "pending" : "verified",
      operationIds: [], lastVerifiedAt: index % 2 ? null : W3_AT, lastError: null });
    const disclosure = readEmergencyPreviewDisclosure(db, null, W3_AT);
    expect(disclosure.banks).toHaveLength(301); expect(disclosure.inventory).toBe("complete");
    expect(disclosure.blocking).toEqual(["incomplete-replica"]);
    expect(disclosure.banks.every((bank) => bank.evidence === "missing" && bank.nativeGeneration === null
      && bank.replicaCursor === null && bank.remoteLoss === "unknown")).toBe(true);
  });
  it("distinguishes an unreadable inventory from empty and preserves backup age across foreign history", () => {
    db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); seedHindsightAuthority(db);
    const backup = backupManifest({ sha256: "b".repeat(64), bytes: 1, pages: 1 });
    const first = readEmergencyPreviewDisclosure(db, backup, W3_AT);
    expect(first.lastVerifiedBackupId).toBe(backup.backupId); expect(first.backupAgeSeconds).not.toBeNull();
    expect(first.banks[0]).toMatchObject({ evidence: "missing", bankId: null, backupNativeCursor: null, remoteHead: "unknown" });
    db.exec("ALTER TABLE hindsight_bank_setup RENAME TO owned_unreadable_setup");
    const unreadable = readEmergencyPreviewDisclosure(db, backup, W3_AT);
    expect(unreadable.inventory).toBe("unreadable"); expect(unreadable.blocking).toEqual(["inventory-unreadable"]);
    expect(unreadable.lastVerifiedBackupId).toBe(backup.backupId);
  });
});
