/**
 * INPUT:  normalized legacy entry/Block, prepared canonical epoch, and deterministic Bank identity
 * OUTPUT: validated canonical source/unit/policy records or a sanitized zero-result/diagnostic outcome
 * POS:    core/memory/legacy-migration — migration-only projection; never calls ordinary Local retain
 */
import { CanonicalMemoryRecordSchema, CanonicalMemorySourceSchema, CanonicalMemoryUnitSchema, TakiMemoryPolicyProjectionSchema, type CanonicalMemoryRecord, type CanonicalMemorySource, type TakiMemoryPolicyProjection } from "@taki/shared";
import { DEFAULT_INTENTIONS_DAYS } from "../../config/memory-config.ts";
import { getLayer } from "../layer-registry.ts";
import { sanitizeLegacyRetainText } from "./legacy-retain-sanitizer.ts";
import { memoryIdentity, operationIdentity, canonicalPayloadHash, documentIdentity } from "./legacy-identities.ts";
import type { NormalizedLegacySource } from "./legacy-source-normalizer.ts";
import type { LegacyDiagnostic } from "./legacy-diagnostics.ts";

export type CanonicalConversion =
  | { ok: true; kind: "record"; source: CanonicalMemorySource; record: CanonicalMemoryRecord; operationId: string; payloadHash: string }
  | { ok: true; kind: "zero"; source: CanonicalMemorySource; operationId: string; payloadHash: string }
  | { ok: false; diagnostic: LegacyDiagnostic };

export function convertLegacyEntry(input: { source: NormalizedLegacySource; epochId: string; bankId: string; intentionsDefaultDays?: number }): CanonicalConversion {
  if (input.source.kind !== "entry") throw new Error("CANONICAL_SCHEMA_MISMATCH");
  const sanitized = sanitizeLegacyRetainText(input.source.content);
  if (!sanitized.ok) return sanitized;
  const layer = getLayer(input.source.layerId ?? "");
  if (!layer || !input.source.createdAt) return { ok: false, diagnostic: { code: "CANONICAL_SCHEMA_MISMATCH", phase: "normalize", detail: "layer-or-created", line: null, column: null } };
  const documentId = documentIdentity(input.bankId, input.source.sourceId);
  const operationId = operationIdentity(input.bankId, documentId, input.source.rawSha256);
  const updatedAt = input.source.updatedAt ?? input.source.createdAt;
  const source = CanonicalMemorySourceSchema.parse({
    authorityEpochId: input.epochId, bankId: input.bankId, documentId, contentHash: input.source.contentHash,
    retainedText: sanitized.text, context: null, tags: [`taki-layer:${layer.id}`],
    metadata: {
      legacyId: input.source.legacyId,
      legacyMetadata: input.source.legacyMetadata,
      rawSha256: input.source.rawSha256,
      normalizerVersion: 1,
      sanitizerVersion: sanitized.version,
      status: input.source.status,
      compatibilityOriginDefaulted: input.source.originDefaulted,
    },
    observationScopes: null,
    provenance: { actor: "system", origin: "legacy-import", characterId: input.source.characterId, timelineFromSeq: null, timelineToSeq: null, capturedAt: input.source.createdAt, sanitized: true, sourceRef: `legacy-source:${input.source.sourceId}` },
    revision: 1, createdAt: input.source.createdAt, updatedAt,
  });
  if (sanitized.text.length === 0) return { ok: true, kind: "zero", source, operationId, payloadHash: canonicalPayloadHash(source) };
  const state = input.source.status === "archived" ? "invalidated" : "valid";
  const invalidatedAt = state === "invalidated" ? updatedAt : null;
  const unit = CanonicalMemoryUnitSchema.parse({
    authorityEpochId: input.epochId, bankId: input.bankId, memoryId: memoryIdentity({ bankId: input.bankId, documentId, ordinal: 0, payloadHash: canonicalPayloadHash({ text: sanitized.text, sourceId: input.source.sourceId }) }), documentId, chunkId: null,
    text: sanitized.text, context: null, factType: "experience", state, revision: 1, tags: [`taki-layer:${layer.id}`],
    metadata: { legacyId: input.source.legacyId }, entities: [], sourceMemoryIds: [], observationScopes: null,
    eventDate: input.source.createdAt, occurredStart: null, occurredEnd: null, mentionedAt: input.source.createdAt,
    createdAt: input.source.createdAt, updatedAt, editedAt: null, consolidatedAt: null, consolidationFailedAt: null,
    invalidationReason: state === "invalidated" ? "legacy-archived" : null, invalidatedAt,
    proofCount: Math.max(1, input.source.reinforceCount ?? 1),
  });
  const policy = TakiMemoryPolicyProjectionSchema.parse({ authorityEpochId: input.epochId, bankId: input.bankId, memoryId: unit.memoryId, layerId: layer.id, importance: input.source.importance ?? 1, visibility: layer.recallPolicy, disclosure: input.source.disclosure, origin: input.source.origin ?? "self", emotionalWeight: input.source.emotionalWeight, retention: retentionProjection({ retention: layer.retention, source: input.source, recencyAt: updatedAt, intentionsDefaultDays: input.intentionsDefaultDays ?? DEFAULT_INTENTIONS_DAYS }), policyVersion: 1, updatedAt });
  const record = CanonicalMemoryRecordSchema.parse({ unit, policy, provenance: source.provenance });
  return { ok: true, kind: "record", source, record, operationId, payloadHash: canonicalPayloadHash(record) };
}

function retentionProjection(input: { retention: ReturnType<typeof getLayer> extends infer T ? T extends { retention: infer R } ? R : never : never; source: NormalizedLegacySource; recencyAt: string; intentionsDefaultDays: number }): TakiMemoryPolicyProjection["retention"] {
  const { retention, source, recencyAt, intentionsDefaultDays } = input;
  if (retention === "permanent") return { kind: "permanent" };
  if (retention === "expiring") return { kind: "expiring", expiresAt: source.expiresAt ?? new Date(Date.parse(recencyAt) + intentionsDefaultDays * 86_400_000).toISOString() };
  if (typeof retention === "object" && "rollingDays" in retention) return { kind: "rolling-window", days: retention.rollingDays };
  if (typeof retention === "object") return { kind: "importance-decay", archiveBelowImportance: retention.archiveBelowImportance, afterDays: retention.afterDays };
  return { kind: "permanent" };
}

export interface LegacyBlockProjection { blockId: string; scopeKind: "global" | "character"; characterId: string | null; content: string; revision: 1; updatedAt: string }
export function convertLegacyBlock(source: NormalizedLegacySource, now: string): LegacyBlockProjection | null {
  if (source.kind !== "block" || source.content.length === 0 || source.blockWriter === null) return null;
  return { blockId: source.legacyId, scopeKind: source.characterId === null ? "global" : "character", characterId: source.characterId, content: source.content, revision: 1, updatedAt: now };
}
