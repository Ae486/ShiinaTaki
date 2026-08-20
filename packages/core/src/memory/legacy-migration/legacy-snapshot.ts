/**
 * INPUT:  allow-listed Workspace memory/blocks roots and an operator-selected snapshot destination
 * OUTPUT: complete hash-addressed immutable snapshot manifest, or a private dry-run report
 * POS:    core/memory/legacy-migration — read-only evidence boundary; never rewrites legacy sources
 */
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { canonicalJson } from "./legacy-identities.ts";
import { legacyDiagnostic, type LegacyDiagnostic } from "./legacy-diagnostics.ts";

export interface SnapshotManifestEntry { kind: "entry" | "block"; relativePath: string; byteLength: number; rawSha256: string; exception: LegacyDiagnostic | null }
export interface LegacySnapshotManifest { schemaVersion: 1; normalizerVersion: 1; snapshotId: string; createdAt: string; entries: SnapshotManifestEntry[] }
export interface SnapshotResult { manifest: LegacySnapshotManifest; directory: string | null; temporary: boolean }

export function publishLegacySnapshot(input: { workspaceRoot: string; destinationRoot: string; now: string; dryRun?: boolean }): SnapshotResult {
  const manifestEntries = discover(input.workspaceRoot);
  const identityPayload = { schemaVersion: 1 as const, normalizerVersion: 1 as const, entries: manifestEntries };
  const snapshotId = `sha256:${createHash("sha256").update(canonicalJson(identityPayload)).digest("hex")}`;
  const manifest: LegacySnapshotManifest = { ...identityPayload, createdAt: input.now, snapshotId };
  if (input.dryRun) return { manifest, directory: null, temporary: true };
  const destinationRoot = resolve(input.destinationRoot);
  mkdirSync(destinationRoot, { recursive: true });
  const target = join(destinationRoot, snapshotId.replace(":", "-"));
  if (existsSync(target)) return { manifest: readManifest(target), directory: target, temporary: false };
  const totalBytes = manifestEntries.reduce((sum, entry) => sum + entry.byteLength, 0);
  assertFreeSpace(destinationRoot, totalBytes + canonicalJson(manifest).length);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(temporary, { recursive: true });
  try {
    for (const item of manifestEntries) {
      if (item.exception) continue;
      const source = join(input.workspaceRoot, item.kind === "entry" ? "memory" : "blocks", item.relativePath.split("/").slice(1).join("/"));
      const destination = join(temporary, item.relativePath);
      mkdirSync(dirname(destination), { recursive: true }); copyFileSync(source, destination);
      const copied = readFileSync(destination); const hash = sha256(copied);
      if (copied.byteLength !== item.byteLength || hash !== item.rawSha256) throw new Error("SNAPSHOT_CHANGED");
      syncFile(destination);
    }
    writeFileSync(join(temporary, "manifest.json"), `${canonicalJson(manifest)}\n`, "utf8");
    syncFile(join(temporary, "manifest.json"));
    renameSync(temporary, target);
    return { manifest, directory: target, temporary: false };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true }); throw error;
  }
}

function discover(workspaceRoot: string): SnapshotManifestEntry[] {
  const rows: SnapshotManifestEntry[] = [];
  walk({ root: join(workspaceRoot, "memory"), kind: "entry", prefix: "entries", output: rows });
  walk({ root: join(workspaceRoot, "blocks"), kind: "block", prefix: "blocks", output: rows });
  return rows.sort((left, right) => Buffer.from(left.relativePath).compare(Buffer.from(right.relativePath)));
}

function walk(input: { root: string; kind: "entry" | "block"; prefix: string; output: SnapshotManifestEntry[]; base?: string }): void {
  const { root, kind, prefix, output, base = input.root } = input;
  if (!existsSync(root)) return;
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, item.name);
    const relativePath = `${prefix}/${relative(base, full).replaceAll("\\", "/")}`;
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) {
      output.push({ kind, relativePath, byteLength: 0, rawSha256: "0".repeat(64), exception: legacyDiagnostic("REPARSE_POINT", "discovery", "link") });
    } else if (stat.isDirectory()) walk({ root: full, kind, prefix, output, base });
    else if (item.name.endsWith(".md")) {
      const bytes = readFileSync(full); output.push({ kind, relativePath, byteLength: bytes.byteLength, rawSha256: sha256(bytes), exception: null });
    }
  }
}

function readManifest(directory: string): LegacySnapshotManifest {
  const parsed = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")) as LegacySnapshotManifest;
  if (parsed.schemaVersion !== 1 || parsed.normalizerVersion !== 1 || !parsed.snapshotId) throw new Error("INTEGRITY_MISMATCH");
  return parsed;
}
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function syncFile(path: string): void {
  const handle = openSync(path, "r");
  try { try { fsyncSync(handle); } catch { /* Windows and some filesystems do not support fsync on read handles. */ } }
  finally { closeSync(handle); }
}
function assertFreeSpace(root: string, required: number): void {
  const stats = statfsSync(root); const available = Number(stats.bavail) * Number(stats.bsize);
  if (Number.isFinite(available) && available < required) throw new Error("INTEGRITY_MISMATCH");
}
