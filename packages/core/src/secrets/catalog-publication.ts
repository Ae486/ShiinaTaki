/**
 * INPUT:  a target file path + the complete bytes to publish
 * OUTPUT: publishFileAtomically(path, bytes, mode) -> "published" | "already-exists"
 * POS:    core/secrets — the staged-write + fsync + atomic-rename publication core every durable secret-adjacent
 *         write goes through (the catalog envelope AND the legacy-config rewrite). Mirrors hosts/host-identity:
 *         create-only same-directory linking for first publication (a concurrent winner is never overwritten),
 *         rename-based replace afterwards; staged files are always cleaned up and never half-visible
 */
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export type PublicationMode = "create-only" | "replace";
export type PublicationResult = "published" | "already-exists";

export function publishFileAtomically(filePath: string, bytes: Uint8Array, mode: PublicationMode = "replace"): PublicationResult {
  mkdirSync(dirname(filePath), { recursive: true });
  const stagedPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeStaged(stagedPath, bytes);
    if (mode === "create-only") {
      try {
        linkSync(stagedPath, filePath);
      } catch (error) {
        if (isAlreadyExists(error)) return "already-exists";
        throw error;
      }
    } else {
      renameSync(stagedPath, filePath);
    }
  } finally {
    removeStaged(stagedPath);
  }
  fsyncDirBestEffort(dirname(filePath));
  return "published";
}

// "wx" (create-only) with 0o600: the staged candidate is never a readable-by-others file even transiently.
function writeStaged(stagedPath: string, bytes: Uint8Array): void {
  const fd = openSync(stagedPath, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } catch (error) {
    try {
      closeSync(fd);
    } finally {
      removeStaged(stagedPath);
    }
    throw error;
  }
  closeSync(fd);
}

function removeStaged(stagedPath: string): void {
  try {
    unlinkSync(stagedPath);
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }
}

// Directory fsync makes the rename itself durable. Windows does not permit opening directories this way, so it is
// a POSIX-only best effort — the file-level fsync above already made the content durable either way.
function fsyncDirBestEffort(dir: string): void {
  if (process.platform === "win32") return;
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // best effort by contract
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST";
}
