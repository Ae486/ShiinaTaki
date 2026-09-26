import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/sqlite.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { AT, BACKUP_ID } from "./hindsight-backup-fixtures.ts";
import { backupHarness, harnessStaged, operatorZip, putInbox, type BackupHarness, type BackupHarnessOptions } from "./hindsight-backup-harness.ts";

const dirs: string[] = []; const dbs: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });

const verify = (h: BackupHarness, backupId = BACKUP_ID) => h.service.verify({ backupId, checkpoint: (phase) => { h.phases.push(phase); } });
const manifestText = (h: BackupHarness) => readFileSync(join(h.store.root, BACKUP_ID, "manifest.json"), "utf8");

async function routeB(options?: BackupHarnessOptions): Promise<BackupHarness> {
  const h = backupHarness({ dirs, dbs }, options);
  await h.capture("operator-artifact");
  putInbox(h.store.root, { name: "native.zip", bytes: await operatorZip(harnessStaged(h)) });
  expect(await h.service.admit({ backupId: BACKUP_ID, fileName: "native.zip", expectedEpochId: "epoch", checkpoint: () => undefined }))
    .toEqual({ ok: true, verifiedAt: AT });
  return h;
}

async function routeC(options?: BackupHarnessOptions): Promise<BackupHarness> {
  const h = backupHarness({ dirs, dbs }, options);
  expect(await h.capture()).toMatchObject({ ok: true });
  return h;
}

describe("backup.verify", () => {
  it.each([["route b (Core-held ZIP)", routeB], ["route c (native-host ZIP)", routeC]] as const)(
    "re-verifies a %s pair and rewrites only verifiedAt atomically", async (_name, build) => {
      const h = await build();
      const sealed = JSON.parse(manifestText(h));
      await h.store.markVerified(BACKUP_ID, null);
      expect(h.service.lastVerified()).toBeNull();
      expect(await verify(h)).toEqual({ ok: true, verifiedAt: AT });
      expect(JSON.parse(manifestText(h))).toEqual(sealed);
      expect(readdirSync(join(h.store.root, BACKUP_ID)).filter((name) => name.endsWith(".next"))).toEqual([]);
      expect(h.service.lastVerified()?.backupId).toBe(BACKUP_ID);
    });

  it.each([["core.sqlite", routeB], ["core.sqlite", routeC], ["native.zip", routeB]] as const)(
    "records verifiedAt null when %s no longer matches its hash", async (file, build) => {
      const h = await build();
      appendFileSync(join(h.store.root, BACKUP_ID, file), "x");
      expect(await verify(h)).toEqual({ ok: false, code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID", mismatch: null });
      expect(JSON.parse(manifestText(h)).verifiedAt).toBeNull();
      expect(h.service.lastVerified()).toBeNull();
    });

  it("names every credential the record saw present and this host lacks, without touching the manifest", async () => {
    const h = await routeB({ missingCredentials: (custody) => custody.refs.filter((ref) => ref.present).map((ref) => ref.ref) });
    const before = manifestText(h);
    expect(await verify(h)).toEqual({ ok: false, code: "HINDSIGHT_BACKUP_CREDENTIAL_MISSING", mismatch: null });
    expect(manifestText(h)).toBe(before);
    expect(h.logs.find((log) => (log.obj as { code?: string }).code === "HINDSIGHT_BACKUP_CREDENTIAL_MISSING")?.obj)
      .toMatchObject({ refs: ["memory.hindsight.connection.api-key"] });
  });

  it("refuses an id with no sealed backup", async () => {
    const h = backupHarness({ dirs, dbs });
    expect(await verify(h)).toEqual({ ok: false, code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID", mismatch: null });
  });
});
