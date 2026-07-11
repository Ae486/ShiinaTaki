/**
 * INPUT:  a Workspace root dir + a model-supplied, Workspace-relative path string
 * OUTPUT: createWorkspacePaths({ root }) -> { resolve } — a confined { real, relative } or a structured reject code
 * POS:    core/workspace — the path-escape SECURITY CORE (ruling 8); realpath-based symlink defense; the confinement
 *         gate every workspace file tool passes through before touching node:fs
 */
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { win32 as win32Path, posix as posixPath, basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Why a path was refused before any IO happened. */
export type WorkspacePathError = "INVALID_PATH" | "OUTSIDE_WORKSPACE";

export type ResolvedPath =
  | { ok: true; real: string; relative: string }
  | { ok: false; code: WorkspacePathError };

export interface WorkspacePaths {
  /** Validates + canonicalizes a relative path; returns the absolute `real` FS path and the Workspace-relative echo. */
  resolve(input: string): ResolvedPath;
}

// Windows reserved device names — opening these hits a device, not a Workspace file. Rejected on every OS (safe superset).
const RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  ..."123456789".split("").flatMap((n) => [`COM${n}`, `LPT${n}`]),
]);

function isReserved(segment: string): boolean {
  // A reserved name is reserved with or without an extension ("NUL.txt" still maps to the NUL device).
  return RESERVED.has((segment.split(".")[0] ?? "").toUpperCase());
}

// Reject-before-resolving: absolute inputs, any ':' (drive letter / NTFS ADS), '..' escape leaves, reserved device names.
function validateLexical(input: string): boolean {
  if (input.length === 0 || input.includes(":")) return false;
  if (win32Path.isAbsolute(input) || posixPath.isAbsolute(input)) return false;
  for (const segment of input.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." || isReserved(segment)) return false;
  }
  return true;
}

// The deepest ancestor of `target` that exists on disk, plus the tail of not-yet-created components (write creates them).
function splitExisting(target: string): { existing: string; missing: string[] } {
  const missing: string[] = [];
  let existing = target;
  while (lstatSync(existing, { throwIfNoEntry: false }) === undefined) {
    missing.unshift(basename(existing));
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  return { existing, missing };
}

export function createWorkspacePaths(deps: { root: string }): WorkspacePaths {
  // Canonicalize the root ONCE (realpath resolves any symlink in the root itself, so confinement compares like-for-like).
  mkdirSync(deps.root, { recursive: true });
  const realRoot = realpathSync(deps.root);

  return {
    resolve(input) {
      if (!validateLexical(input)) return { ok: false, code: "INVALID_PATH" };
      let real: string;
      try {
        // Inside the try: lstat/realpath can throw on hostile-but-lexically-clean inputs (a NUL byte, a component
        // under a file, a broken symlink) — the no-throw contract turns every such case into a structured reject.
        const target = resolve(realRoot, input);
        const { existing, missing } = splitExisting(target);
        // realpath resolves symlinks in every EXISTING component (the symlink-escape defense).
        const realExisting = realpathSync(existing);
        real = missing.length > 0 ? join(realExisting, ...missing) : realExisting;
      } catch {
        return { ok: false, code: "INVALID_PATH" };
      }
      const rel = relative(realRoot, real);
      // Component-wise confinement: a real path outside the root yields a '..'/absolute relative — reject it.
      if (rel.startsWith("..") || isAbsolute(rel)) return { ok: false, code: "OUTSIDE_WORKSPACE" };
      return { ok: true, real, relative: rel === "" ? "." : rel };
    },
  };
}
