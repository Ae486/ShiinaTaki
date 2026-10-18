/**
 * INPUT:  the Core data dir, Core-minted backup ids, a Core-copy writer (Database.backupTo), complete manifests, staged
 *         route-b records, validated inbox file names and incident manifests
 * OUTPUT: createHindsightBackupStore(dataDir) -> begin/captureCore/seal/discard/quarantine, route-b stage/readStaged/listStagedSync/
 *         claimInbox/returnInbox/sealStaged, markVerified, list/listSync/read/readSync/digest/nativePath, writeIncident over
 *         `<dataDir>/backups/`: `<id>.partial/` while capturing, `<id>.staged/` awaiting the operator's native ZIP, `<id>/`
 *         once sealed, `incident-<id>/` for emergency evidence; owner-only where modes exist
 * POS:    core/memory/hindsight-backup — the only site naming backup dirs; every path derives from dataDir + a validated id or
 *         inbox name, never a caller path; a partial, staged or quarantined dir is never listed
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { chmod, lstat, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  HindsightBackupIdSchema, HindsightBackupInboxFileSchema, HindsightBackupManifestSchema, HindsightBackupNativeRequestSchema,
  HindsightIncidentManifestSchema, HINDSIGHT_BACKUP_V2_REQUEST_MAX_BYTES, HINDSIGHT_BACKUP_MANIFEST_MAX_BYTES,
  parseHindsightApplicationJson, type HindsightBackupManifest, type HindsightIncidentManifest,
} from "@taki/shared";
import { z } from "zod";
import {
  digestFile, errorCode, exists, OWNER_DIR, OWNER_FILE, removeDir, replaceOwnerFile, storageFailed, writeOwnerFile,
  type HindsightBackupFileDigest,
} from "./hindsight-backup-files.ts";
import { compactHindsightBackupJson, readBoundedHindsightBackupText, readBoundedHindsightBackupTextSync } from "./hindsight-backup-json.ts";
import { readHindsightBackupRequest } from "./hindsight-template-backup-integrity.ts";
import { HindsightBackupStagedCoreSchema as StagedCoreSchema, HindsightBackupStagedRecordSchema,
  type HindsightBackupStagedRecord } from "./hindsight-backup-staging.ts";
export type { HindsightBackupStagedRecord } from "./hindsight-backup-staging.ts";

export const HINDSIGHT_BACKUP_CORE_FILE = "core.sqlite";
export const HINDSIGHT_BACKUP_NATIVE_FILE = "native.zip";
export const HINDSIGHT_BACKUP_REQUEST_FILE = "native-request.json";
const IDENTITY_FILE = "core-identity.json";
const MANIFEST_FILE = "manifest.json";
const QUARANTINE_DIR = "quarantine";
const INBOX_DIR = "inbox";

export type HindsightBackupFile = typeof HINDSIGHT_BACKUP_CORE_FILE | typeof HINDSIGHT_BACKUP_NATIVE_FILE;
type CoreDigest = HindsightBackupFileDigest & { pages: number };

export interface HindsightBackupStagedSummary { backupId: string; createdAt: string; epochId: string }

export interface HindsightBackupStore {
  readonly root: string;
  /** Creates `<id>.partial/`; refuses an id that already has a partial or sealed dir. */
  begin(backupId: string): Promise<void>;
  /** Writes core.sqlite into the partial dir; any failure removes the whole partial dir before rethrowing. */
  captureCore(backupId: string, write: (path: string) => Promise<number>): Promise<CoreDigest>;
  /** Re-hashes the staged files against the manifest, writes manifest.json and renames the partial dir into place. */
  seal(manifest: HindsightBackupManifest): Promise<void>;
  discard(backupId: string): Promise<void>;
  /** Moves a leftover partial dir under `quarantine/`; true when one existed. Synchronous: boot observation cannot await. */
  quarantine(backupId: string): boolean;
  /** Route b: writes the native request and Core identity beside the Core copy and renames the partial dir to `<id>.staged/`. */
  stage(record: HindsightBackupStagedRecord): Promise<void>;
  readStaged(backupId: string): Promise<HindsightBackupStagedRecord | null>;
  /** Staged route-b captures with a readable Core identity, newest first; synchronous for status reads. */
  listStagedSync(): HindsightBackupStagedSummary[];
  /**
   * Moves the inbox ZIP into the owner-only staged dir as native.zip before any byte is read, so the file judged is the file
   * sealed; refuses a missing, non-regular or symlinked inbox entry. Returns the staged native path.
   */
  claimInbox(backupId: string, fileName: string): Promise<string>;
  /** Puts a claimed ZIP back under its inbox name; false when nothing was claimed or the name is taken again. Synchronous for boot. */
  returnInbox(backupId: string, fileName: string): boolean;
  /** Seals a staged dir holding core.sqlite and the claimed native.zip under the complete manifest. */
  sealStaged(manifest: HindsightBackupManifest): Promise<void>;
  /** Atomically rewrites the sealed manifest with only `verifiedAt` changed; the artifact files are never touched. */
  markVerified(backupId: string, verifiedAt: string | null): Promise<HindsightBackupManifest>;
  /** Sealed backups with a schema-valid manifest naming their own dir, oldest first. */
  list(): Promise<HindsightBackupManifest[]>;
  /** The same listing for synchronous status reads (small local manifest files, no network). */
  listSync(): HindsightBackupManifest[];
  read(backupId: string): Promise<HindsightBackupManifest | null>;
  readSync(backupId: string): HindsightBackupManifest | null;
  digest(backupId: string, file: HindsightBackupFile): Promise<HindsightBackupFileDigest>;
  /** The sealed dir's native.zip path, for re-reading a Core-held archive. */
  nativePath(backupId: string): string;
  /** An owner-derived completed copy; the reader refuses symlinked directories and nonregular files. */
  corePath(backupId: string, state?: "sealed" | "staged" | "partial"): string;
  /** A fresh partial copy is inspected before atomic seal. Failure never removes an existing sealed incident. */
  writeIncident(incidentId: string, input: { write(path: string): Promise<number>;
    manifest(core: CoreDigest, path: string): HindsightIncidentManifest }): Promise<void>;
  /** Missing final directory returns null; a present but incomplete, corrupt or misnamed artifact refuses. */
  readIncident(incidentId: string): Promise<HindsightIncidentManifest | null>;
  incidentCorePath(incidentId: string): string;
}

export function createHindsightBackupStore(dataDir: string): HindsightBackupStore {
  const paths = storePaths(join(dataDir, "backups"));
  return { root: paths.root, ...captureMethods(paths), ...stagedMethods(paths), ...sealedMethods(paths), ...incidentMethods(paths.root),
    corePath: (id, state = "sealed") => {
      const dir = paths[state](id); const path = join(dir, HINDSIGHT_BACKUP_CORE_FILE);
      if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink() || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) invalidIncident();
      return path;
    } };
}

interface StorePaths {
  root: string;
  sealed(backupId: string): string; partial(backupId: string): string; staged(backupId: string): string;
  inbox(fileName: string): string;
}

function storePaths(root: string): StorePaths {
  return {
    root,
    sealed: (backupId) => join(root, requireBackupId(backupId)),
    partial: (backupId) => join(root, `${requireBackupId(backupId)}.partial`),
    staged: (backupId) => join(root, `${requireBackupId(backupId)}.staged`),
    inbox: (fileName) => {
      if (!HindsightBackupInboxFileSchema.safeParse(fileName).success) throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
      return join(root, INBOX_DIR, fileName);
    },
  };
}

function captureMethods(paths: StorePaths): Pick<HindsightBackupStore, "begin" | "captureCore" | "seal" | "discard" | "quarantine"> {
  const { root } = paths;
  return {
    begin: async (backupId) => {
      await mkdir(root, { recursive: true, mode: OWNER_DIR });
      if (await exists(paths.sealed(backupId)) || await exists(paths.staged(backupId))) throw storageFailed();
      await mkdir(paths.partial(backupId), { mode: OWNER_DIR });
    },
    captureCore: (backupId, write) => captureCore(paths.partial(backupId), write),
    seal: async (manifest) => {
      const value = parseManifest(manifest);
      await sealDir(paths.partial(value.backupId), { manifest: value, target: paths.sealed(value.backupId) });
    },
    discard: (backupId) => removeDir(paths.partial(backupId)),
    quarantine: (backupId) => {
      const partial = paths.partial(backupId);
      if (!existsSync(partial)) return false;
      mkdirSync(join(root, QUARANTINE_DIR), { recursive: true, mode: OWNER_DIR });
      renameSync(partial, join(root, QUARANTINE_DIR, requireBackupId(backupId)));
      return true;
    },
  };
}

function incidentMethods(root: string): Pick<HindsightBackupStore, "writeIncident" | "readIncident" | "incidentCorePath"> {
  const directory = (id: string) => join(root, `incident-${z.uuid().parse(id)}`);
  return {
    incidentCorePath: (id) => join(directory(id), HINDSIGHT_BACKUP_CORE_FILE),
    readIncident: async (id) => {
      const dir = directory(id);
      if (!await exists(dir)) return null;
      if (!(await lstat(dir)).isDirectory() || (await lstat(dir)).isSymbolicLink()) invalidIncident();
      const value = HindsightIncidentManifestSchema.safeParse(readJsonSync(join(dir, MANIFEST_FILE)));
      if (!value.success || value.data.incidentId !== id) invalidIncident();
      const path = join(dir, HINDSIGHT_BACKUP_CORE_FILE);
      if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink()) invalidIncident();
      const digest = await digestFile(path);
      if (digest.sha256 !== value.data.core.sha256 || digest.bytes !== value.data.core.bytes) invalidIncident();
      return value.data;
    },
    writeIncident: async (id, input) => {
      await mkdir(root, { recursive: true, mode: OWNER_DIR });
      const target = directory(id); const partial = `${target}.partial`;
      if (await exists(target)) invalidIncident();
      // Create-only ownership is acquired outside cleanup. A failed retry cannot delete an earlier partial or seal.
      await mkdir(partial, { mode: OWNER_DIR });
      try {
        const core = await captureCore(partial, input.write);
        const path = join(partial, HINDSIGHT_BACKUP_CORE_FILE);
        const manifest = HindsightIncidentManifestSchema.parse(input.manifest(core, path));
        if (manifest.incidentId !== id || manifest.core.sha256 !== core.sha256 || manifest.core.bytes !== core.bytes) invalidIncident();
        const actual = await digestFile(path);
        if (actual.sha256 !== core.sha256 || actual.bytes !== core.bytes) invalidIncident();
        await writeOwnerFile(join(partial, MANIFEST_FILE), json(manifest));
        if (await exists(target)) invalidIncident();
        await rename(partial, target);
      } catch (error) {
        await removeDir(partial);
        throw error;
      }
    },
  };
}
function invalidIncident(): never { throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID"); }

function stagedMethods(paths: StorePaths): Pick<HindsightBackupStore, "stage" | "readStaged" | "listStagedSync" | "claimInbox" | "returnInbox" | "sealStaged"> {
  return {
    stage: async (record) => {
      const value = HindsightBackupStagedRecordSchema.parse(record); const dir = paths.partial(value.request.backupId);
      await writeOwnerFile(join(dir, HINDSIGHT_BACKUP_REQUEST_FILE), compactHindsightBackupJson(readHindsightBackupRequest(value.request), HINDSIGHT_BACKUP_V2_REQUEST_MAX_BYTES));
      await writeOwnerFile(join(dir, IDENTITY_FILE), json(value.core));
      await rename(dir, paths.staged(value.request.backupId));
    },
    readStaged: (backupId) => readStaged(paths.staged(backupId), backupId),
    listStagedSync: () => listStaged(paths),
    claimInbox: (backupId, fileName) => claimInbox({ from: paths.inbox(fileName), dir: paths.staged(backupId) }),
    returnInbox: (backupId, fileName) => {
      const [from, to] = [join(paths.staged(backupId), HINDSIGHT_BACKUP_NATIVE_FILE), paths.inbox(fileName)];
      if (!existsSync(from) || existsSync(to)) return false;
      renameSync(from, to);
      return true;
    },
    sealStaged: async (manifest) => {
      const value = parseManifest(manifest);
      if (value.native.location !== "core-dir") throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
      await sealDir(paths.staged(value.backupId), { manifest: value, target: paths.sealed(value.backupId) });
    },
  };
}

function sealedMethods(paths: StorePaths): Pick<HindsightBackupStore, "markVerified" | "list" | "listSync" | "read" | "readSync" | "digest" | "nativePath"> {
  const read = (backupId: string) => readManifest(paths.sealed(backupId), backupId);
  const listSync = () => listManifests(paths.root, read);
  return {
    markVerified: async (backupId, verifiedAt) => {
      const current = read(backupId);
      if (!current) throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
      const next = parseManifest({ ...current, verifiedAt });
      await replaceOwnerFile(join(paths.sealed(backupId), MANIFEST_FILE), json(next));
      return next;
    },
    list: () => Promise.resolve(listSync()),
    listSync,
    read: (backupId) => Promise.resolve(read(backupId)),
    readSync: read,
    digest: (backupId, file) => digestFile(join(paths.sealed(backupId), file)),
    nativePath: (backupId) => join(paths.sealed(backupId), HINDSIGHT_BACKUP_NATIVE_FILE),
  };
}

async function captureCore(dir: string, write: (path: string) => Promise<number>): Promise<CoreDigest> {
  const path = join(dir, HINDSIGHT_BACKUP_CORE_FILE);
  try {
    // backup() overwrites an existing file; the partial dir is fresh by construction, so anything here is foreign.
    if (await exists(path)) throw storageFailed();
    const pages = await write(path);
    await chmod(path, OWNER_FILE);
    return { pages, ...(await digestFile(path)) };
  } catch (error) {
    await removeDir(dir);
    throw error;
  }
}

async function assertStagedFiles(dir: string, manifest: HindsightBackupManifest): Promise<void> {
  const core = await digestFile(join(dir, HINDSIGHT_BACKUP_CORE_FILE));
  if (core.sha256 !== manifest.core.sha256 || core.bytes !== manifest.core.bytes) throw storageFailed();
  if (manifest.native.location !== "core-dir") return;
  const native = await digestFile(join(dir, HINDSIGHT_BACKUP_NATIVE_FILE));
  if (native.sha256 !== manifest.native.proof.zipSha256 || native.bytes !== manifest.native.proof.zipBytes) throw storageFailed();
}

async function sealDir(dir: string, input: { manifest: HindsightBackupManifest; target: string }): Promise<void> {
  if (await exists(input.target)) throw storageFailed();
  await assertStagedFiles(dir, input.manifest);
  const manifest = join(dir, MANIFEST_FILE);
  await writeOwnerFile(manifest, json(input.manifest));
  try { await rename(dir, input.target); }
  catch (error) {
    // A staged dir outlives a failed seal; a leftover manifest would make it look sealed and block the next attempt.
    await rm(manifest, { force: true });
    throw error;
  }
}

async function claimInbox(input: { from: string; dir: string }): Promise<string> {
  const native = join(input.dir, HINDSIGHT_BACKUP_NATIVE_FILE);
  if (!await exists(join(input.dir, IDENTITY_FILE)) || await exists(native)) throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
  // Same volume under backups/, so the operator's ZIP is moved, never copied.
  try { await rename(input.from, native); }
  catch (error) { throw errorCode(error) === "ENOENT" ? new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID") : error; }
  // rename moves a symlink itself; only a regular file is ever judged or sealed.
  if (!(await lstat(native)).isFile()) {
    await rename(native, input.from);
    throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
  }
  await chmod(native, OWNER_FILE);
  return native;
}

async function readStaged(dir: string, backupId: string): Promise<HindsightBackupStagedRecord | null> {
  let texts: [string, string];
  try { texts = [await readBoundedHindsightBackupText(join(dir, HINDSIGHT_BACKUP_REQUEST_FILE), HINDSIGHT_BACKUP_V2_REQUEST_MAX_BYTES),
    await readBoundedHindsightBackupText(join(dir, IDENTITY_FILE), HINDSIGHT_BACKUP_MANIFEST_MAX_BYTES)]; }
  catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return null;
    throw error;
  }
  const request = HindsightBackupNativeRequestSchema.safeParse(parseJson(texts[0]));
  const core = StagedCoreSchema.safeParse(parseJson(texts[1]));
  if (!request.success || !core.success || request.data.backupId !== backupId || core.data.backupId !== backupId) {
    throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
  }
  return HindsightBackupStagedRecordSchema.parse({ request: readHindsightBackupRequest(request.data), core: core.data });
}

function listManifests(root: string, read: (backupId: string) => HindsightBackupManifest | null): HindsightBackupManifest[] {
  const manifests: HindsightBackupManifest[] = [];
  // Partial, staged, quarantine, incident and inbox entries never parse as a backup id.
  for (const name of listNames(root).filter((entry) => HindsightBackupIdSchema.safeParse(entry).success)) {
    const manifest = read(name);
    if (manifest) manifests.push(manifest);
  }
  return manifests.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

function listStaged(paths: StorePaths): HindsightBackupStagedSummary[] {
  const summaries = listNames(paths.root).flatMap((name) => {
    const backupId = name.endsWith(".staged") ? name.slice(0, -".staged".length) : "";
    if (!HindsightBackupIdSchema.safeParse(backupId).success) return [];
    const core = StagedCoreSchema.safeParse(readJsonSync(join(paths.staged(backupId), IDENTITY_FILE)));
    return core.success && core.data.backupId === backupId ? [{ backupId, createdAt: core.data.createdAt, epochId: core.data.authority.epochId }] : [];
  });
  return summaries.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function listNames(root: string): string[] {
  try { return readdirSync(root); }
  catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
}

function readManifest(dir: string, backupId: string): HindsightBackupManifest | null {
  const manifest = HindsightBackupManifestSchema.safeParse(readJsonSync(join(dir, MANIFEST_FILE)));
  return manifest.success && manifest.data.backupId === backupId ? manifest.data : null;
}

/** A missing file reads as undefined, which no schema accepts. */
function readJsonSync(path: string): unknown {
  let text: string;
  try { text = readBoundedHindsightBackupTextSync(path); }
  catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return undefined;
    throw error;
  }
  return parseJson(text);
}

function parseManifest(manifest: unknown): HindsightBackupManifest {
  const value = HindsightBackupManifestSchema.safeParse(manifest);
  if (!value.success) throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
  return value.data;
}

function parseJson(text: string): unknown {
  try { return parseHindsightApplicationJson(text); }
  catch { return undefined; }
}

function json(value: unknown): string {
  return compactHindsightBackupJson(value);
}

function requireBackupId(backupId: string): string {
  if (!HindsightBackupIdSchema.safeParse(backupId).success) throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
  return backupId;
}
