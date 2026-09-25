/**
 * INPUT:  the Core data dir, Core-minted backup ids, a Core-copy writer (Database.backupTo) and complete manifests
 * OUTPUT: createHindsightBackupStore(dataDir) -> begin/captureCore/seal/discard/quarantine/list/read/digest over
 *         `<dataDir>/backups/<backupId>/`, staged in `<backupId>.partial/` and renamed on seal; owner-only where modes exist
 * POS:    core/memory/hindsight-backup — the only fs site for backup artifacts; every path derives from dataDir + a validated
 *         id, never a caller path; a partial or quarantined dir is never listed
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { HindsightBackupIdSchema, HindsightBackupManifestSchema, type HindsightBackupManifest } from "@taki/shared";

export const HINDSIGHT_BACKUP_CORE_FILE = "core.sqlite";
export const HINDSIGHT_BACKUP_NATIVE_FILE = "native.zip";
const MANIFEST_FILE = "manifest.json";
const QUARANTINE_DIR = "quarantine";
// Mode bits are honoured on POSIX (the Ubuntu VPS) and ignored by Windows, where the data dir's ACL already applies.
const OWNER_DIR = 0o700;
const OWNER_FILE = 0o600;

export interface HindsightBackupFileDigest { sha256: string; bytes: number }
export type HindsightBackupFile = typeof HINDSIGHT_BACKUP_CORE_FILE | typeof HINDSIGHT_BACKUP_NATIVE_FILE;

export interface HindsightBackupStore {
  readonly root: string;
  /** Creates `<id>.partial/`; refuses an id that already has a partial or sealed dir. */
  begin(backupId: string): Promise<void>;
  /** Writes core.sqlite into the partial dir; any failure removes the whole partial dir before rethrowing. */
  captureCore(backupId: string, write: (path: string) => Promise<number>): Promise<HindsightBackupFileDigest & { pages: number }>;
  /** Re-hashes the staged files against the manifest, writes manifest.json and renames the partial dir into place. */
  seal(manifest: HindsightBackupManifest): Promise<void>;
  discard(backupId: string): Promise<void>;
  /** Moves a leftover partial dir under `quarantine/`; true when one existed. */
  quarantine(backupId: string): Promise<boolean>;
  /** Sealed backups with a schema-valid manifest naming their own dir, oldest first. */
  list(): Promise<HindsightBackupManifest[]>;
  read(backupId: string): Promise<HindsightBackupManifest | null>;
  digest(backupId: string, file: HindsightBackupFile): Promise<HindsightBackupFileDigest>;
}

export function createHindsightBackupStore(dataDir: string): HindsightBackupStore {
  const root = join(dataDir, "backups");
  const sealedDir = (backupId: string) => join(root, requireBackupId(backupId));
  const partialDir = (backupId: string) => join(root, `${requireBackupId(backupId)}.partial`);
  const read = (backupId: string) => readManifest(sealedDir(backupId), backupId);
  return {
    root,
    begin: async (backupId) => {
      await mkdir(root, { recursive: true, mode: OWNER_DIR });
      if (await exists(sealedDir(backupId))) throw storageFailed();
      await mkdir(partialDir(backupId), { mode: OWNER_DIR });
    },
    captureCore: (backupId, write) => captureCore(partialDir(backupId), write),
    seal: async (manifest) => {
      const value = HindsightBackupManifestSchema.safeParse(manifest);
      if (!value.success) throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
      const target = sealedDir(value.data.backupId);
      if (await exists(target)) throw storageFailed();
      const staged = partialDir(value.data.backupId);
      await assertStagedFiles(staged, value.data);
      await writeOwnerFile(join(staged, MANIFEST_FILE), `${JSON.stringify(value.data, null, 2)}\n`);
      await rename(staged, target);
    },
    discard: (backupId) => removeDir(partialDir(backupId)),
    quarantine: async (backupId) => {
      const staged = partialDir(backupId);
      if (!(await exists(staged))) return false;
      await mkdir(join(root, QUARANTINE_DIR), { recursive: true, mode: OWNER_DIR });
      await rename(staged, join(root, QUARANTINE_DIR, requireBackupId(backupId)));
      return true;
    },
    list: () => listManifests(root, read),
    read,
    digest: (backupId, file) => digestFile(join(sealedDir(backupId), file)),
  };
}

async function captureCore(dir: string, write: (path: string) => Promise<number>): Promise<HindsightBackupFileDigest & { pages: number }> {
  const path = join(dir, HINDSIGHT_BACKUP_CORE_FILE);
  try {
    // backup() overwrites an existing file; the partial dir is fresh by construction, so anything here is foreign.
    if (await exists(path)) throw storageFailed();
    const pages = await write(path);
    await chmod(path, OWNER_FILE);
    return { pages, ...(await digestFile(path)) };
  } catch (error) {
    await removeDir(dir);
    throw error;
  }
}

async function assertStagedFiles(dir: string, manifest: HindsightBackupManifest): Promise<void> {
  const core = await digestFile(join(dir, HINDSIGHT_BACKUP_CORE_FILE));
  if (core.sha256 !== manifest.core.sha256 || core.bytes !== manifest.core.bytes) throw storageFailed();
  if (manifest.native.location !== "core-dir") return;
  const native = await digestFile(join(dir, HINDSIGHT_BACKUP_NATIVE_FILE));
  if (native.sha256 !== manifest.native.proof.zipSha256 || native.bytes !== manifest.native.proof.zipBytes) throw storageFailed();
}

async function listManifests(root: string, read: (backupId: string) => Promise<HindsightBackupManifest | null>): Promise<HindsightBackupManifest[]> {
  let names: string[];
  try { names = await readdir(root); }
  catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  const manifests: HindsightBackupManifest[] = [];
  // Partial, quarantine and inbox entries never parse as a backup id.
  for (const name of names.filter((entry) => HindsightBackupIdSchema.safeParse(entry).success)) {
    const manifest = await read(name);
    if (manifest) manifests.push(manifest);
  }
  return manifests.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

async function readManifest(dir: string, backupId: string): Promise<HindsightBackupManifest | null> {
  let text: string;
  try { text = await readFile(join(dir, MANIFEST_FILE), "utf8"); }
  catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return null;
    throw error;
  }
  let json: unknown;
  try { json = JSON.parse(text); }
  catch { return null; }
  const manifest = HindsightBackupManifestSchema.safeParse(json);
  return manifest.success && manifest.data.backupId === backupId ? manifest.data : null;
}

async function writeOwnerFile(path: string, text: string): Promise<void> {
  const handle = await open(path, "wx", OWNER_FILE);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function digestFile(path: string): Promise<HindsightBackupFileDigest> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

function requireBackupId(backupId: string): string {
  if (!HindsightBackupIdSchema.safeParse(backupId).success) throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
  return backupId;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function removeDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true, maxRetries: 3 });
}

function storageFailed(): Error {
  return new Error("HINDSIGHT_BACKUP_STORAGE_FAILED");
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}
