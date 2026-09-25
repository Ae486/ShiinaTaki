import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { AT, BACKUP_ID, backupManifest } from "./hindsight-backup-fixtures.ts";
import { createHindsightBackupStore, HINDSIGHT_BACKUP_CORE_FILE, type HindsightBackupStore } from "./hindsight-backup-store.ts";

const dirs: string[] = [];
const dbs: Database[] = [];
const OTHER_ID = "99999999-9999-4999-8999-999999999999";

afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
  for (const dir of dirs) rmTempDir(dir);
  dirs.length = 0;
});

function setup(): { dataDir: string; store: HindsightBackupStore; db: Database } {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-backup-"));
  dirs.push(dataDir);
  const db = openDatabase({ path: join(dataDir, "taki.db"), migrations: MIGRATIONS });
  dbs.push(db);
  return { dataDir, store: createHindsightBackupStore(dataDir), db };
}

async function sealed(store: HindsightBackupStore, db: Database, backupId = BACKUP_ID) {
  await store.begin(backupId);
  const core = await store.captureCore(backupId, (path) => db.backupTo(path));
  const manifest = backupManifest({ sha256: core.sha256, bytes: core.bytes, pages: core.pages }, { backupId });
  await store.seal(manifest);
  return { core, manifest };
}

describe("hindsight backup store", () => {
  it("stages under <id>.partial, seals by rename and lists the sealed manifest with matching hashes", async () => {
    const { store, db, dataDir } = setup();
    const { core, manifest } = await sealed(store, db);
    expect(store.root).toBe(join(dataDir, "backups"));
    expect(readdirSync(store.root)).toEqual([BACKUP_ID]);
    expect(readdirSync(join(store.root, BACKUP_ID)).sort()).toEqual([HINDSIGHT_BACKUP_CORE_FILE, "manifest.json"]);
    expect(core.pages).toBeGreaterThan(0);
    expect(await store.list()).toEqual([manifest]);
    expect(await store.read(BACKUP_ID)).toEqual(manifest);
    expect(await store.digest(BACKUP_ID, HINDSIGHT_BACKUP_CORE_FILE)).toEqual({ sha256: core.sha256, bytes: core.bytes });
  });

  it("removes the whole partial dir when the Core copy fails and lists nothing", async () => {
    const { store, db } = setup();
    await store.begin(BACKUP_ID);
    const failing = async (path: string) => {
      writeFileSync(path, "half a page");
      throw new Error("disk full");
    };
    await expect(store.captureCore(BACKUP_ID, failing)).rejects.toThrow("disk full");
    expect(readdirSync(store.root)).toEqual([]);
    db.close();
    await store.begin(BACKUP_ID);
    await expect(store.captureCore(BACKUP_ID, (path) => db.backupTo(path))).rejects.toThrow();
    expect(readdirSync(store.root)).toEqual([]);
    expect(await store.list()).toEqual([]);
  });

  it("refuses to seal a manifest whose hashes or shape disagree with the staged files", async () => {
    const { store, db } = setup();
    await store.begin(BACKUP_ID);
    const core = await store.captureCore(BACKUP_ID, (path) => db.backupTo(path));
    await expect(store.seal(backupManifest({ ...core, sha256: "0".repeat(64) }))).rejects.toThrow("HINDSIGHT_BACKUP_STORAGE_FAILED");
    await expect(store.seal(backupManifest({ ...core, bytes: core.bytes + 1 }))).rejects.toThrow("HINDSIGHT_BACKUP_STORAGE_FAILED");
    await expect(store.seal(backupManifest(core, { native: { ...backupManifest(core).native, location: "core-dir", file: "native.zip" } })))
      .rejects.toThrow();
    await expect(store.seal({ ...backupManifest(core), sensitive: false } as never)).rejects.toThrow("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
    expect(await store.list()).toEqual([]);
    await store.discard(BACKUP_ID);
    expect(readdirSync(store.root)).toEqual([]);
  });

  it("refuses ids that are not Core-minted uuids and ids already sealed", async () => {
    const { store, db } = setup();
    for (const bad of ["../escape", "a/b", "inbox", `${BACKUP_ID}.partial`]) {
      await expect(store.begin(bad)).rejects.toThrow("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
    }
    await sealed(store, db);
    await expect(store.begin(BACKUP_ID)).rejects.toThrow("HINDSIGHT_BACKUP_STORAGE_FAILED");
    await store.begin(OTHER_ID);
    await expect(store.begin(OTHER_ID)).rejects.toThrow();
  });

  it("quarantines a leftover partial so it is never listed", async () => {
    const { store, db } = setup();
    await store.begin(OTHER_ID);
    await store.captureCore(OTHER_ID, (path) => db.backupTo(path));
    expect(await store.quarantine(OTHER_ID)).toBe(true);
    expect(await store.quarantine(OTHER_ID)).toBe(false);
    expect(readdirSync(store.root)).toEqual(["quarantine"]);
    expect(readdirSync(join(store.root, "quarantine"))).toEqual([OTHER_ID]);
    expect(await store.list()).toEqual([]);
  });

  it("lists only sealed dirs whose schema-valid manifest names the dir itself", async () => {
    const { store, db } = setup();
    const { manifest } = await sealed(store, db);
    const later = { ...manifest, backupId: OTHER_ID, createdAt: "2026-09-26T01:00:00.000Z", verifiedAt: null };
    const write = (name: string, body: string) => {
      mkdirSync(join(store.root, name), { recursive: true });
      writeFileSync(join(store.root, name, "manifest.json"), body);
    };
    write(OTHER_ID, JSON.stringify(later));
    write("55555555-5555-4555-8555-555555555555", JSON.stringify(manifest));
    write("66666666-6666-4666-8666-666666666666", "{ not json");
    write("77777777-7777-4777-8777-777777777777", JSON.stringify({ ...manifest, backupId: "77777777-7777-4777-8777-777777777777", version: 2 }));
    write("inbox", JSON.stringify(manifest));
    mkdirSync(join(store.root, "88888888-8888-4888-8888-888888888888"));
    writeFileSync(join(store.root, "99999999-9999-4999-8999-999999999990"), "a file, not a dir");
    expect((await store.list()).map((entry) => entry.backupId)).toEqual([BACKUP_ID, OTHER_ID]);
    expect(await store.read("66666666-6666-4666-8666-666666666666")).toBeNull();
    expect(JSON.parse(readFileSync(join(store.root, BACKUP_ID, "manifest.json"), "utf8"))).toMatchObject({ backupId: BACKUP_ID, createdAt: AT });
  });

  it.skipIf(process.platform === "win32")("keeps the artifact owner-only where the OS has mode bits", async () => {
    const { store, db } = setup();
    await sealed(store, db);
    const mode = (path: string) => statSync(path).mode & 0o777;
    expect(mode(store.root)).toBe(0o700);
    expect(mode(join(store.root, BACKUP_ID))).toBe(0o700);
    expect(mode(join(store.root, BACKUP_ID, HINDSIGHT_BACKUP_CORE_FILE))).toBe(0o600);
    expect(mode(join(store.root, BACKUP_ID, "manifest.json"))).toBe(0o600);
  });
});
