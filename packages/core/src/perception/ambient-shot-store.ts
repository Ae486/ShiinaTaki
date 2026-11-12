/**
 * INPUT:  a base64 PNG from one ambient capture + the epoch-ms it was taken; a sweep cutoff for retention
 * OUTPUT: createAmbientShotStore({ ambientDir }) -> { save, discard, sweepOlderThan }
 * POS:    core/perception — the sanctioned Workspace write site for AMBIENT frames (invariant 2). Deliberately its own
 *         directory and its own filename shape: retention here is automatic and aggressive, and it must be
 *         structurally impossible for it to reach a user-requested capture (capabilities/screenshot-store) or any
 *         other file. Every path is derived from the store's own dir + a validated own-shape name — never from a caller.
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

// Store instances for Sampling and viewing preparation can share the same ambient directory.
const protectedFiles = new Map<string, number>();

// The store's closed namespace: an `ambient-` prefix + an ISO-8601 timestamp with ':' replaced by '-' (colons are
// illegal in Windows filenames; the Workspace stays OS-neutral). discard/sweep only ever touch a name matching this,
// so a hand-dropped or foreign file in the directory is never deleted — and no caller-supplied string can address
// anything else. The PREFIX is what makes the isolation structural rather than merely wired: the on-demand store
// (capabilities/screenshot-store) writes the bare `<ts>.png` shape, so even if someone ever pointed this store at the
// on-demand directory, a user-requested capture still could not match — and retention here is automatic.
const FILE_RE = /^ambient-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z(?:-[a-f0-9-]{36})?\.png$/;

export interface SavedAmbientShot {
  /** The store-internal filename — the ONLY handle a caller may pass back (never a path). */
  name: string;
  bytes: number;
}

export interface AmbientSweep {
  removedCount: number;
  freedBytes: number;
}

export interface AmbientShotStore {
  /** Persist one ambient frame; null when the write failed (perception must degrade, never crash, on a full disk). */
  save(dataBase64: string, at: number): SavedAmbientShot | null;
  /** Protect pending/in-use native evidence from the periodic retention sweep. */
  protect?(name: string): () => void;
  /** Delete one frame this store saved. A foreign/malformed name is a no-op, not an fs call. */
  discard(name: string): void;
  /** Delete ambient frames whose mtime predates the cutoff (retention sweep); a missing dir is an empty sweep. */
  sweepOlderThan(cutoffMs: number): AmbientSweep;
}

export function createAmbientShotStore(deps: { ambientDir: string }): AmbientShotStore {
  const dir = deps.ambientDir;
  return {
    save: (dataBase64, at) => save(dir, dataBase64, at),
    protect(name) {
      if (!FILE_RE.test(name)) return () => undefined;
      const path = resolve(dir, name);
      protectedFiles.set(path, (protectedFiles.get(path) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = protectedFiles.get(path) ?? 0;
        if (count <= 1) protectedFiles.delete(path); else protectedFiles.set(path, count - 1);
      };
    },
    discard(name) {
      if (!FILE_RE.test(name)) return;
      try {
        rmSync(join(dir, name));
      } catch {
        // Already swept by the retention backstop (or never written) — nothing to do, and never a crash.
      }
    },
    sweepOlderThan: (cutoffMs) => sweep(dir, cutoffMs),
  };
}

function save(dir: string, dataBase64: string, at: number): SavedAmbientShot | null {
  const buffer = Buffer.from(dataBase64, "base64");
  const name = `ambient-${new Date(at).toISOString().replaceAll(":", "-")}-${randomUUID()}.png`;
  try {
    mkdirSync(dir, { recursive: true }); // first-write lazily creates the dir (screenshot-store precedent)
    writeFileSync(join(dir, name), buffer);
  } catch {
    return null;
  }
  return { name, bytes: buffer.byteLength };
}

function sweep(dir: string, cutoffMs: number): AmbientSweep {
  let removedCount = 0;
  let freedBytes = 0;
  for (const name of ownFiles(dir)) {
    const path = join(dir, name);
    if (protectedFiles.has(resolve(path))) continue;
    try {
      const stat = statSync(path);
      if (stat.mtimeMs >= cutoffMs) continue;
      rmSync(path);
      removedCount += 1;
      freedBytes += stat.size;
    } catch {
      // A frame that vanished mid-sweep (inline drop raced us) is exactly what we wanted — keep sweeping.
    }
  }
  return { removedCount, freedBytes };
}

// Only this store's own filenames, and only at the TOP level of its own dir (readdir is not recursive): a stray file,
// a subdirectory, or anything living beside the ambient dir can never be swept.
function ownFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => FILE_RE.test(name));
  } catch {
    return []; // dir not created yet (nothing captured) — an empty sweep, never a throw
  }
}
