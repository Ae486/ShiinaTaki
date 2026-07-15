/**
 * INPUT:  the raw bytes of a BanG Dream `character.zst` collection archive (zstd frame wrapping a POSIX ustar tar)
 * OUTPUT: readZstArchive(bytes, opts?) -> { files: Map<safePath, bytes>, index: string[] | undefined }
 * POS:    core/characters — the clean-room `.zst` reader (#18). Zero-dep zstd via node:zlib streamed through tar-stream
 *         (PAX-safe); every member is normalized (member-path) before it lands in the map. Pure computation, OS-neutral.
 */
import { constants, createZstdDecompress } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import tarStream from "tar-stream";
import { CharacterImportError } from "./import-error.ts";
import { safeMemberPath } from "./member-path.ts";

const INDEX_MEMBER = ".bandori_zst_index.json";
// Cap the zstd decode window against a hostile archive claiming an absurd window size (research §caveats). The reference
// archives are level-10 (~8 MB window); 27 (128 MB) is a generous ceiling that still rejects a memory-bomb claim.
const DEFAULT_WINDOW_LOG_MAX = 27;

export interface ZstArchive {
  /** Normalized POSIX-relative member path -> its bytes (real file members only; PAX/dir/symlink entries dropped). */
  files: Map<string, Buffer>;
  /** The `.bandori_zst_index.json` `files[]` manifest when present — the enumeration source of record. */
  index: string[] | undefined;
}

export async function readZstArchive(bytes: Buffer, opts?: { windowLogMax?: number }): Promise<ZstArchive> {
  const extract = tarStream.extract();
  const pumped = pipeline(
    Readable.from(bytes),
    createZstdDecompress({ params: { [constants.ZSTD_d_windowLogMax]: opts?.windowLogMax ?? DEFAULT_WINDOW_LOG_MAX } }),
    extract,
  );
  const files = new Map<string, Buffer>();
  try {
    for await (const entry of extract) await collectEntry(entry, files);
    await pumped;
  } catch (error) {
    await pumped.catch(() => undefined); // absorb any secondary pipeline rejection so it is never unhandled
    if (error instanceof CharacterImportError) throw error; // an unsafe member — propagate the precise reason
    throw new CharacterImportError("bad_zst", `unreadable .zst archive: ${messageOf(error)}`);
  }
  return { files, index: parseIndexMember(files) };
}

async function collectEntry(entry: tarStream.Entry, files: Map<string, Buffer>): Promise<void> {
  const buffer = await bufferEntry(entry); // must fully consume every entry for the iterator to advance
  const type = entry.header.type;
  if (type !== "file" && type !== "contiguous-file") return; // drop PAX pseudo-members, dirs, symlinks
  const safe = safeMemberPath(entry.header.name);
  if (safe === null) throw new CharacterImportError("unsafe_resource_path", `unsafe archive member: ${entry.header.name}`);
  files.set(safe, buffer);
}

async function bufferEntry(entry: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of entry) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function parseIndexMember(files: Map<string, Buffer>): string[] | undefined {
  const raw = files.get(INDEX_MEMBER);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    const list = (parsed as { files?: unknown })?.files;
    if (Array.isArray(list)) return list.filter((f): f is string => typeof f === "string");
  } catch {
    // A corrupt index is non-fatal: enumeration falls back to the (already-normalized) file-map keys.
  }
  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
