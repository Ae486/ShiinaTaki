/**
 * INPUT: bounded browser directory files, ZIP bytes, or one legacy on-disk Skill directory
 * OUTPUT: normalized regular-file entries after path, link, identity, count, and size checks
 * POS:    core/skills import boundary; every source is bounded before publication or SQLite mutation
 */
import { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, type Stats } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { packagePathCollisionKey, safePackagePath } from "../archive/member-path.ts";
import type { SkillImportSource } from "@taki/shared";
import { SKILL_FILE_COUNT_MAX, SKILL_FILE_MAX_BYTES, SKILL_IMPORT_MAX_BYTES, SKILL_MD_MAX_BYTES, SKILL_TOTAL_MAX_BYTES } from "@taki/shared";
import type { SkillContentFile } from "./skill-package-types.ts";

export class SkillSourceError extends Error {
  readonly reason: "unsafe-package" | "source-too-large";
  constructor(reason: "unsafe-package" | "source-too-large", message = "Skill source refused") { super(message); this.name = "SkillSourceError"; this.reason = reason; }
}

interface SourceState { count: number; total: number; }

export async function enumerateSource(source: SkillImportSource): Promise<SkillContentFile[]> {
  if (source.kind === "directory") return enumerateDirectory(source.files);
  const encoded = decode(source.archiveBase64, SKILL_IMPORT_MAX_BYTES);
  return enumerateZip(encoded);
}

export function enumerateLegacyDirectory(root: string): SkillContentFile[] {
  const initial = lstatSync(root);
  if (!initial.isDirectory() || initial.isSymbolicLink()) throw new SkillSourceError("unsafe-package");
  const resolvedRoot = realpathSync(root);
  const confirmed = lstatSync(root);
  if (!confirmed.isDirectory() || confirmed.isSymbolicLink() || !sameIdentity(initial, confirmed)) throw new SkillSourceError("unsafe-package");
  return validateFiles(walkLegacy(resolvedRoot, resolvedRoot, { count: 0, total: 0 }));
}

function enumerateDirectory(files: Extract<SkillImportSource, { kind: "directory" }>["files"]): SkillContentFile[] {
  if (files.length === 0 || files.length > SKILL_FILE_COUNT_MAX) throw new SkillSourceError("source-too-large");
  const state = { count: 0, total: 0 }; const seen = new Set<string>(); const folded = new Set<string>(); const output: SkillContentFile[] = [];
  for (const file of files) {
    const path = acceptPath(file.path, seen, folded);
    const bytes = decode(file.contentBase64, fileLimit(path));
    addSize(state, bytes.length);
    output.push({ path, bytes });
  }
  return output;
}

function decode(value: string, limit: number): Buffer {
  if (value.length > Math.ceil(limit / 3) * 4) throw new SkillSourceError("source-too-large");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0; const body = padding === 0 ? value : value.slice(0, -padding);
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*$/u.test(body) || (padding === 1 && body.length % 4 !== 3) || (padding === 2 && body.length % 4 !== 2)) throw new SkillSourceError("unsafe-package");
  const decoded = Buffer.from(value, "base64");
  if ((decoded.length === 0 && value.length !== 0) || decoded.length > limit) throw new SkillSourceError(decoded.length > limit ? "source-too-large" : "unsafe-package");
  return decoded;
}

function validateFiles(input: SkillContentFile[]): SkillContentFile[] {
  if (input.length === 0 || input.length > SKILL_FILE_COUNT_MAX) throw new SkillSourceError("source-too-large");
  const state = { count: 0, total: 0 }; const seen = new Set<string>(); const folded = new Set<string>(); const output: SkillContentFile[] = [];
  for (const file of input) {
    const path = acceptPath(file.path, seen, folded);
    if (file.bytes.length > fileLimit(path)) throw new SkillSourceError("source-too-large");
    addSize(state, file.bytes.length);
    output.push({ path, bytes: file.bytes });
  }
  return output;
}

function acceptPath(raw: string, seen: Set<string>, folded: Set<string>): string {
  const path = safePackagePath(raw); const key = path ? packagePathCollisionKey(path) : "";
  if (!path || path !== raw || seen.has(path) || folded.has(key)) throw new SkillSourceError("unsafe-package");
  seen.add(path); folded.add(key); return path;
}

function addSize(state: SourceState, size: number): void {
  state.count += 1; state.total += size;
  if (state.count > SKILL_FILE_COUNT_MAX || state.total > SKILL_TOTAL_MAX_BYTES) throw new SkillSourceError("source-too-large");
}

function fileLimit(path: string): number { return path === "SKILL.md" || path.endsWith("/SKILL.md") ? SKILL_MD_MAX_BYTES : SKILL_FILE_MAX_BYTES; }

function walkLegacy(root: string, current: string, state: SourceState): SkillContentFile[] {
  const result: SkillContentFile[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name); const before = lstatSync(absolute);
    if (entry.isSymbolicLink() || before.isSymbolicLink()) throw new SkillSourceError("unsafe-package");
    const resolved = realpathSync(absolute); if (!isConfined(root, resolved)) throw new SkillSourceError("unsafe-package");
    if (before.isDirectory()) { result.push(...walkLegacy(root, resolved, state)); continue; }
    result.push(readLegacyFile({ root, absolute, resolved, before, state }));
  }
  return result;
}

function readLegacyFile(input: { root: string; absolute: string; resolved: string; before: Stats; state: SourceState }): SkillContentFile {
  const { root, absolute, resolved, before, state } = input;
  if (!before.isFile() || before.nlink > 1) throw new SkillSourceError("unsafe-package");
  const path = relative(root, resolved).replaceAll("\\", "/");
  if (!isConfined(root, resolved) || safePackagePath(path) !== path) throw new SkillSourceError("unsafe-package");
  const handle = openSync(absolute, "r");
  try {
    const opened = fstatSync(handle); const limit = fileLimit(path);
    if (!opened.isFile() || opened.nlink > 1 || opened.size > limit || !sameIdentity(before, opened)) throw new SkillSourceError(opened.size > limit ? "source-too-large" : "unsafe-package");
    addSize(state, opened.size);
    if (realpathSync(absolute) !== resolved) throw new SkillSourceError("unsafe-package");
    const bytes = Buffer.alloc(opened.size); let offset = 0;
    while (offset < bytes.length) { const read = readSync(handle, bytes, offset, bytes.length - offset, offset); if (read === 0) throw new SkillSourceError("unsafe-package"); offset += read; }
    const after = fstatSync(handle); const finalPath = lstatSync(absolute);
    if (!sameIdentity(opened, after) || after.size !== opened.size || finalPath.isSymbolicLink() || !sameIdentity(opened, finalPath) || realpathSync(absolute) !== resolved) throw new SkillSourceError("unsafe-package");
    return { path, bytes };
  } finally { closeSync(handle); }
}

function sameIdentity(left: Stats, right: Stats): boolean { return left.dev === right.dev && left.ino === right.ino && left.size === right.size; }
function isConfined(root: string, candidate: string): boolean { const path = relative(root, candidate); return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..\\`) && !path.startsWith("../")); }

async function enumerateZip(bytes: Buffer): Promise<SkillContentFile[]> {
  let zip: ZipFile | null = null;
  try {
    zip = await yauzl.fromBufferPromise(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
    const files: SkillContentFile[] = []; const state = { count: 0, total: 0 }; const seen = new Set<string>(); const folded = new Set<string>(); let members = 0;
    for await (const entry of zip.eachEntry()) {
      members += 1; if (members > SKILL_FILE_COUNT_MAX) throw new SkillSourceError("source-too-large");
      const isDirectory = entry.fileName.endsWith("/"); const raw = isDirectory ? entry.fileName.slice(0, -1) : entry.fileName;
      const path = acceptPath(raw, seen, folded); validateZipKind(entry, isDirectory);
      if (isDirectory) continue;
      const limit = fileLimit(path);
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > limit) throw new SkillSourceError("source-too-large");
      addSize(state, entry.uncompressedSize);
      files.push({ path, bytes: await readZipEntry(zip, entry, limit) });
    }
    if (files.length === 0) throw new SkillSourceError("unsafe-package");
    return files;
  } catch (error) {
    if (error instanceof SkillSourceError) throw error;
    throw new SkillSourceError("unsafe-package");
  } finally { if (zip?.isOpen) zip.close(); }
}

function validateZipKind(entry: Entry, directory: boolean): void {
  const unixType = (entry.externalFileAttributes >>> 16) & 0o170000; const dosAttributes = entry.externalFileAttributes & 0xffff;
  if (entry.isEncrypted() || !entry.canDecodeFileData() || (dosAttributes & 0x0400) !== 0) throw new SkillSourceError("unsafe-package");
  if (directory) { if (unixType !== 0 && unixType !== 0o040000) throw new SkillSourceError("unsafe-package"); }
  else if (unixType !== 0 && unixType !== 0o100000) throw new SkillSourceError("unsafe-package");
}

async function readZipEntry(zip: ZipFile, entry: Entry, limit: number): Promise<Buffer> {
  const stream = await zip.openReadStreamPromise(entry); const chunks: Buffer[] = []; let size = 0;
  for await (const value of stream as AsyncIterable<unknown>) {
    if (!(value instanceof Uint8Array)) throw new SkillSourceError("unsafe-package");
    const chunk = Buffer.from(value); size += chunk.length;
    if (size > limit || size > entry.uncompressedSize) throw new SkillSourceError(size > limit ? "source-too-large" : "unsafe-package");
    chunks.push(chunk);
  }
  if (size !== entry.uncompressedSize) throw new SkillSourceError("unsafe-package");
  return Buffer.concat(chunks, size);
}
