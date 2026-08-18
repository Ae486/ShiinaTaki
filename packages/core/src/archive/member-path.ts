/**
 * INPUT: raw archive/resource member names from operator package sources
 * OUTPUT: safePackagePath() plus locale-independent packagePathCollisionKey()
 * POS:    core/archive — domain-neutral path guard shared by Characters and Skill package imports
 */
import { win32 as win32Path, posix as posixPath } from "node:path";

const RESERVED = new Set(["CON", "PRN", "AUX", "NUL", "CLOCK$", "CONIN$", "CONOUT$", ..."123456789".split("").flatMap((n) => [`COM${n}`, `LPT${n}`])]);
function reserved(segment: string): boolean {
  const upper = segment.toUpperCase();
  return RESERVED.has(upper) || RESERVED.has((segment.split(".")[0] ?? "").toUpperCase());
}
export function safePackagePath(raw: string): string | null {
  if (raw.length === 0 || raw.includes("\0") || raw.includes(":")) return null;
  const slashed = raw.replaceAll("\\", "/");
  if (win32Path.isAbsolute(raw) || posixPath.isAbsolute(slashed)) return null;
  const segments: string[] = [];
  for (const segment of slashed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." || reserved(segment) || segment !== segment.replace(/[. ]+$/u, "")) return null;
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

export function packagePathCollisionKey(path: string): string {
  return path.normalize("NFC").replace(/[A-Z]/gu, (character) => character.toLowerCase());
}
