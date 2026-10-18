/**
 * INPUT:  owner-derived backup metadata paths, validated JSON values and explicit byte limits
 * OUTPUT: compact bounded serialization and bounded regular-file UTF-8 reads before JSON parsing
 * POS:    Core artifact I/O boundary; request budgets do not imply a low-memory or ZIP-size guarantee
 */
import { closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { open } from "node:fs/promises";
import { HINDSIGHT_BACKUP_MANIFEST_MAX_BYTES } from "@taki/shared";

const CHUNK_BYTES = 64 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });
export function compactHindsightBackupJson(value: unknown, maximum = HINDSIGHT_BACKUP_MANIFEST_MAX_BYTES): string {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") > maximum) invalid();
  return text;
}
export async function readBoundedHindsightBackupText(path: string, maximum: number): Promise<string> {
  if (lstatSync(path).isSymbolicLink()) invalid();
  const handle = await open(path, "r");
  try {
    const info = await handle.stat(); if (!info.isFile() || info.size > maximum) invalid();
    const chunks: Buffer[] = []; let length = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, maximum - length + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      length += bytesRead; if (length > maximum) invalid();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return utf8.decode(Buffer.concat(chunks, length));
  } finally { await handle.close(); }
}
export function readBoundedHindsightBackupTextSync(path: string, maximum = HINDSIGHT_BACKUP_MANIFEST_MAX_BYTES): string {
  if (lstatSync(path).isSymbolicLink()) invalid();
  const file = openSync(path, "r");
  try {
    const info = fstatSync(file); if (!info.isFile() || info.size > maximum) invalid();
    const chunks: Buffer[] = []; let length = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, maximum - length + 1));
      const bytesRead = readSync(file, chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      length += bytesRead; if (length > maximum) invalid();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return utf8.decode(Buffer.concat(chunks, length));
  } finally { closeSync(file); }
}
function invalid(): never { throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID"); }
