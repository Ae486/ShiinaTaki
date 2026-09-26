/**
 * INPUT:  paths below `<dataDir>/backups/` that the backup modules derived from the data dir and validated ids or names
 * OUTPUT: owner-only fs primitives: create-only write + fsync, atomic replace, streaming sha256/bytes, existence, removal,
 *         and the STORAGE_FAILED error shape
 * POS:    core/memory/hindsight-backup — shared by the artifact store, the inbox archive reader and the emergency seal; never
 *         derives a path itself
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";

// Mode bits are honoured on POSIX (the Ubuntu VPS) and ignored by Windows, where the data dir's ACL already applies.
export const OWNER_DIR = 0o700;
export const OWNER_FILE = 0o600;

export interface HindsightBackupFileDigest { sha256: string; bytes: number }

export async function writeOwnerFile(path: string, text: string): Promise<void> {
  const handle = await open(path, "wx", OWNER_FILE);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Readers see the old or the new file, never a torn one: the new text is fsynced beside it and renamed over it. */
export async function replaceOwnerFile(path: string, text: string): Promise<void> {
  const next = `${path}.next`;
  await rm(next, { force: true });
  await writeOwnerFile(next, text);
  await rename(next, path);
}

export async function digestFile(path: string): Promise<HindsightBackupFileDigest> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

export function removeDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true, maxRetries: 3 });
}

export function storageFailed(): Error {
  return new Error("HINDSIGHT_BACKUP_STORAGE_FAILED");
}

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}
