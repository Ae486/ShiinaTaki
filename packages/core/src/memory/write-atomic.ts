/**
 * INPUT:  a target file path + the full text to store there
 * OUTPUT: writeAtomic(filePath, text) — mkdir -p the parent, write a temp sibling, rename over the target
 * POS:    core/memory — the ONE write primitive for Workspace files (entry files + blocks): a concurrent reader
 *         never observes a half-written file, so a crash mid-write cannot corrupt truth
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeAtomic(filePath: string, text: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, text);
  renameSync(tempPath, filePath); // same-volume atomic replace (Workspace-local)
}
