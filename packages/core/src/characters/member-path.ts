/**
 * INPUT:  a raw archive member / resource name (from a tar or zip entry, or a manifest resource ref)
 * OUTPUT: safeMemberPath(raw) -> a normalized POSIX-relative path, or null when the name is unsafe
 * POS:    core/characters — THE single-sourced traversal guard for every archive write (#18); both archive readers and
 *         the manifest resolver pass names through here BEFORE any fs path is derived. Reject-on-unsafe is fail-closed.
 */
import { win32 as win32Path, posix as posixPath } from "node:path";

// Windows reserved device names — writing one of these hits a device, not a file. Rejected on every OS (safe superset).
// Kept independent from workspace-paths' identical list on purpose: two distinct security surfaces should not couple.
const RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL", "CLOCK$", "CONIN$", "CONOUT$",
  ..."123456789".split("").flatMap((n) => [`COM${n}`, `LPT${n}`]),
]);

function isReserved(segment: string): boolean {
  // A reserved name is reserved with or without an extension ("NUL.png" still maps to the NUL device). The `$`-suffixed
  // console/clock devices have no extension form, so match both the pre-dot stem and the whole segment.
  const upper = segment.toUpperCase();
  return RESERVED.has(upper) || RESERVED.has((segment.split(".")[0] ?? "").toUpperCase());
}

// Windows strips trailing dots and spaces from every path component before it hits the filesystem, so `.. ` collapses
// to `..` (a parent hop), `NUL ` to the NUL device, and `foo.png ` to a colliding on-disk name — while this guard and
// character-store's path.relative both measure the LITERAL member, diverging from the effective write. No legitimate
// Cubism member carries a trailing dot/space (verified across the real archives), so rejecting any segment that would be
// renamed by that strip is a clean fail-closed superset, not a real-asset regression.
function windowsWouldRename(segment: string): boolean {
  return segment !== segment.replace(/[. ]+$/u, "");
}

/**
 * Normalize + confine an archive member name. Returns the clean POSIX-relative path, or null when the name is
 * unsafe (empty, absolute, drive-lettered, NUL-bearing, escapes its root via `..`, or names a reserved device).
 * A null result is the caller's signal to reject the whole archive with `unsafe_resource_path`.
 */
export function safeMemberPath(raw: string): string | null {
  if (raw.length === 0 || raw.includes("\0") || raw.includes(":")) return null; // empty / NUL / drive-letter or NTFS ADS
  const slashed = raw.replaceAll("\\", "/"); // fold Windows separators so a segment scan sees every boundary
  if (win32Path.isAbsolute(raw) || posixPath.isAbsolute(slashed)) return null; // no absolute members
  const segments: string[] = [];
  for (const segment of slashed.split("/")) {
    if (segment === "" || segment === ".") continue; // collapse `//`, leading `./`, trailing `/`
    // `..` traversal, a reserved device, or any name Windows' trailing-dot/space strip would rewrite (`.. `, `NUL `,
    // `foo.png `) — reject before the name can diverge from what actually lands on disk.
    if (segment === ".." || isReserved(segment) || windowsWouldRename(segment)) return null;
    segments.push(segment);
  }
  if (segments.length === 0) return null; // the name resolved to nothing (e.g. "./" or ".")
  return segments.join("/");
}
