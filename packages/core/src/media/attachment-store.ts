/**
 * INPUT:  raw base64 image bytes + an IMAGE_MEDIA_TYPES media type (chat-agent save); a workspace-relative ref (read)
 * OUTPUT: createAttachmentStore({attachmentsDir}) -> { save, read, sweepExpired, usage, clear }
 * POS:    core/media — the SANCTIONED content-addressed attachment R/W site (#17, inv. 2/7); read confined by a strict
 *         whole-ref regex (decision 8) BEFORE any fs; the DB never holds bytes; a pluggable module removable as a unit
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IMAGE_MEDIA_TYPES } from "@taki/shared";

type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

// The closed content-addressed namespace: refs are `attachments/<sha256hex>.<ext>`. REF_RE is the WHOLE-ref security
// surface — read rejects anything else BEFORE any fs call. No traversal is even expressible here (decision 8),
// strictly stronger than path resolution; the on-disk filename (no prefix) is validated by FILE_RE for sweep/usage.
const NAMESPACE = "attachments/";
const REF_RE = /^attachments\/[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/;
const FILE_RE = /^[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/;

const EXT_BY_TYPE: Record<ImageMediaType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const TYPE_BY_EXT: Record<string, ImageMediaType> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export interface SavedAttachment {
  /** Workspace-relative content-addressed ref stored on the timeline image part (never the bytes). */
  ref: string;
  bytes: number;
}

/** No-throw read contract (mirrors workspace-paths): a bad ref rejects before fs; a missing file rejects after. */
export type AttachmentRead =
  | { ok: true; mediaType: ImageMediaType; dataBase64: string }
  | { ok: false; code: "INVALID_REF" | "NOT_FOUND" };

export interface AttachmentUsage {
  count: number;
  bytes: number;
}

export interface AttachmentSweep {
  removedCount: number;
  freedBytes: number;
}

export interface AttachmentStore {
  /** Content-address the bytes (sha256) and persist under the Workspace; identical bytes dedup + refresh the TTL clock. */
  save(dataBase64: string, mediaType: ImageMediaType): SavedAttachment;
  /** Confine the ref (REF_RE) BEFORE any fs, then read; the ONLY sanctioned attachment read path. */
  read(ref: string): AttachmentRead;
  /** Delete attachments whose mtime is older than the TTL; returns what was reclaimed. */
  sweepExpired(ttlMs: number): AttachmentSweep;
  /** Current retained-attachment footprint (empty/missing dir = zeros). */
  usage(): AttachmentUsage;
  /** Purge every retained attachment on demand (media.clear). */
  clear(): AttachmentSweep;
}

export function createAttachmentStore(deps: { attachmentsDir: string }): AttachmentStore {
  const dir = deps.attachmentsDir;
  return {
    save: (dataBase64, mediaType) => save(dir, dataBase64, mediaType),
    read: (ref) => read(dir, ref),
    // Only raw bytes older than the TTL are swept; the description-memory is permanent (decision 9).
    sweepExpired: (ttlMs) => removeWhere(dir, (path) => statSync(path).mtimeMs < Date.now() - ttlMs),
    usage: () => usage(dir),
    clear: () => removeWhere(dir, () => true),
  };
}

function save(dir: string, dataBase64: string, mediaType: ImageMediaType): SavedAttachment {
  const buffer = Buffer.from(dataBase64, "base64");
  const hash = createHash("sha256").update(buffer).digest("hex");
  const filename = `${hash}.${EXT_BY_TYPE[mediaType]}`;
  const path = join(dir, filename);
  mkdirSync(dir, { recursive: true }); // first-write lazily creates the dir (screenshot-store precedent)
  if (existsSync(path)) {
    // Dedup: the identical bytes are already stored — skip the write but touch mtime so a re-sent image's TTL restarts.
    const now = new Date();
    utimesSync(path, now, now);
  } else {
    writeFileSync(path, buffer);
  }
  return { ref: `${NAMESPACE}${filename}`, bytes: buffer.byteLength };
}

function read(dir: string, ref: string): AttachmentRead {
  // The WHOLE-ref confinement (decision 8): reject anything but the closed namespace BEFORE any fs — no traversal is
  // even expressible here. This is the single-sourced security surface; media.get is a thin delegation to it.
  if (!REF_RE.test(ref)) return { ok: false, code: "INVALID_REF" };
  const filename = ref.slice(NAMESPACE.length);
  const ext = filename.slice(filename.lastIndexOf(".") + 1);
  const mediaType = TYPE_BY_EXT[ext];
  if (!mediaType) return { ok: false, code: "INVALID_REF" }; // unreachable given REF_RE; fail-closed keeps TS honest
  let buffer: Buffer;
  try {
    buffer = readFileSync(join(dir, filename));
  } catch {
    return { ok: false, code: "NOT_FOUND" }; // GC-swept or never existed
  }
  return { ok: true, mediaType, dataBase64: buffer.toString("base64") };
}

function usage(dir: string): AttachmentUsage {
  let count = 0;
  let bytes = 0;
  for (const name of ownFiles(dir)) {
    count += 1;
    bytes += statSync(join(dir, name)).size;
  }
  return { count, bytes };
}

function removeWhere(dir: string, shouldRemove: (path: string) => boolean): AttachmentSweep {
  let removedCount = 0;
  let freedBytes = 0;
  for (const name of ownFiles(dir)) {
    const path = join(dir, name);
    if (!shouldRemove(path)) continue;
    freedBytes += statSync(path).size;
    rmSync(path);
    removedCount += 1;
  }
  return { removedCount, freedBytes };
}

// Only our content-addressed filenames — a stray hand-dropped file is never swept, counted, or cleared.
function ownFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => FILE_RE.test(name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; // dir not created yet (nothing saved)
    throw error;
  }
}
