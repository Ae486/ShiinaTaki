import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HindsightIncidentManifestSchema } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { AT, BACKUP_ID } from "./hindsight-backup-fixtures.ts";
import { sealEmergencyEvidence } from "./hindsight-backup-emergency.ts";
import { backupHarness, HARNESS_BANK, seedVerifiedBank } from "./hindsight-backup-harness.ts";

const dirs: string[] = []; const dbs: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });

const LATER = "2026-09-26T01:00:00.000Z";

describe("sealEmergencyEvidence (§5.8)", () => {
  it.each(["bank_generation", "provider_lineage_id", "authority_epoch_id"])("seals an unknown interval for incompatible %s while retaining the backup reference", async (column) => {
    const h = backupHarness({ dirs, dbs }); seedVerifiedBank(h.db); await h.capture();
    h.db.prepare(`UPDATE hindsight_replica_sync_checkpoints SET ${column}=:value`).run({ value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const snapshot = vi.spyOn(h.route, "snapshot");
    const { incidentId } = await sealEmergencyEvidence({ db: h.db, store: h.store, lastVerified: h.service.lastVerified(), now: () => LATER });
    const manifest = HindsightIncidentManifestSchema.parse(JSON.parse(readFileSync(join(h.store.root, `incident-${incidentId}`, "manifest.json"), "utf8")));
    expect(manifest).toMatchObject({ lastVerifiedBackupId: BACKUP_ID, backupAgeSeconds: 3600,
      missingInterval: [{ bankId: HARNESS_BANK.bankId, fromNativeCursor: null, toReplicaCursor: 5, pendingCount: 0 }] });
    expect(snapshot).not.toHaveBeenCalled();
  });
  it("seals a Core copy and an incident-local manifest while native hangs, never touching the route or the backup list", async () => {
    const h = backupHarness({ dirs, dbs });
    seedVerifiedBank(h.db);
    await h.capture();
    h.route.fail = "hang"; h.route.requests.length = 0;
    const snapshot = vi.spyOn(h.route, "snapshot");
    const { incidentId } = await sealEmergencyEvidence({ db: h.db, store: h.store, lastVerified: h.service.lastVerified(), now: () => LATER });
    expect(snapshot).not.toHaveBeenCalled();
    const dir = join(h.store.root, `incident-${incidentId}`);
    expect(readdirSync(dir).sort()).toEqual(["core.sqlite", "manifest.json"]);
    const manifest = HindsightIncidentManifestSchema.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
    expect(manifest).toMatchObject({ kind: "incident-local", fullBackup: false, incidentId, createdAt: LATER, authorityEpochId: "epoch",
      lastVerifiedBackupId: BACKUP_ID, backupAgeSeconds: 3600,
      missingInterval: [{ bankId: HARNESS_BANK.bankId, fromNativeCursor: 5, toReplicaCursor: 5, pendingCount: 0 }] });
    expect((await h.store.list()).map((backup) => backup.backupId)).toEqual([BACKUP_ID]);
  });

  it("works with no verified backup at all", async () => {
    const h = backupHarness({ dirs, dbs });
    const { incidentId } = await sealEmergencyEvidence({ db: h.db, store: h.store, lastVerified: null, now: () => AT });
    const manifest = JSON.parse(readFileSync(join(h.store.root, `incident-${incidentId}`, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ lastVerifiedBackupId: null, backupAgeSeconds: null, missingInterval: [] });
    expect(await h.store.list()).toEqual([]);
  });
});
