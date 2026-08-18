/**
 * INPUT: durable Skill rows and immutable published package roots
 * OUTPUT: prepared, atomically published catalog generations with leased reads and independent GC
 * POS:    core/skills runtime plane; all filesystem verification precedes mutation-time publication
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { safePackagePath } from "../archive/member-path.ts";
import { SKILL_RESOURCE_MAX_BYTES } from "@taki/shared";
import type { SkillPackageRow } from "./skill-package-types.ts";
import { collectPackageStoreGarbage, parseSkillDocument, readPublishedContent, readPublishedFile } from "./skill-package-store.ts";

export interface SkillCatalogEntry {
  readonly row: Readonly<SkillPackageRow>;
  readonly root: string;
  readonly files: readonly string[];
}
export interface SkillReadResult { content: string; contentRevision: string; files: string[]; }
export interface SkillCatalogCandidate {
  readonly rows: readonly SkillPackageRow[];
  readonly verified: readonly SkillCatalogEntry[];
  readonly invalidated: readonly string[];
}
export interface SkillCatalogManager {
  currentGeneration(): number;
  list(): SkillCatalogEntry[];
  acquire(name: string): { entry: SkillCatalogEntry; generation: number; release(): void } | undefined;
  prepare(rows: SkillPackageRow[]): SkillCatalogCandidate;
  publish(candidate: SkillCatalogCandidate, rows?: SkillPackageRow[]): { generation: number; invalidated: string[] };
  collectGarbage(): void;
  reconcile(rows: SkillPackageRow[]): { generation: number; invalidated: string[] };
  load(name: string): SkillReadResult | { ok: false; code: "NOT_FOUND" | "DISABLED" | "INVALID"; message: string };
  readResource(name: string, path: string): { ok: true; content: string; contentRevision: string } | { ok: false; code: string; message: string };
  describe(name: string): { name: string; contentRevision: string } | undefined;
  close(): void;
}

interface Generation { id: number; entries: Map<string, SkillCatalogEntry>; leases: number; retired: boolean; }

// Catalog construction intentionally keeps generation and lease state inside one closure so publication cannot leak
// a mutable registry seam. Its length is audited here rather than split across stateful helper objects.
// eslint-disable-next-line max-lines-per-function
export function createSkillCatalogManager(deps: { root: string }): SkillCatalogManager {
  let nextGeneration = 0; let closed = false;
  let current: Generation = { id: 0, entries: new Map(), leases: 0, retired: false };
  const retired = new Set<Generation>(); let durableRoots = new Set<string>(); let durablePackageIds = new Set<string>();

  function prepare(rows: SkillPackageRow[]): SkillCatalogCandidate {
    if (closed) throw new Error("Skill catalog is closed");
    const verified: SkillCatalogEntry[] = []; const invalidated: string[] = [];
    for (const row of rows) {
      if (row.lifecycleState !== "active" || !row.skillName || !row.contentHash) continue;
      const content = readPublishedContent({ storeRoot: deps.root, packageId: row.packageId, skillName: row.skillName, description: row.description ?? "", hash: row.contentHash });
      if (!content || !content.files.includes("SKILL.md")) { invalidated.push(row.packageId); continue; }
      verified.push(freezeEntry(row, content.root, content.files));
    }
    return Object.freeze({ rows: Object.freeze([...rows]), verified: Object.freeze(verified), invalidated: Object.freeze(invalidated) });
  }

  function publish(candidate: SkillCatalogCandidate, rows = [...candidate.rows]): { generation: number; invalidated: string[] } {
    if (closed) throw new Error("Skill catalog is closed");
    const verified = new Map(candidate.verified.map((entry) => [entry.row.packageId, entry])); const entries = new Map<string, SkillCatalogEntry>();
    durableRoots = durableRootSet(deps.root, rows);
    durablePackageIds = new Set(rows.map((row) => row.packageId));
    for (const row of rows) {
      if (row.lifecycleState !== "active" || !row.enabled || !row.skillName || !row.contentHash) continue;
      const content = verified.get(row.packageId);
      if (!content || content.row.contentHash !== row.contentHash || content.row.skillName !== row.skillName) continue;
      entries.set(row.skillName, freezeEntry(row, content.root, content.files));
    }
    const old = current; current = { id: ++nextGeneration, entries, leases: 0, retired: false };
    old.retired = true; if (old.id > 0) retired.add(old);
    return { generation: current.id, invalidated: [...candidate.invalidated] };
  }

  function collect(generation: Generation): void {
    if (!generation.retired || generation.leases > 0) return;
    retired.delete(generation);
    for (const entry of generation.entries.values()) {
      if (hasOtherRoot(generation, entry.root) || durableRoots.has(entry.root)) continue;
      try { rmSync(entry.root, { recursive: true, force: true }); } catch { /* best-effort content GC */ }
    }
  }

  function collectGarbage(): void {
    for (const generation of [...retired]) collect(generation);
    const preserve = new Set(durableRoots);
    for (const generation of [current, ...retired]) for (const entry of generation.entries.values()) preserve.add(entry.root);
    collectPackageStoreGarbage(deps.root, preserve, durablePackageIds);
  }

  function hasOtherRoot(owner: Generation, root: string): boolean {
    return [current, ...retired].some((generation) => generation !== owner && [...generation.entries.values()].some((entry) => entry.root === root));
  }

  function acquire(name: string) {
    if (closed) return undefined;
    const generation = current; const entry = generation.entries.get(name); if (!entry) return undefined;
    generation.leases += 1; let released = false;
    return { entry, generation: generation.id, release() { if (released) return; released = true; generation.leases -= 1; collect(generation); } };
  }

  function withEntry<T>(name: string, run: (entry: SkillCatalogEntry) => T): T | undefined {
    const lease = acquire(name); if (!lease) return undefined;
    try { return run(lease.entry); } finally { lease.release(); }
  }

  return {
    currentGeneration: () => current.id,
    list: () => [...current.entries.values()],
    acquire,
    prepare,
    publish,
    collectGarbage,
    reconcile(rows) { const candidate = prepare(rows); const result = publish(candidate, rows); collectGarbage(); return result; },
    load(name) {
      const result = withEntry(name, (entry) => {
        try {
          const verified = readEntryFile(entry, "SKILL.md"); if (!verified) return { ok: false as const, code: "INVALID" as const, message: "skill instructions are unavailable" };
          const raw = verified; const text = raw.toString("utf8");
          if (Buffer.from(text, "utf8").compare(raw) !== 0) return { ok: false as const, code: "INVALID" as const, message: "skill instructions are not valid UTF-8" };
          return { content: parseSkillDocument(text).body, contentRevision: entry.row.contentHash ?? "", files: entry.files.filter((path) => path !== "SKILL.md") };
        } catch { return { ok: false as const, code: "INVALID" as const, message: "skill instructions are unavailable" }; }
      });
      return result ?? { ok: false as const, code: "NOT_FOUND" as const, message: `no enabled skill named '${name}'` };
    },
    readResource(name, path) {
      if (path === "SKILL.md" || safePackagePath(path) !== path) return { ok: false, code: "INVALID", message: "skill resource path is invalid" };
      const result = withEntry(name, (entry) => {
        if (!entry.files.includes(path)) return { ok: false as const, code: "NOT_FOUND", message: "skill resource was not found" };
        try {
          const raw = readEntryFile(entry, path); if (!raw || raw.length > SKILL_RESOURCE_MAX_BYTES) return { ok: false as const, code: "INVALID", message: "skill resource is unavailable" };
          const content = raw.toString("utf8");
          if (Buffer.from(content, "utf8").compare(raw) !== 0 || hasBinaryControls(content)) return { ok: false as const, code: "INVALID", message: "skill resource is not valid UTF-8 text" };
          return { ok: true as const, content, contentRevision: entry.row.contentHash ?? "" };
        } catch { return { ok: false as const, code: "INVALID", message: "skill resource is unavailable" }; }
      });
      return result ?? { ok: false, code: "NOT_FOUND", message: `no enabled skill named '${name}'` };
    },
    describe(name) { const entry = current.entries.get(name); return entry ? { name, contentRevision: entry.row.contentHash ?? "" } : undefined; },
    close() { if (closed) return; closed = true; const closing = current; closing.retired = true; if (closing.id > 0) retired.add(closing); current = { id: closing.id, entries: new Map(), leases: 0, retired: false }; collectGarbage(); },
  };
}

function freezeEntry(row: SkillPackageRow | Readonly<SkillPackageRow>, root: string, files: readonly string[]): SkillCatalogEntry {
  const scanFindings = Object.freeze(row.scanFindings.map((finding) => Object.freeze({ ...finding })));
  const frozenRow = Object.freeze({ ...row, scanFindings }) as Readonly<SkillPackageRow>;
  return Object.freeze({ row: frozenRow, root, files: Object.freeze([...files]) });
}
function durableRootSet(root: string, rows: readonly SkillPackageRow[]): Set<string> { return new Set(rows.flatMap((row) => row.skillName && row.contentHash ? [publishedRoot(root, row.skillName, row.contentHash)] : [])); }
function readEntryFile(entry: SkillCatalogEntry, path: string): Buffer | null {
  const result = readPublishedFile({ storeRoot: join(entry.root, "..", "..", ".."), packageId: entry.row.packageId, skillName: entry.row.skillName ?? "", description: entry.row.description ?? "", hash: entry.row.contentHash ?? "" }, path);
  if (!result || result.content.files.length !== entry.files.length || result.content.files.some((file, index) => file !== entry.files[index])) return null;
  return result.bytes;
}
function publishedRoot(root: string, skillName: string, hash: string): string { return join(root, "published", skillName, hash.slice("sha256.".length)); }
function hasBinaryControls(content: string): boolean { for (const character of content) { const code = character.charCodeAt(0); if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return true; } return false; }
