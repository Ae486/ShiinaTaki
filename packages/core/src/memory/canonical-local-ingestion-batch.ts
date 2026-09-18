/**
 * INPUT:  an approved original span, extracted Local facts, and current scoped canonical records
 * OUTPUT: frozen source/unit/reinforcement batches for the Local provider's internal ingestion port
 * POS:    core/memory — Local-only extraction projection; public retain continues to accept original source requests
 */
import { createHash } from "node:crypto";
import { CanonicalMemorySourceSchema, CanonicalMemoryUnitSchema, type CanonicalMemoryBank,
  type CanonicalMemoryRecord, type TakiMemoryPolicyProjection } from "@taki/shared";
import type { CanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import type { CanonicalMemoryMaintenanceRepo } from "../db/canonical-memory-maintenance-contract.ts";
import { clampAutoImportance } from "./auto-layer-policy.ts";
import { canonicalLayerRetention, requireLayerOwnership } from "./canonical-layer-policy.ts";
import { normalizeForDedupe } from "./dedupe.ts";
import { getLayer } from "./layer-registry.ts";
import { isSafeAutomaticMemoryText, retainedIngestionSource, type SanitizedCommittedSpan } from "./canonical-ingestion-source.ts";
import { AutomaticLocalFactSchema, PreparedLocalIngestionSchema, canonicalIngestionBankIdentity,
  canonicalIngestionDocumentId, type AutomaticLocalFact, type CanonicalWriteGateDecision, type PreparedLocalIngestion } from "./canonical-ingestion-plan.ts";
import type { SearchTokenizer } from "./search-tokenizer.ts";

export interface PrepareLocalIngestionInput {
  epochId: string; characterId: string; bankId: string; spanId: string;
  source: SanitizedCommittedSpan; gate: Extract<CanonicalWriteGateDecision, { decision: "keep" }>;
  facts: AutomaticLocalFact[];
}
export interface LocalIngestionBatchDeps {
  authority: CanonicalMemoryAuthorityRepo; maintenance: CanonicalMemoryMaintenanceRepo; tokenizer: SearchTokenizer;
  now: () => string; intentionsDefaultDays?: number;
}

export function prepareLocalIngestionBatch(deps: LocalIngestionBatchDeps, input: PrepareLocalIngestionInput): PreparedLocalIngestion {
  deps.authority.activeEpoch(input.epochId);
  if (input.source.characterId !== input.characterId) throw new Error("MEMORY_INVALID_REQUEST");
  const bank = deps.authority.getBank(input.epochId, input.bankId);
  if (!bank || bank.scope.kind === "character" && bank.scope.characterId !== input.characterId
    || input.gate.route !== "both" && bank.scope.kind !== input.gate.route) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  if (input.gate.route !== "both" && input.facts.some((fact) =>
    (getLayer(fact.layer)?.ownership === "global" ? "global" : "character") !== input.gate.route)) {
    throw new Error("MEMORY_INVALID_REQUEST");
  }
  const selected = input.source.messages.filter((message) => message.seq >= input.gate.fromSeq && message.seq <= input.gate.throughSeq);
  if (!selected.length || selected[0]?.seq !== input.gate.fromSeq || selected.at(-1)?.seq !== input.gate.throughSeq) {
    throw new Error("MEMORY_INVALID_REQUEST");
  }
  const now = deps.now();
  const requestId = canonicalIngestionBankIdentity(input.spanId, input.bankId);
  const source = buildSource({ input, selected, now, requestId });
  const scope = deps.maintenance.list({ epochId: input.epochId, characterId: input.characterId });
  const projected = projectFacts({ deps, input, bank, source, scope, now });
  return PreparedLocalIngestionSchema.parse({ epochId: input.epochId, characterId: input.characterId,
    bankId: input.bankId, requestId, now, source, ...projected });
}

function buildSource(input: { input: PrepareLocalIngestionInput; selected: SanitizedCommittedSpan["messages"]; now: string; requestId: string }) {
  const { input: request, selected, now, requestId } = input;
  const projection = retainedIngestionSource(selected);
  const retainedText = projection.text;
  if (selected.some((message) => !isSafeAutomaticMemoryText(message.text))) throw new Error("MEMORY_INVALID_REQUEST");
  const capturedAt = selected.at(-1)!.createdAt;
  return CanonicalMemorySourceSchema.parse({ authorityEpochId: request.epochId, bankId: request.bankId,
    documentId: canonicalIngestionDocumentId(requestId), contentHash: hash(retainedText), retainedText, context: null,
    tags: [], metadata: { "taki:conversation-source:v1": { version: 1, spanId: request.spanId,
      entries: projection.entries } },
    observationScopes: null, provenance: { actor: "agent", origin: "auto-gate", characterId: request.characterId,
      timelineFromSeq: request.gate.fromSeq, timelineToSeq: request.gate.throughSeq, capturedAt, sanitized: true,
      sourceRef: `timeline:${request.characterId}:${request.gate.fromSeq}:${request.gate.throughSeq}` },
    revision: 1, createdAt: capturedAt, updatedAt: now });
}

function projectFacts(input: {
  deps: LocalIngestionBatchDeps; input: PrepareLocalIngestionInput; bank: CanonicalMemoryBank;
  source: PreparedLocalIngestion["source"]; scope: CanonicalMemoryRecord[]; now: string;
}): Pick<PreparedLocalIngestion, "units" | "duplicates"> {
  const units: PreparedLocalIngestion["units"] = [];
  const duplicates = new Map<string, PreparedLocalIngestion["duplicates"][number]>();
  const seen = new Set<string>();
  for (const [index, raw] of input.input.facts.entries()) {
    const fact = AutomaticLocalFactSchema.parse(raw);
    const layer = getLayer(fact.layer)!;
    if ((layer.ownership === "global" ? "global" : "character") !== input.bank.scope.kind) continue;
    requireLayerOwnership(input.bank, layer);
    if (!isSafeAutomaticMemoryText(fact.content) || fact.disclosure !== null && !isSafeAutomaticMemoryText(fact.disclosure)) {
      throw new Error("MEMORY_INVALID_REQUEST");
    }
    const normalized = normalizeForDedupe(fact.content);
    const key = `${fact.layer}\u0000${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const duplicate = normalized ? input.scope.find((record) => record.unit.bankId === input.bank.bankId
      && record.unit.state === "valid" && record.policy.layerId === fact.layer
      && normalizeForDedupe(record.unit.text) === normalized) : undefined;
    const importance = clampAutoImportance(fact.layer, fact.importance);
    if (duplicate) duplicates.set(duplicate.unit.memoryId, { memoryId: duplicate.unit.memoryId,
      expectedRevision: duplicate.unit.revision, importance });
    else units.push(buildFact({ ...input, fact: { ...fact, importance }, index }));
  }
  return { units, duplicates: [...duplicates.values()] };
}

function buildFact(input: {
  deps: LocalIngestionBatchDeps; input: PrepareLocalIngestionInput; bank: CanonicalMemoryBank;
  source: PreparedLocalIngestion["source"]; now: string; fact: AutomaticLocalFact; index: number;
}): PreparedLocalIngestion["units"][number] {
  const { fact, source, now, bank } = input;
  const layer = getLayer(fact.layer)!;
  const memoryId = `local-fact:${hash(JSON.stringify([source.documentId, input.index]))}`;
  const unit = CanonicalMemoryUnitSchema.parse({ authorityEpochId: input.input.epochId, bankId: bank.bankId,
    memoryId, documentId: source.documentId, chunkId: null, text: fact.content, context: null,
    factType: bank.scope.kind === "global" ? "world" : "experience", state: "valid", revision: 1,
    tags: [`taki-layer:${fact.layer}`], metadata: {}, entities: [], sourceMemoryIds: [], observationScopes: null,
    eventDate: source.provenance.capturedAt, occurredStart: null, occurredEnd: null, mentionedAt: source.provenance.capturedAt,
    createdAt: now, updatedAt: now, editedAt: null, consolidatedAt: null, consolidationFailedAt: null,
    invalidationReason: null, invalidatedAt: null, proofCount: 1 });
  const policy: TakiMemoryPolicyProjection = { authorityEpochId: unit.authorityEpochId, bankId: bank.bankId, memoryId,
    layerId: fact.layer, importance: fact.importance, visibility: layer.recallPolicy, disclosure: fact.disclosure,
    origin: "self", emotionalWeight: null, retention: canonicalLayerRetention({ layer, at: now,
      intentionsDefaultDays: input.deps.intentionsDefaultDays }), policyVersion: 1, updatedAt: now };
  return { unit, policy, searchTerms: input.deps.tokenizer.tokenize([fact.content, fact.disclosure ?? ""].join(" ")).join(" ") };
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
