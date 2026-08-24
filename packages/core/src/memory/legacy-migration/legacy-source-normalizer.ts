/**
 * INPUT:  exact legacy Markdown bytes plus a canonical entries/ or blocks/ snapshot-relative path
 * OUTPUT: validated normalized entry/Block with raw evidence, or one closed exceptional diagnostic
 * POS:    core/memory/legacy-migration — strict compatibility boundary; legacy runtime codec stays unchanged
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { getBlock } from "../block-registry.ts";
import { getLayer } from "../layer-registry.ts";
import { isSafeSegment } from "../naming.ts";
import { stripNoteBlock } from "../strip-note.ts";
import { contentIdentity, sourceIdentity } from "./legacy-identities.ts";
import { legacyDiagnostic, type LegacyDiagnostic } from "./legacy-diagnostics.ts";

const timestamp = z.iso.datetime({ offset: true });
const keyPattern = /^[a-z][a-z0-9_-]*$/;
const safeNumber = z.number().finite().safe();
const knownKeys = new Set(["id", "layer", "importance", "disclosure", "created", "status", "origin",
  "emotional_weight", "expires", "updated", "reinforce_count"]);
export const LEGACY_NORMALIZER_VERSION = 1;

export interface NormalizedLegacySource {
  kind: "entry" | "block"; relativePath: string; rawBytes: Uint8Array; rawText: string; rawSha256: string;
  sourceId: string; contentHash: string; content: string; characterId: string | null; layerId: string | null;
  legacyId: string; status: "active" | "archived" | null; origin: "self" | "observed" | null;
  importance: number | null; disclosure: string | null; emotionalWeight: number | null; createdAt: string | null;
  updatedAt: string | null; expiresAt: string | null; reinforceCount: number | null;
  originDefaulted: boolean;
  legacyMetadata: Record<string, string | number | boolean>; blockOrder: number | null; blockWriter: "user" | "background" | null;
}
export type NormalizeResult = { ok: true; source: NormalizedLegacySource } | { ok: false; diagnostic: LegacyDiagnostic };
type FailureResult = { ok: false; diagnostic: LegacyDiagnostic };
type DecodeResult = { ok: true; text: string } | FailureResult;
type FrontmatterResult = { ok: true; data: Record<string, string | number | boolean>; body: string } | FailureResult;
type ScalarResult = { ok: true; value: string | number | boolean } | FailureResult;
type PlacementResult = { ok: true; ownership: "global" | "per-character"; characterId: string | null; layerId: string } | FailureResult;

export function normalizeLegacySource(relativePath: string, bytes: Uint8Array): NormalizeResult {
  const decoded = decode(bytes);
  if (!decoded.ok) return decoded;
  if (!isCanonicalPath(relativePath)) return failure("PATH_OUT_OF_ROOT", "placement", "canonical-path");
  return relativePath.startsWith("entries/")
    ? normalizeEntry(relativePath, bytes, decoded.text)
    : normalizeBlock(relativePath, bytes, decoded.text);
}

function normalizeEntry(path: string, bytes: Uint8Array, text: string): NormalizeResult {
  const placement = entryPlacement(path);
  if (!placement.ok) return placement;
  const parsed = parseFlatFrontmatter(text);
  if (!parsed.ok) return parsed;
  const data = parsed.data;
  const required = ["id", "layer", "importance", "created", "status"];
  if (required.some((key) => data[key] === undefined)) return failure("MISSING_REQUIRED_FIELD", "normalize", "required-field");
  if (typeof data.id !== "string" || data.id.length === 0) return failure("INVALID_LEGACY_ID", "normalize", "id");
  const layer = typeof data.layer === "string" ? getLayer(data.layer) : undefined;
  if (!layer) return failure("UNKNOWN_LAYER", "normalize", "layer");
  if (layer.ownership !== placement.ownership) return failure("OWNERSHIP_MISMATCH", "placement", "layer-owner");
  if (placement.layerId !== layer.id) return failure("INVALID_PLACEMENT", "placement", "layer-path");
  if (data.id.length > 16_384) return failure("FIELD_BOUND_EXCEEDED", "normalize", "legacy-id");
  if (!Number.isInteger(data.importance) || Number(data.importance) < 1 || Number(data.importance) > 10) return failure("INVALID_IMPORTANCE", "normalize", "importance");
  if (data.status !== "active" && data.status !== "archived") return failure("INVALID_STATUS", "normalize", "status");
  const origin = data.origin === undefined ? "self" : data.origin;
  if (origin !== "self" && origin !== "observed") return failure("INVALID_ORIGIN", "normalize", "origin");
  const dates = validateDates(data);
  if (!dates.ok) return dates;
  if (data.reinforce_count !== undefined && (!Number.isSafeInteger(data.reinforce_count) || Number(data.reinforce_count) < 1)) return failure("INVALID_REINFORCEMENT", "normalize", "reinforce_count");
  if (data.disclosure !== undefined && typeof data.disclosure !== "string") return failure("CANONICAL_SCHEMA_MISMATCH", "normalize", "disclosure-type");
  if (typeof data.disclosure === "string" && data.disclosure.length > 512) return failure("FIELD_BOUND_EXCEEDED", "normalize", "disclosure");
  if (data.emotional_weight !== undefined && typeof data.emotional_weight !== "number") return failure("CANONICAL_SCHEMA_MISMATCH", "normalize", "emotional-weight-type");
  if (parsed.body.length > 100_000) return failure("FIELD_BOUND_EXCEEDED", "normalize", "content");
  const metadata = Object.fromEntries(Object.entries(data).filter(([key]) => !knownKeys.has(key))) as Record<string, string | number | boolean>;
  if (!validMetadata(metadata)) return failure("METADATA_BOUND_EXCEEDED", "normalize", "legacy-metadata");
  return success({ path, bytes, rawText: text, content: parsed.body, characterId: placement.characterId, fields: {
    kind: "entry", layerId: layer.id, legacyId: data.id, status: data.status, origin,
    importance: Number(data.importance), disclosure: typeof data.disclosure === "string" ? data.disclosure : null,
    emotionalWeight: typeof data.emotional_weight === "number" ? data.emotional_weight : null,
    createdAt: String(data.created), updatedAt: data.updated !== undefined ? String(data.updated) : null,
    expiresAt: data.expires !== undefined ? String(data.expires) : null,
    reinforceCount: data.reinforce_count !== undefined ? Number(data.reinforce_count) : null,
    originDefaulted: data.origin === undefined,
    legacyMetadata: metadata, blockOrder: null, blockWriter: null,
  }});
}

function normalizeBlock(path: string, bytes: Uint8Array, text: string): NormalizeResult {
  if (text.startsWith("---")) return failure("BLOCK_FRONTMATTER", "parse", "frontmatter");
  const parts = path.split("/");
  const global = parts.length === 3 && parts[1] === "global";
  const character = parts.length === 4 && parts[1] === "characters" && isSafeSegment(parts[2] ?? "");
  if (!global && !character) return failure("INVALID_PLACEMENT", "placement", "block-path");
  const filename = parts.at(-1) ?? ""; const blockId = filename.endsWith(".md") ? filename.slice(0, -3) : "";
  const block = getBlock(blockId);
  if (!block) return failure("UNKNOWN_BLOCK", "normalize", "block-id");
  const ownership = global ? "global" : "per-character";
  if (block.ownership !== ownership) return failure("BLOCK_SCOPE_MISMATCH", "placement", "block-owner");
  const content = stripNoteBlock(text);
  if (content.length > 100_000) return failure("FIELD_BOUND_EXCEEDED", "normalize", "block-content");
  return success({ path, bytes, rawText: text, content, characterId: global ? null : parts[2] ?? null, fields: {
    kind: "block", layerId: null, legacyId: block.id, status: null, origin: null, importance: null,
    disclosure: null, emotionalWeight: null, createdAt: null, updatedAt: null, expiresAt: null, reinforceCount: null,
    legacyMetadata: {}, blockOrder: Number((getBlockOrder(block.id))), blockWriter: block.writer, originDefaulted: false,
  }});
}

function parseFlatFrontmatter(text: string): FrontmatterResult {
  const lines = text.split("\n");
  if ((lines[0] ?? "").trimEnd() !== "---") return failure("INVALID_FENCE", "parse", "opening-fence");
  const close = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  if (close < 0) return failure("INVALID_FENCE", "parse", "closing-fence");
  const data: Record<string, string | number | boolean> = {};
  for (const rawLine of lines.slice(1, close)) {
    const line = rawLine.replace(/\r$/, ""); if (line.trim() === "") continue;
    const colon = line.indexOf(":"); if (colon < 0) return failure("UNSUPPORTED_YAML", "parse", "missing-colon");
    const key = line.slice(0, colon).trim(); if (!keyPattern.test(key)) return failure("INVALID_FRONTMATTER_KEY", "parse", "key");
    if (key in data) return failure("DUPLICATE_FRONTMATTER_KEY", "parse", "duplicate-key");
    const rawValue = line.slice(colon + 1).trim();
    if ("[]{}>|&*!".includes(rawValue[0] ?? "") || rawValue.startsWith("- ")) return failure("UNSUPPORTED_YAML", "parse", "flat-scalars-only");
    const scalar = parseScalar(rawValue); if (!scalar.ok) return scalar;
    data[key] = scalar.value;
  }
  return { ok: true, data, body: lines.slice(close + 1).join("\n") };
}

function parseScalar(raw: string): ScalarResult {
  if (raw.startsWith('"')) { try { const value: unknown = JSON.parse(raw); return typeof value === "string" ? { ok: true, value } : failure("UNSUPPORTED_YAML", "parse", "quoted-scalar"); } catch { return failure("UNSUPPORTED_YAML", "parse", "quoted-scalar"); } }
  if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) { const value = Number(raw); return safeNumber.safeParse(value).success ? { ok: true, value } : failure("UNSUPPORTED_YAML", "parse", "numeric-scalar"); }
  return { ok: true, value: raw };
}

function validateDates(data: Record<string, string | number | boolean>): { ok: true } | FailureResult {
  for (const key of ["created", "updated", "expires"] as const) {
    const value = data[key]; if (value === undefined) continue;
    if (typeof value !== "string" || !timestamp.safeParse(value).success) return failure("INVALID_TIMESTAMP", "normalize", key);
  }
  const created = Date.parse(String(data.created));
  if (data.updated !== undefined && Date.parse(String(data.updated)) < created) return failure("INVALID_TIMESTAMP", "normalize", "reversed-date");
  if (data.expires !== undefined && Date.parse(String(data.expires)) < created) return failure("INVALID_TIMESTAMP", "normalize", "reversed-date");
  return { ok: true };
}

function entryPlacement(path: string): PlacementResult {
  const parts = path.split("/");
  if (parts.length === 4 && parts[1] === "global" && parts[3]?.endsWith(".md")) return { ok: true, ownership: "global", characterId: null, layerId: parts[2] ?? "" };
  if (parts.length === 5 && parts[1] === "characters" && isSafeSegment(parts[2] ?? "") && parts[4]?.endsWith(".md")) return { ok: true, ownership: "per-character", characterId: parts[2] ?? null, layerId: parts[3] ?? "" };
  return failure("INVALID_PLACEMENT", "placement", "entry-path");
}

function decode(bytes: Uint8Array): DecodeResult {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return failure("UNSUPPORTED_BOM", "decode", "utf8-bom");
  try { return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }; }
  catch { return failure("INVALID_UTF8", "decode", "utf8") }
}
function isCanonicalPath(path: string): boolean { return (path.startsWith("entries/") || path.startsWith("blocks/")) && !path.includes("\\") && !path.split("/").some((part) => part === "" || part === "." || part === ".."); }
function rawHash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function validMetadata(metadata: Record<string, string | number | boolean>): boolean {
  const entries = Object.entries(metadata);
  if (entries.length > 256 || JSON.stringify(metadata).length > 16_384) return false;
  return entries.every(([key, value]) => key.length <= 128 && (typeof value !== "string" || value.length <= 16_384));
}
function getBlockOrder(id: string): number { return ["user-card", "user-model", "memory-index"].indexOf(id); }
function failure(code: Parameters<typeof legacyDiagnostic>[0], phase: Parameters<typeof legacyDiagnostic>[1], detail: string): { ok: false; diagnostic: LegacyDiagnostic } { return { ok: false, diagnostic: legacyDiagnostic(code, phase, detail) }; }
function success(input: { path: string; bytes: Uint8Array; rawText: string; content: string; characterId: string | null; fields: Omit<NormalizedLegacySource, "relativePath" | "rawBytes" | "rawText" | "rawSha256" | "sourceId" | "contentHash" | "content" | "characterId"> }): NormalizeResult {
  const content = input.content.replace(/\r\n?/g, "\n");
  const rawSha256 = rawHash(input.bytes); return { ok: true, source: { ...input.fields, relativePath: input.path, rawBytes: input.bytes, rawText: input.rawText, rawSha256, sourceId: sourceIdentity(input.path, rawSha256), contentHash: contentIdentity(content), content, characterId: input.characterId } };
}
