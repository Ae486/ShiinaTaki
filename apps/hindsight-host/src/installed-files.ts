/**
 * INPUT:  fixed registered files and the actual Unix effective user
 * OUTPUT: bounded read-only file snapshots with current path/descriptor and protected-parent checks
 * POS:    hindsight-host — Linux custody adapter; Windows replacement guards belong to the Rust invoker
 */
import { constants, lstatSync, openSync, closeSync, fstatSync, readSync, type BigIntStats } from "node:fs";
import { dirname, isAbsolute, parse, resolve } from "node:path";
import { createHash } from "node:crypto";
import { CustodyError } from "./custody-error.ts";

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface ProtectedParent { path: string; identity: string }
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

export function requireProtectedPath(path: string, uid: number, secret = false): ProtectedParent[] {
  return requireProtected(path, uid, { file: true, secret });
}

export function requireProtectedDirectory(path: string, uid: number): ProtectedParent[] {
  return requireProtected(path, uid, { file: false, secret: false });
}

function requireProtected(path: string, uid: number, kind: { file: boolean; secret: boolean }): ProtectedParent[] {
  if (!isAbsolute(path) || resolve(path) !== path) throw new CustodyError("unsafe-installation");
  const parents: ProtectedParent[] = [];
  let candidate = path;
  let leaf = true;
  for (;;) {
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink() || (stat.uid !== uid && stat.uid !== 0) || (stat.mode & 0o022) !== 0
      || (leaf && kind.file && (!stat.isFile() || stat.nlink !== 1 || (kind.secret && (stat.mode & 0o077) !== 0)))
      || ((!leaf || !kind.file) && !stat.isDirectory())) throw new CustodyError("unsafe-installation");
    if (stat.isDirectory()) parents.push({ path: candidate, identity: directoryIdentity(candidate) });
    if (candidate === parse(candidate).root) break;
    candidate = dirname(candidate);
    leaf = false;
  }
  return parents;
}

export function readInstalledFile(path: string, maxBytes: number): { bytes: Buffer; identity: string } {
  const fd = openSync(path, constants.O_RDONLY | (process.platform === "linux" ? constants.O_NOFOLLOW : 0));
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) throw new CustodyError("unsafe-installation");
    if (before.size > BigInt(maxBytes)) throw new CustodyError("input-oversize");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = readSync(fd, bytes, total, bytes.length - total, null);
      if (count === 0) break;
      total += count;
    }
    const identity = snapshotIdentity(before);
    const after = fstatSync(fd, { bigint: true });
    if (total !== Number(before.size) || snapshotIdentity(after) !== identity || fileIdentity(path) !== identity) {
      throw new CustodyError("snapshot-stale");
    }
    return { bytes: bytes.subarray(0, total), identity };
  } finally {
    closeSync(fd);
  }
}

export function fileIdentity(path: string): string {
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1n) throw new CustodyError("unsafe-installation");
  return snapshotIdentity(stat);
}

function snapshotIdentity(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.ctimeNs}:${stat.size}`;
}

export function directoryIdentity(path: string): string {
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new CustodyError("unsafe-installation");
  return `${stat.dev}:${stat.ino}`;
}

/** Hash and identity come from the same opened object; a later lstat must never legitimize replacement bytes. */
export function digestInstalledFile(path: string): { sha256: string; identity: string } {
  const fd = openSync(path, constants.O_RDONLY | (process.platform === "linux" ? constants.O_NOFOLLOW : 0));
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) throw new CustodyError("unsafe-installation");
    if (before.size > BigInt(MAX_ARTIFACT_BYTES)) throw new CustodyError("input-oversize");
    const digest = createHash("sha256");
    const chunk = Buffer.alloc(65_536);
    let total = 0;
    let count: number;
    while ((count = readSync(fd, chunk, 0, chunk.length, null)) !== 0) {
      total += count;
      if (total > MAX_ARTIFACT_BYTES) throw new CustodyError("input-oversize");
      digest.update(chunk.subarray(0, count));
    }
    const identity = snapshotIdentity(before);
    if (BigInt(total) !== before.size || snapshotIdentity(fstatSync(fd, { bigint: true })) !== identity || fileIdentity(path) !== identity) {
      throw new CustodyError("snapshot-stale");
    }
    return { sha256: digest.digest("hex"), identity };
  } finally {
    closeSync(fd);
  }
}

export function fileDigest(path: string): string { return digestInstalledFile(path).sha256; }
