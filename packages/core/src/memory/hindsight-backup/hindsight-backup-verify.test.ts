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

describe("backup.verify — native-host ZIP read-back", () => {
  const file = `taki-backup-${BACKUP_ID}.zip`;

  it("retires a hung old-epoch read-back without changing the sealed manifest after its late reply", async () => {
    const h = await routeC(); const before = manifestText(h);
    let release!: () => void;
    vi.spyOn(h.route, "readBack").mockImplementation(() => new Promise((resolve) => {
      release = () => resolve(h.route.artifacts.get(file)!);
    }));
    const pending = verify(h); await vi.waitFor(() => expect(release).toBeDefined());
    h.service.retireEpoch!("epoch"); await h.service.stop();
    expect(await pending).toMatchObject({ ok: false });
    expect(manifestText(h)).toBe(before);
    release(); await new Promise<void>((resolve) => setImmediate(resolve));
    expect(manifestText(h)).toBe(before);
  });

  it.each([
    ["changed", (h: BackupHarness) => { h.route.artifacts.set(file, { sha256: "f".repeat(64), bytes: 4096 }); }],
    ["gone", (h: BackupHarness) => { h.route.artifacts.delete(file); }],
  ])("records verifiedAt null when the native host's ZIP is %s", async (_name, arrange) => {
    const h = await routeC();
    arrange(h);
    expect(await verify(h)).toEqual({ ok: false, code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID", mismatch: null });
    expect(JSON.parse(manifestText(h)).verifiedAt).toBeNull();
  });

  it.each([
    ["the route is unavailable", "HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE", (h: BackupHarness) => { h.route.unavailable = true; }],
    ["the native host cannot answer", "HINDSIGHT_BACKUP_NATIVE_FAILED",
      (h: BackupHarness) => { vi.spyOn(h.route, "readBack").mockRejectedValue(new Error("HINDSIGHT_UNREACHABLE")); }],
  ])("fails without touching the manifest when %s", async (_name, code, arrange) => {
    const h = await routeC();
    const before = manifestText(h);
    arrange(h);
    expect(await verify(h)).toEqual({ ok: false, code, mismatch: null });
    expect(manifestText(h)).toBe(before);
  });
});
