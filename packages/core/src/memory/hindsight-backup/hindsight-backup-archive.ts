/**
 * INPUT:  the path of a native ZIP Core already holds (a claimed inbox ZIP in the staged dir, or a sealed native.zip)
 * OUTPUT: readHindsightBackupArchive(path) -> the ZIP's echoed backup id, native schema and the native proof completed with the
 *         file's own sha256/bytes; refuses PROOF_MISSING (no `taki` object) or ARTIFACT_INVALID (hash/size/entry/schema/version)
 * POS:    core/memory/hindsight-backup — the route-b proof reader (§5.5 in-ZIP proof); reads only, never extracts to disk and
 *         never logs artifact bytes; every `<table>.bin` is re-hashed so the proof describes these exact bytes
 */
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import {
  HindsightNativeArchiveManifestSchema, HindsightBackupNativeProofSchema, parseHindsightApplicationJson,
  type HindsightBackupNativeProof, type HindsightNativeArchiveManifest,
} from "@taki/shared";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { codeOf } from "./hindsight-backup-failure.ts";
import { digestFile, type HindsightBackupFileDigest } from "./hindsight-backup-files.ts";

const MANIFEST_ENTRY = "manifest.json";
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 513;
const TABLE_ENTRY = /^([A-Za-z0-9_]{1,63})\.bin$/;

export interface HindsightBackupArchive {
  version: 1 | 2;
  backupId: string;
  schema: string;
  proof: HindsightBackupNativeProof;
}

interface ArchiveContents { manifest: Buffer | null; tables: Map<string, HindsightBackupFileDigest> }

export async function readHindsightBackupArchive(path: string): Promise<HindsightBackupArchive> {
  try {
    if (!(await lstat(path)).isFile()) throw invalid();
    const file = await digestFile(path);
    const contents = await readEntries(path);
    const manifest = parseManifest(contents.manifest);
    if (!manifest.taki) throw new Error("HINDSIGHT_BACKUP_PROOF_MISSING");
    assertEntries(manifest, contents.tables);
    if (manifest.taki.version === 2 && manifest.taki.proof.templates.some((bank) => bank.selected.state === "selected"
      && bank.selected.configurationObservation.schema !== manifest.schema)) throw invalid();
    return { version: manifest.taki.version, backupId: manifest.taki.backupId, schema: manifest.schema,
      proof: HindsightBackupNativeProofSchema.parse({ ...manifest.taki.proof, zipSha256: file.sha256, zipBytes: file.bytes }) };
  } catch (error) {
    // yauzl and fs errors carry paths and offsets; only the closed code leaves this reader.
    throw new Error(codeOf(error, "HINDSIGHT_BACKUP_ARTIFACT_INVALID"), { cause: error });
  }
}

async function readEntries(path: string): Promise<ArchiveContents> {
  let zip: ZipFile | null = null;
  try {
    zip = await yauzl.openPromise(path, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true, autoClose: false });
    const contents: ArchiveContents = { manifest: null, tables: new Map() };
    let count = 0;
    for await (const entry of zip.eachEntry()) {
      count += 1;
      if (count > MAX_ENTRIES || entry.isEncrypted() || !entry.canDecodeFileData()) throw invalid();
      await readEntry(zip, { entry, contents });
    }
    return contents;
  } finally {
    if (zip?.isOpen) zip.close();
  }
}

async function readEntry(zip: ZipFile, input: { entry: Entry; contents: ArchiveContents }): Promise<void> {
  const { entry, contents } = input;
  if (entry.fileName === MANIFEST_ENTRY) {
    if (contents.manifest !== null || entry.uncompressedSize > MANIFEST_MAX_BYTES) throw invalid();
    contents.manifest = await drain(zip, { entry, keep: true }).then((read) => read.bytes);
    return;
  }
  const table = TABLE_ENTRY.exec(entry.fileName)?.[1];
  if (table === undefined || contents.tables.has(table)) throw invalid();
  contents.tables.set(table, (await drain(zip, { entry, keep: false })).digest);
}

async function drain(zip: ZipFile, input: { entry: Entry; keep: boolean }): Promise<{ digest: HindsightBackupFileDigest; bytes: Buffer }> {
  const hash = createHash("sha256"); const chunks: Buffer[] = []; let size = 0;
  for await (const value of await zip.openReadStreamPromise(input.entry) as AsyncIterable<unknown>) {
    if (!(value instanceof Uint8Array)) throw invalid();
    hash.update(value); size += value.length;
    if (input.keep && size > MANIFEST_MAX_BYTES) throw invalid();
    if (input.keep) chunks.push(Buffer.from(value));
  }
  if (size !== input.entry.uncompressedSize) throw invalid();
  return { digest: { sha256: hash.digest("hex"), bytes: size }, bytes: Buffer.concat(chunks) };
}

function parseManifest(bytes: Buffer | null): HindsightNativeArchiveManifest {
  if (bytes === null) throw invalid();
  let value: unknown;
  try { value = parseHindsightApplicationJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw invalid(); }
  const manifest = HindsightNativeArchiveManifestSchema.safeParse(value);
  if (!manifest.success) throw invalid();
  return manifest.data;
}

/** The native table list, the ZIP's `.bin` entries and the proof's pinned entries name the same tables with the same bytes. */
function assertEntries(manifest: HindsightNativeArchiveManifest, tables: ReadonlyMap<string, HindsightBackupFileDigest>): void {
  const pinned = manifest.taki?.entries ?? [];
  const names = Object.keys(manifest.tables);
  if (names.length !== tables.size || pinned.length !== tables.size) throw invalid();
  for (const name of names) {
    const actual = tables.get(name);
    if (!actual || actual.bytes !== manifest.tables[name]?.size_bytes) throw invalid();
  }
  for (const entry of pinned) {
    const actual = tables.get(entry.name.slice(0, -".bin".length));
    if (!actual || actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes) throw invalid();
  }
}

function invalid(): Error {
  return new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
}
