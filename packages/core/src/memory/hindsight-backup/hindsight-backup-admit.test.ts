import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8 } from "fflate";
import type { Database } from "../../db/sqlite.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { AT, BACKUP_ID } from "./hindsight-backup-fixtures.ts";
import {
  backupHarness, HARNESS_BANK, harnessStaged, operatorZip, putInbox, seedConfirmedRetain, withoutTaki, type BackupHarness, type OperatorZipOptions,
} from "./hindsight-backup-harness.ts";

const dirs: string[] = []; const dbs: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });

const ZIP = "hindsight-backup.zip";
const OTHER_ID = "99999999-9999-4999-8999-999999999999";

async function staged(): Promise<BackupHarness> {
  const h = backupHarness({ dirs, dbs });
  expect(await h.capture("operator-artifact")).toEqual({ ok: true, verifiedAt: null });
  return h;
}

const admit = (h: BackupHarness, patch: { backupId?: string; fileName?: string; expectedEpochId?: string } = {}) =>
  h.service.admit({ backupId: BACKUP_ID, fileName: ZIP, expectedEpochId: "epoch", checkpoint: (phase) => { h.phases.push(phase); }, ...patch });

async function dropZip(h: BackupHarness, options?: OperatorZipOptions): Promise<Buffer> {
  const bytes = await operatorZip(harnessStaged(h), options);
  putInbox(h.store.root, { name: ZIP, bytes });
  return bytes;
}

const inInbox = (h: BackupHarness) => existsSync(join(h.store.root, "inbox", ZIP));
const stagedDir = (h: BackupHarness) => existsSync(join(h.store.root, `${BACKUP_ID}.staged`));

describe("route-b capture (operator-artifact)", () => {
  it("stages the Core half under the fence without calling native, releases writers and lists nothing", async () => {
    const h = await staged();
    expect(h.phases).toEqual(["quiescing", "capturing-core", "sealing"]);
    expect(h.route.requests).toEqual([]);
    expect(await h.store.list()).toEqual([]);
    expect(readdirSync(join(h.store.root, `${BACKUP_ID}.staged`)).sort()).toEqual(["core-identity.json", "core.sqlite", "native-request.json"]);
    expect(h.fence.writable()).toBe(true);
    expect(h.scheduler.start).toHaveBeenCalledTimes(1);
  });

  it("lists the staged capture in the inventory, skipping staged dirs without a matching identity and partial dirs", async () => {
    const h = await staged();
    mkdirSync(join(h.store.root, `${OTHER_ID}.staged`));
    mkdirSync(join(h.store.root, `${OTHER_ID}.partial`));
    mkdirSync(join(h.store.root, "not-a-uuid.staged"));
    expect(h.service.inventory()).toEqual({ lastVerified: null, latest: null, staged: [{ backupId: BACKUP_ID, createdAt: AT, epochId: "epoch" }] });
  });

  it("never needs the native endpoint", async () => {
    const h = backupHarness({ dirs, dbs });
    h.route.unavailable = true;
    expect(await h.capture("operator-artifact")).toEqual({ ok: true, verifiedAt: null });
  });
});

describe("backup.admit (§5.5 route b)", () => {
  it("claims the inbox ZIP, pairs its in-ZIP proof with the staged Core copy and seals the pair verified", async () => {
    const h = await staged();
    const bytes = await dropZip(h);
    expect(await admit(h)).toEqual({ ok: true, verifiedAt: AT });
    const [listed] = await h.store.list();
    expect(listed).toMatchObject({ backupId: BACKUP_ID, route: "operator-artifact", verifiedAt: AT,
      native: { location: "core-dir", file: "native.zip", nativeManifestVersion: "2", schema: "public",
        proof: { zipSha256: createHash("sha256").update(bytes).digest("hex"), zipBytes: bytes.length } } });
    // The staged request records stay beside the pair as the record of what the operator was asked to snapshot.
    expect(readdirSync(join(h.store.root, BACKUP_ID)).sort()).toEqual(["core-identity.json", "core.sqlite", "manifest.json", "native-request.json", "native.zip"]);
    expect(inInbox(h)).toBe(false);
    expect(stagedDir(h)).toBe(false);
    expect(h.service.lastVerified()?.backupId).toBe(BACKUP_ID);
    // Sealed means consumed: the same request cannot be admitted twice.
    putInbox(h.store.root, { name: ZIP, bytes });
    expect(await admit(h)).toMatchObject({ ok: false, code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID" });
  });

  it("leaves the staged capture admissible after a refused ZIP", async () => {
    const h = await staged();
    await dropZip(h, { manifest: (manifest) => ({ ...manifest, version: "1" }) });
    expect(await admit(h)).toMatchObject({ ok: false, code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID" });
    expect(inInbox(h)).toBe(true);
    await dropZip(h);
    expect(await admit(h)).toEqual({ ok: true, verifiedAt: AT });
  });

  type Refusal = { name: string; code: string; zip?: OperatorZipOptions; arrange?: (h: BackupHarness) => void; mismatch?: unknown };
  const REFUSALS: Refusal[] = [
    { name: "a ZIP without the taki proof", code: "HINDSIGHT_BACKUP_PROOF_MISSING",
      zip: { manifest: withoutTaki } },
    { name: "a native manifest of another version", code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID", zip: { manifest: (manifest) => ({ ...manifest, version: "1" }) } },
    { name: "a ZIP made for another request", code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID",
      zip: { manifest: (manifest) => ({ ...manifest, taki: { ...manifest.taki as object, backupId: OTHER_ID } }) } },
    { name: "a table altered after its hash was pinned", code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID", zip: { entries: { "memory_units.bin": strToU8("tampered") } } },
    { name: "an entry the proof does not pin", code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID", zip: { entries: { "extra.bin": strToU8("x") } } },
    { name: "a nested path entry", code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID", zip: { entries: { "dir/memory_units.bin": strToU8("x") } } },
    { name: "native behind the Core copy", code: "HINDSIGHT_BACKUP_PAIR_MISMATCH", mismatch: { reason: "replica_cursor", bankId: "global" },
      arrange: (h) => { h.route.state.banks.get(HARNESS_BANK.bankId)!.currentCursor = 4; } },
  ];

  it.each(REFUSALS)("refuses $name as $code and returns the ZIP to the inbox", async (refusal) => {
    const h = await staged();
    refusal.arrange?.(h);
    await dropZip(h, refusal.zip);
    expect(await admit(h)).toEqual({ ok: false, code: refusal.code, mismatch: refusal.mismatch ?? null });
    expect(inInbox(h)).toBe(true);
    expect(stagedDir(h)).toBe(true);
    expect(existsSync(join(h.store.root, `${BACKUP_ID}.staged`, "native.zip"))).toBe(false);
    expect(await h.store.list()).toEqual([]);
  });

  it("refuses a ZIP older than the Core copy: a Core terminal success it never receipted", async () => {
    const h = backupHarness({ dirs, dbs });
    seedConfirmedRetain(h.db, "remote-1");
    await h.capture("operator-artifact");
    await dropZip(h);
    expect(await admit(h)).toEqual({ ok: false, code: "HINDSIGHT_BACKUP_PAIR_MISMATCH", mismatch: { reason: "receipt_missing", bankId: null } });
    expect(inInbox(h)).toBe(true);
  });

  it("refuses an unknown backup, a foreign epoch, a path-like or absent name and a directory without moving anything", async () => {
    const h = await staged();
    await dropZip(h);
    expect(await admit(h, { backupId: OTHER_ID })).toMatchObject({ ok: false, code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID" });
    expect(await admit(h, { expectedEpochId: "other-epoch" })).toMatchObject({ ok: false, code: "MEMORY_AUTHORITY_MISMATCH" });
    expect(await admit(h, { fileName: `../${ZIP}` })).toMatchObject({ ok: false, code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID" });
    expect(await admit(h, { fileName: "absent.zip" })).toMatchObject({ ok: false, code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID" });
    mkdirSync(join(h.store.root, "inbox", "folder.zip"));
    expect(await admit(h, { fileName: "folder.zip" })).toMatchObject({ ok: false, code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID" });
    expect(existsSync(join(h.store.root, "inbox", "folder.zip"))).toBe(true);
    putInbox(h.store.root, { name: "junk.zip", bytes: Buffer.from("not a zip") });
    expect(await admit(h, { fileName: "junk.zip" })).toMatchObject({ ok: false, code: "HINDSIGHT_BACKUP_ARTIFACT_INVALID" });
    expect(existsSync(join(h.store.root, "inbox", "junk.zip"))).toBe(true);
    expect(inInbox(h)).toBe(true);
    expect(stagedDir(h)).toBe(true);
  });
});
