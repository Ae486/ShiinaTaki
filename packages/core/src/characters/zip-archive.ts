/**
 * INPUT:  the raw bytes of a `.zip` archive (a generic-Cubism import, incl. a folder delivered as a zip from the UI)
 * OUTPUT: readZip(bytes) -> Map<safePath, bytes> (directory entries dropped)
 * POS:    core/characters — the generic-import zip reader (#18). fflate unzip + the shared member-path Zip-Slip guard on
 *         every entry BEFORE it lands in the map. Node has no built-in ZIP reader; fflate is pure-JS + OS-neutral.
 */
import { unzipSync } from "fflate";
import { CharacterImportError } from "./import-error.ts";
import { safeMemberPath } from "./member-path.ts";

export function readZip(bytes: Buffer): Map<string, Buffer> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    throw new CharacterImportError("bad_zip", `unreadable .zip archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  const files = new Map<string, Buffer>();
  for (const [rawPath, data] of Object.entries(entries)) {
    if (rawPath.endsWith("/")) continue; // a directory marker — no bytes
    const safe = safeMemberPath(rawPath); // the Zip-Slip guard: fflate returns raw paths, we must confine each one
    if (safe === null) throw new CharacterImportError("unsafe_resource_path", `unsafe zip member: ${rawPath}`);
    files.set(safe, Buffer.from(data));
  }
  return files;
}
