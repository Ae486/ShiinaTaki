/**
 * INPUT:  a locally held sealed Native ZIP and independently observed original-version target schema
 * OUTPUT: Stage 3-verified archive proof plus complete COPY tuple, column and SQL body inventories
 * POS:    D1 admission extension over the existing backup reader; read-only, no extraction or alternate backup owner
 */
import { createHash } from "node:crypto";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { HindsightCandidateArchiveManifestSchema, HINDSIGHT_BACKUP_MANIFEST_MAX_BYTES, parseHindsightApplicationJson,
  type HindsightCandidateSchemaInventory, type HindsightCandidateInventory } from "@taki/shared";
import { readHindsightBackupArchive } from "../hindsight-backup/hindsight-backup-archive.ts";
import { errorCode } from "../hindsight-backup/hindsight-backup-files.ts";
import { CopyStreamDecoder } from "./hindsight-candidate-copy-stream.ts";
import { candidateDigest, assertCandidateDigest } from "./hindsight-candidate-files.ts";
import { admitCandidateSchema } from "./hindsight-candidate-schema-admission.ts";
import { HINDSIGHT_CANDIDATE_BODY_REFERENCE, HINDSIGHT_CANDIDATE_TABLES } from "./hindsight-candidate-profile.ts";
import { refuse, refusalOf } from "./hindsight-candidate-refusal.ts";

export async function readCandidateArchive(path: string, target: HindsightCandidateSchemaInventory) {
  // The caller's observed schema belongs to this admission, not to later mutations during file I/O.
  const targetSchema = structuredClone(target);
  const before = await candidateDigest(path, "archive");
  try {
    const contents = await inspectArchive(path, targetSchema);
    const verified = await readHindsightBackupArchive(path);
    if (verified.version !== 2 || !("version" in verified.proof) || verified.proof.version !== 2) refuse("unsupported", "manifest");
    assertCandidateDigest(await candidateDigest(path, "archive"), before, "archive");
    assertCandidateDigest({ sha256: verified.proof.zipSha256, bytes: verified.proof.zipBytes }, before, "archive");
    return { ...contents, verified };
  } catch (error) {
    if (["EACCES", "EPERM", "EIO", "EMFILE", "ENFILE"].includes(errorCode(error) ?? "")) refuse("unreadable", "archive");
    throw refusalOf(error, ["tampered", "archive"]);
  }
}

async function inspectArchive(path: string, target: HindsightCandidateSchemaInventory) {
  const zip = await yauzl.openPromise(path, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true, autoClose: false });
  try {
    const entries = await indexEntries(zip);
    const manifest = await readManifest(zip, entries.get("manifest.json"));
    const schema = admitCandidateSchema(manifest, target);
    const tables: HindsightCandidateInventory["tables"] = [];
    const keys = new Map<string, string[]>();
    for (const [name, family] of HINDSIGHT_CANDIDATE_TABLES) {
      const entry = entries.get(`${name}.bin`); const declared = manifest.tables[name];
      if (!entry || !declared) refuse("omitted_required_data", "table", { name });
      const columns = declared.columns.map(({ name, type_name }) => ({ name, typeName: type_name }));
      const collect = bodyKeyColumn(name, columns);
      const required = name === "file_storage" ? [columns.findIndex((column) => column.name === "data")] : [];
      const decoder = new CopyStreamDecoder({ fields: columns.length, required, ...(collect === undefined ? {} : { collect }) });
      const digest = await readCopy(zip, entry, decoder);
      if (digest.rows !== declared.rows || digest.bytes !== declared.size_bytes) refuse("tampered", "table", { name });
      const pinned = manifest.taki?.entries.find((value) => value.name === entry.fileName);
      if (!pinned || pinned.sha256 !== digest.sha256 || pinned.bytes !== digest.bytes) refuse("tampered", "table", { name });
      keys.set(name, digest.values);
      tables.push({ name, family, columns, rows: digest.rows, rowsDigest: digest.rowsDigest, bytes: digest.bytes, sha256: digest.sha256 });
    }
    tables.sort((left, right) => left.name.localeCompare(right.name, "en"));
    const bodies = assertBodyClosure(keys, tables);
    return { schema, tables, bodies };
  } finally { if (zip.isOpen) zip.close(); }
}

async function indexEntries(zip: ZipFile) {
  const entries = new Map<string, Entry>();
  for await (const entry of zip.eachEntry()) {
    if (entries.size >= 513 || entries.has(entry.fileName) || entry.isEncrypted() || !entry.canDecodeFileData()
      || entry.fileName !== "manifest.json" && !/^[A-Za-z0-9_]{1,63}\.bin$/.test(entry.fileName)) refuse("tampered", "archive");
    entries.set(entry.fileName, entry);
  }
  return entries;
}

async function readManifest(zip: ZipFile, entry: Entry | undefined) {
  if (!entry) refuse("omitted_required_data", "manifest");
  if (entry.uncompressedSize > HINDSIGHT_BACKUP_MANIFEST_MAX_BYTES) refuse("unsupported", "manifest");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of await zip.openReadStreamPromise(entry) as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > HINDSIGHT_BACKUP_MANIFEST_MAX_BYTES) refuse("unsupported", "manifest");
    chunks.push(Buffer.from(chunk));
  }
  const value = parseHindsightApplicationJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  if (typeof value !== "object" || value === null || !("version" in value) || value.version !== "2") refuse("unsupported", "manifest");
  const parsed = HindsightCandidateArchiveManifestSchema.safeParse(value);
  if (!parsed.success) refuse("omitted_required_data", "column");
  return parsed.data;
}

async function readCopy(zip: ZipFile, entry: Entry, decoder: CopyStreamDecoder) {
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of await zip.openReadStreamPromise(entry) as AsyncIterable<Uint8Array>) {
    hash.update(chunk); bytes += chunk.length; decoder.push(chunk);
  }
  return { ...decoder.finish(), bytes, sha256: hash.digest("hex") };
}

function bodyKeyColumn(name: string, columns: { name: string }[]) {
  const rule = Object.values(HINDSIGHT_CANDIDATE_BODY_REFERENCE).find((value) => value.table === name);
  if (!rule) return undefined;
  const index = columns.findIndex((column) => column.name === rule.column);
  if (index < 0) refuse("omitted_required_data", "column", { name: `${name}.${rule.column}` });
  return index;
}

function assertBodyClosure(keys: Map<string, string[]>, tables: HindsightCandidateInventory["tables"]) {
  const refs = keys.get("documents") ?? []; const stored = keys.get("file_storage") ?? [];
  if (stored.length !== tables.find((table) => table.name === "file_storage")?.rows
    || new Set(stored).size !== stored.length) refuse("tampered", "body");
  const available = new Set(stored);
  if (refs.some((key) => !available.has(key))) refuse("omitted_required_data", "body");
  return { referenced: refs.length, stored: stored.length };
}
