/**
 * INPUT:  an absolute directory path
 * OUTPUT: directoryByteSize(root) -> the recursive byte total of the directory's files (a missing dir = 0)
 * POS:    core/media — a best-effort fs helper for the media.usage report (memory-text footprint, D27); no OS side effects
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Recursive byte total of a directory's files; best-effort (single-writer core) — a missing/unreadable dir returns 0. */
export function directoryByteSize(root: string): number {
  let names: string[];
  try {
    names = readdirSync(root, { recursive: true }).filter((name): name is string => typeof name === "string");
  } catch {
    return 0; // dir not created yet
  }
  let total = 0;
  for (const name of names) {
    const stat = statSync(join(root, name));
    if (stat.isFile()) total += stat.size;
  }
  return total;
}
