/**
 * INPUT: normalized Skill files and Core-owned skill-packages store root
 * OUTPUT: validated immutable package content, deterministic hash, and bounded metadata/findings
 * POS:    core/skills content plane; publication is content-addressed and never mutates a live generation
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync, type Stats } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import YAML from "yaml";
import { safePackagePath } from "../archive/member-path.ts";
import { SKILL_COMPATIBILITY_MAX_LENGTH, SKILL_DESCRIPTION_MAX_LENGTH, SKILL_FILE_COUNT_MAX, SKILL_FILE_MAX_BYTES, SKILL_MD_MAX_BYTES, SKILL_NAME_MAX_LENGTH, SKILL_NAME_PATTERN, SKILL_TOTAL_MAX_BYTES, SkillStandardMetadataSchema } from "@taki/shared";
import type { SkillStandardMetadata } from "@taki/shared";
import type { SkillContentFile, SkillPackageContent } from "./skill-package-types.ts";

export class SkillValidationError extends Error { readonly reason: "invalid-package" | "unsafe-package"; constructor(reason: "invalid-package" | "unsafe-package", message = "Skill package is invalid") { super(message); this.name = "SkillValidationError"; this.reason = reason; } }
export interface ValidatedSkill { skillName: string; description: string; metadata: SkillStandardMetadata; files: SkillContentFile[]; hash: string; findings: { code: "executable-looking-file" | "scripts-directory" | "unknown-file"; path: string }[]; }
export interface SkillValidationOptions { expectedRootName?: string; requireWrapperRoot?: boolean; }
export function validateSkillFiles(files: SkillContentFile[], options: SkillValidationOptions = {}): ValidatedSkill {
  const packageView = stripCommonRoot(files); const normalized = packageView.files; const skill = normalized.find((file) => file.path === "SKILL.md");
  if (!skill || skill.bytes.length > SKILL_MD_MAX_BYTES) throw new SkillValidationError("invalid-package", "SKILL.md is required");
  const text = skill.bytes.toString("utf8"); if (Buffer.from(text, "utf8").compare(skill.bytes) !== 0) throw new SkillValidationError("invalid-package");
  const frontmatter = parseSkillDocument(text).data; const name = frontmatter.name; const description = frontmatter.description;
  if (typeof name !== "string" || name.length > SKILL_NAME_MAX_LENGTH || !SKILL_NAME_PATTERN.test(name)) throw new SkillValidationError("invalid-package", "Skill name is invalid");
  if (options.requireWrapperRoot && packageView.wrapperRoot === null) throw new SkillValidationError("invalid-package", "Skill package directory is required");
  if (packageView.wrapperRoot !== null && packageView.wrapperRoot !== name) throw new SkillValidationError("invalid-package", "Skill name and parent directory do not match");
  if (options.expectedRootName !== undefined && options.expectedRootName !== name) throw new SkillValidationError("invalid-package", "Skill name and parent directory do not match");
  if (typeof description !== "string" || description.length < 1 || description.length > SKILL_DESCRIPTION_MAX_LENGTH) throw new SkillValidationError("invalid-package", "Skill description is required");
  validateOptionalMetadata(frontmatter);
  const findings: ValidatedSkill["findings"] = [];
  for (const file of normalized) {
    if (/(^|\/)scripts\//u.test(file.path)) findings.push({ code: "scripts-directory", path: file.path });
    else if (/\.(exe|cmd|bat|ps1|sh)$/iu.test(file.path)) findings.push({ code: "executable-looking-file", path: file.path });
  }
  return { skillName: name, description, metadata: standardMetadata(frontmatter, name, description), files: normalized, hash: hashSkillFiles(normalized), findings };
}
export function publishSkill(root: string, packageId: string, validated: ValidatedSkill): SkillPackageContent {
  const destination = join(root, "published", validated.skillName, validated.hash.slice("sha256.".length));
  if (existsSync(destination)) {
    const existing = readPublishedContent({ storeRoot: root, packageId, skillName: validated.skillName, description: validated.description, hash: validated.hash });
    const expected = validated.files.map((file) => file.path).sort();
    if (!existing || existing.files.length !== expected.length || existing.files.some((path, index) => path !== expected[index])) throw new SkillValidationError("unsafe-package", "Published package content does not match its hash");
  } else {
    const staging = join(root, "staging", randomUUID()); mkdirSync(staging, { recursive: true });
    for (const file of validated.files) { const target = join(staging, ...file.path.split("/")); mkdirSync(join(target, ".."), { recursive: true }); writeFileSync(target, file.bytes, { flag: "wx" }); }
    mkdirSync(join(root, "published", validated.skillName), { recursive: true }); renameSync(staging, destination);
  }
  return { packageId, skillName: validated.skillName, description: validated.description, hash: validated.hash, root: destination, files: validated.files.map((file) => file.path).sort() };
}
export function readPublishedHash(content: SkillPackageContent): boolean { const snapshot = readPublishedSnapshot(content.root); return snapshot !== null && samePaths(snapshot, content.files) && hashSkillFiles(snapshot) === content.hash; }
export function readPublishedContent(input: { storeRoot: string; packageId: string; skillName: string; description: string; hash: string }): SkillPackageContent | null {
  const destination = join(input.storeRoot, "published", input.skillName, input.hash.slice("sha256.".length));
  const files = readPublishedSnapshot(destination);
  if (!files) return null;
  if (files.length === 0 || hashSkillFiles(files) !== input.hash) return null;
  return { packageId: input.packageId, skillName: input.skillName, description: input.description, hash: input.hash, root: destination, files: files.map((file) => file.path).sort() };
}
export function readPublishedFile(input: { storeRoot: string; packageId: string; skillName: string; description: string; hash: string }, path: string): { content: SkillPackageContent; bytes: Buffer } | null {
  const destination = join(input.storeRoot, "published", input.skillName, input.hash.slice("sha256.".length)); const files = readPublishedSnapshot(destination);
  if (!files || files.length === 0 || hashSkillFiles(files) !== input.hash) return null;
  const file = files.find((candidate) => candidate.path === path); if (!file) return null;
  return { content: { packageId: input.packageId, skillName: input.skillName, description: input.description, hash: input.hash, root: destination, files: files.map((candidate) => candidate.path).sort() }, bytes: file.bytes };
}
export function quarantine(root: string, packageId: string, files: SkillContentFile[]): void { const target = join(root, "quarantine", packageId); mkdirSync(target, { recursive: true }); for (const file of files) { const path = join(target, ...file.path.split("/")); mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, file.bytes); } }
export function listPublishedRoots(root: string): string[] { const result: string[] = []; for (const name of safeDirs(join(root, "published"))) for (const hash of safeDirs(join(root, "published", name))) result.push(join(root, "published", name, hash)); return result; }
export function collectPackageStoreGarbage(root: string, preserveRoots: Set<string>, preserveQuarantineIds: ReadonlySet<string>): void { for (const staging of safeDirs(join(root, "staging"))) safeRemove(join(root, "staging", staging)); for (const published of listPublishedRoots(root)) if (!preserveRoots.has(published)) safeRemove(published); for (const packageId of safeDirs(join(root, "quarantine"))) if (!preserveQuarantineIds.has(packageId)) safeRemove(join(root, "quarantine", packageId)); }
function safeDirs(root: string): string[] { try { return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name); } catch { return []; } }
function safeRemove(path: string): void { try { rmSync(path, { recursive: true, force: true }); } catch { /* best-effort crash-leftover collection */ } }
function readPublishedSnapshot(destination: string): SkillContentFile[] | null {
  try {
    const initial = lstatSync(destination); if (!initial.isDirectory() || initial.isSymbolicLink()) throw new SkillValidationError("unsafe-package");
    const root = realpathSync(destination); const confirmed = lstatSync(destination);
    if (!confirmed.isDirectory() || confirmed.isSymbolicLink() || !sameIdentity(initial, confirmed)) throw new SkillValidationError("unsafe-package");
    const files = walkPublished({ root, current: root, state: { count: 0, total: 0 }, beforeDirectory: confirmed }); const final = lstatSync(destination);
    if (!final.isDirectory() || final.isSymbolicLink() || !sameIdentity(initial, final) || realpathSync(destination) !== root) throw new SkillValidationError("unsafe-package");
    return files;
  } catch { return null; }
}
function walkPublished(input: { root: string; current: string; state: { count: number; total: number }; beforeDirectory: Stats }): SkillContentFile[] {
  const { root, current, state, beforeDirectory } = input;
  const entries = readdirSync(current, { withFileTypes: true }); const names = entries.map((entry) => entry.name).sort(); const result: SkillContentFile[] = [];
  for (const entry of entries) {
    const absolute = join(current, entry.name); const before = lstatSync(absolute);
    if (entry.isSymbolicLink() || before.isSymbolicLink()) throw new SkillValidationError("unsafe-package");
    const resolved = realpathSync(absolute); if (!isConfined(root, resolved)) throw new SkillValidationError("unsafe-package");
    const confirmed = lstatSync(absolute); if (!sameIdentity(before, confirmed)) throw new SkillValidationError("unsafe-package");
    if (before.isDirectory() && entry.isDirectory()) result.push(...walkPublished({ root, current: resolved, state, beforeDirectory: confirmed }));
    else if (before.isFile() && entry.isFile()) result.push(readPublishedRegularFile({ root, absolute, resolved, before, state }));
    else throw new SkillValidationError("unsafe-package");
  }
  const afterEntries = readdirSync(current, { withFileTypes: true }); const afterNames = afterEntries.map((entry) => entry.name).sort();
  if (afterNames.length !== names.length || afterNames.some((name, index) => name !== names[index])) throw new SkillValidationError("unsafe-package");
  const afterDirectory = lstatSync(current); if (!sameIdentity(beforeDirectory, afterDirectory) || afterDirectory.isSymbolicLink() || realpathSync(current) !== current) throw new SkillValidationError("unsafe-package");
  return result;
}
function readPublishedRegularFile(input: { root: string; absolute: string; resolved: string; before: Stats; state: { count: number; total: number } }): SkillContentFile {
  const { root, absolute, resolved, before, state } = input;
  const path = relative(root, resolved).replaceAll("\\", "/"); const limit = path === "SKILL.md" ? SKILL_MD_MAX_BYTES : SKILL_FILE_MAX_BYTES;
  if (safePackagePath(path) !== path || before.nlink > 1 || before.size > limit) throw new SkillValidationError("unsafe-package");
  state.count += 1; state.total += before.size; if (state.count > SKILL_FILE_COUNT_MAX || state.total > SKILL_TOTAL_MAX_BYTES) throw new SkillValidationError("unsafe-package");
  const handle = openSync(absolute, "r");
  try {
    const opened = fstatSync(handle); if (!opened.isFile() || opened.nlink > 1 || !sameIdentity(before, opened) || realpathSync(absolute) !== resolved) throw new SkillValidationError("unsafe-package");
    const bytes = Buffer.alloc(opened.size); let offset = 0;
    while (offset < bytes.length) { const count = readSync(handle, bytes, offset, bytes.length - offset, offset); if (count === 0) throw new SkillValidationError("unsafe-package"); offset += count; }
    const after = fstatSync(handle); const final = lstatSync(absolute);
    if (!sameIdentity(opened, after) || !sameIdentity(opened, final) || final.isSymbolicLink() || realpathSync(absolute) !== resolved) throw new SkillValidationError("unsafe-package");
    return { path, bytes };
  } finally { closeSync(handle); }
}
function sameIdentity(left: Stats, right: Stats): boolean { return left.dev === right.dev && left.ino === right.ino && left.size === right.size; }
function isConfined(root: string, candidate: string): boolean { const path = relative(root, candidate); return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..\\`) && !path.startsWith("../")); }
function samePaths(files: SkillContentFile[], paths: readonly string[]): boolean { const actual = files.map((file) => file.path).sort(); const expected = [...paths].sort(); return actual.length === expected.length && actual.every((path, index) => path === expected[index]); }
function stripCommonRoot(files: SkillContentFile[]): { files: SkillContentFile[]; wrapperRoot: string | null } {
  const roots = new Set(files.map((file) => file.path.split("/")[0]));
  if (files.some((file) => file.path === "SKILL.md")) return { files, wrapperRoot: null };
  if (roots.size !== 1) throw new SkillValidationError("invalid-package", "Skill package must have one root");
  const root = [...roots][0] as string;
  if (!root || root === "SKILL.md") throw new SkillValidationError("invalid-package", "Skill package root is invalid");
  const normalized = files.map((file) => ({ ...file, path: file.path.slice(root.length + 1) }));
  if (normalized.some((file) => safePackagePath(file.path) === null)) throw new SkillValidationError("unsafe-package", "Skill package path is unsafe");
  return { files: normalized, wrapperRoot: root };
}
export function parseSkillDocument(text: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text); if (!match) throw new SkillValidationError("invalid-package");
  let data: unknown;
  try {
    const parsed = YAML.parseDocument(match[1] ?? "", { uniqueKeys: true, schema: "core" });
    if (parsed.errors.length > 0) throw new Error();
    data = parsed.toJS({ maxAliasCount: 0 });
  } catch { throw new SkillValidationError("invalid-package"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new SkillValidationError("invalid-package");
  return { data: data as Record<string, unknown>, body: text.slice(match[0].length) };
}
export function parseSkillMetadata(text: string): SkillStandardMetadata {
  const { data } = parseSkillDocument(text); const name = data.name; const description = data.description;
  if (typeof name !== "string" || typeof description !== "string") throw new SkillValidationError("invalid-package");
  return SkillStandardMetadataSchema.parse(standardMetadata(data, name, description));
}
function standardMetadata(data: Record<string, unknown>, name: string, description: string): SkillStandardMetadata {
  const metadata: Record<string, string> = {};
  if (data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)) for (const [key, value] of Object.entries(data.metadata)) if (typeof value === "string") metadata[key] = value;
  return { name, description, ...(typeof data.license === "string" ? { license: data.license } : {}), ...(typeof data.compatibility === "string" ? { compatibility: data.compatibility } : {}), ...(Object.keys(metadata).length > 0 ? { metadata } : {}), ...(typeof data["allowed-tools"] === "string" ? { "allowed-tools": data["allowed-tools"] } : {}) };
}
function validateOptionalMetadata(data: Record<string, unknown>): void {
  for (const key of ["license", "allowed-tools"] as const) {
    if (data[key] !== undefined && typeof data[key] !== "string") throw new SkillValidationError("invalid-package", `Skill ${key} is invalid`);
  }
  if (data.compatibility !== undefined && (typeof data.compatibility !== "string" || data.compatibility.length < 1 || data.compatibility.length > SKILL_COMPATIBILITY_MAX_LENGTH)) throw new SkillValidationError("invalid-package", "Skill compatibility is invalid");
  if (data.metadata !== undefined) {
    if (!data.metadata || typeof data.metadata !== "object" || Array.isArray(data.metadata)) throw new SkillValidationError("invalid-package", "Skill metadata is invalid");
    for (const value of Object.values(data.metadata)) if (typeof value !== "string") throw new SkillValidationError("invalid-package", "Skill metadata is invalid");
  }
}
export function hashSkillFiles(files: SkillContentFile[]): string { const hash = createHash("sha256"); for (const file of [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path, "utf8"), Buffer.from(b.path, "utf8")))) { const path = Buffer.from(file.path, "utf8"); const len = Buffer.alloc(8); len.writeBigUInt64BE(BigInt(path.length)); hash.update(len).update(path); len.writeBigUInt64BE(BigInt(file.bytes.length)); hash.update(len).update(file.bytes); } return `sha256.${hash.digest("hex")}`; }
