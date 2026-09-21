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
import { z } from "zod";

export interface SnapshotManifestEntry { kind: "entry" | "block"; relativePath: string; byteLength: number; rawSha256: string; exception: LegacyDiagnostic | null }
export interface LegacySnapshotManifest { schemaVersion: 1; normalizerVersion: 1; snapshotId: string; createdAt: string; entries: SnapshotManifestEntry[] }
export interface SnapshotResult { manifest: LegacySnapshotManifest; directory: string | null; temporary: boolean }

export function publishLegacySnapshot(input: { workspaceRoot: string; destinationRoot: string; now: string; dryRun?: boolean }): SnapshotResult {
  const task = snapshotSteps(input);
  let next = task.next();
  while (!next.done) next = task.next();
  return next.value;
}

export async function publishLegacySnapshotCooperatively(input: { workspaceRoot: string; destinationRoot: string; now: string; dryRun?: boolean }): Promise<SnapshotResult> {
  const task = snapshotSteps(input);
  let next = task.next();
  while (!next.done) {
    await new Promise<void>((done) => setImmediate(done));
    next = task.next();
  }
  return next.value;
}

function* snapshotSteps(input: { workspaceRoot: string; destinationRoot: string; now: string; dryRun?: boolean }): Generator<void, SnapshotResult> {
  const manifestEntries: SnapshotManifestEntry[] = [];
  yield* walk({ root: join(input.workspaceRoot, "memory"), kind: "entry", prefix: "entries", output: manifestEntries });
  yield* walk({ root: join(input.workspaceRoot, "blocks"), kind: "block", prefix: "blocks", output: manifestEntries });
  manifestEntries.sort((left, right) => Buffer.from(left.relativePath).compare(Buffer.from(right.relativePath)));
  const identityPayload = { schemaVersion: 1 as const, normalizerVersion: 1 as const, entries: manifestEntries };
  const snapshotId = `sha256:${createHash("sha256").update(canonicalJson(identityPayload)).digest("hex")}`;
  const manifest: LegacySnapshotManifest = { ...identityPayload, createdAt: input.now, snapshotId };
  if (input.dryRun) return { manifest, directory: null, temporary: true };
  const destinationRoot = resolve(input.destinationRoot);
  mkdirSync(destinationRoot, { recursive: true });
  const target = join(destinationRoot, snapshotId.replace(":", "-"));
  if (existsSync(target)) return { manifest: readLegacySnapshot(target, snapshotId), directory: target, temporary: false };
  const totalBytes = manifestEntries.reduce((sum, entry) => sum + entry.byteLength, 0);
  assertFreeSpace(destinationRoot, totalBytes + canonicalJson(manifest).length);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(temporary, { recursive: true });
  try {
    for (const item of manifestEntries) {
      yield;
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

function* walk(input: { root: string; kind: "entry" | "block"; prefix: string; output: SnapshotManifestEntry[]; base?: string }): Generator<void> {
  const { root, kind, prefix, output, base = input.root } = input;
  if (!existsSync(root)) return;
  for (const item of readdirSync(root, { withFileTypes: true })) {
    yield;
    const full = join(root, item.name);
    const relativePath = `${prefix}/${relative(base, full).replaceAll("\\", "/")}`;
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) {
      output.push({ kind, relativePath, byteLength: 0, rawSha256: "0".repeat(64), exception: legacyDiagnostic("REPARSE_POINT", "discovery", "link") });
    } else if (stat.isDirectory()) yield* walk({ root: full, kind, prefix, output, base });
    else if (item.name.endsWith(".md")) {
      const bytes = readFileSync(full); output.push({ kind, relativePath, byteLength: bytes.byteLength, rawSha256: sha256(bytes), exception: null });
    }
  }
}

export function readLegacySnapshot(directory: string, expectedId: string): LegacySnapshotManifest {
  try {
    const parsed = ManifestSchema.parse(JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")));
    const { schemaVersion, normalizerVersion, entries } = parsed;
    const digest = `sha256:${sha256(Buffer.from(canonicalJson({ schemaVersion, normalizerVersion, entries })))}`;
    if (digest !== expectedId || parsed.snapshotId !== expectedId || new Set(entries.map((entry) => entry.relativePath)).size !== entries.length) {
      throw new Error("INTEGRITY_MISMATCH");
    }
    for (const entry of entries) {
      if (!entry.relativePath.startsWith(entry.kind === "entry" ? "entries/" : "blocks/")) throw new Error("INTEGRITY_MISMATCH");
      if (!entry.exception) {
        const bytes = readFileSync(join(directory, entry.relativePath));
        if (bytes.length !== entry.byteLength || sha256(bytes) !== entry.rawSha256) throw new Error("INTEGRITY_MISMATCH");
      }
    }
    return parsed;
  } catch { throw new Error("INTEGRITY_MISMATCH"); }
}
const ManifestSchema = z.strictObject({
  schemaVersion: z.literal(1), normalizerVersion: z.literal(1), snapshotId: z.string(), createdAt: z.iso.datetime({ offset: true }),
  entries: z.array(z.strictObject({ kind: z.enum(["entry", "block"]), relativePath: z.string().regex(/^(entries|blocks)\/(?!.*(?:^|\/)\.\.(?:\/|$))[^\\:]+$/),
    byteLength: z.int().nonnegative(), rawSha256: z.string().regex(/^[a-f0-9]{64}$/),
    exception: z.custom<LegacyDiagnostic>((value) => value !== null && typeof value === "object" && "code" in value && typeof value.code === "string").nullable() })),
});
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
