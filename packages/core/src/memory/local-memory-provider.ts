/**
 * INPUT:  canonical Retain/Recall/Mutation requests plus persisted Local authority and repositories
 * OUTPUT: async Local MemoryProvider with sparse recall, CAS mutations, and optional vector projection
 * POS:    core/memory — dormant provider implementation; never wired into production bootstrap in Batch 1
 */
import { createHash, randomUUID } from "node:crypto";
import {
  CanonicalMemoryUnitSchema, MemoryErrorSchema, MutationRequestSchema, RecallRequestSchema, RetainRequestSchema,
  RecallHitSchema, type CanonicalMemoryBank, type CanonicalMemoryRecord, type EditableMemoryPatch, type MemoryErrorCode,
  type MemoryProviderCapabilities, type MemoryResult, type MutationRequest, type MutationResult, type RecallRequest,
  type RecallResult, type RetainRequest, type RetainResult, type TakiMemoryPolicyProjection,
} from "@taki/shared";
import type { z } from "zod";
import type { CanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { stableRequestHash, type CanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import type { CanonicalMemorySparseRepo, SparseRow } from "../db/canonical-memory-sparse-repo.ts";
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import { DEFAULT_INTENTIONS_DAYS } from "../config/memory-config.ts";
import { getLayer, type MemoryLayerDefinition } from "./layer-registry.ts";
import type { MemoryProvider, MemoryProviderCallContext, MemoryVectorProjection } from "./memory-provider.ts";
import type { SearchTokenizer } from "./search-tokenizer.ts";
import { estimateTokens } from "./token-estimator.ts";

type RecallHit = z.infer<typeof RecallHitSchema>;
interface ProviderState { vectorDegraded: boolean }
export interface LocalMemoryProviderDeps {
  authority: CanonicalMemoryAuthorityRepo; records: CanonicalMemoryRepo; sparse: CanonicalMemorySparseRepo;
  tokenizer: SearchTokenizer; vector?: MemoryVectorProjection; now?: () => string; providerLineageId?: string;
}

export function createLocalMemoryProvider(deps: LocalMemoryProviderDeps): MemoryProvider {
  const epoch = deps.authority.activeEpoch(); const state = { vectorDegraded: false };
  const providerLineageId = deps.providerLineageId ?? epoch.providerLineageId;
  return {
    providerId: "local", providerLineageId,
    capabilities: () => capabilities(deps, state),
    retain: (context, request) => retain({ deps, state, context, request }),
    recall: (context, request) => recall({ deps, state, context, request }),
    reflect: async (context) => failure({ context, caps: await capabilities(deps, state), code: "MEMORY_CAPABILITY_UNSUPPORTED", message: "reflect is unavailable for Local provider" }),
    mutate: (context, request) => mutate({ deps, state, context, request }),
  };
}

async function capabilities(deps: LocalMemoryProviderDeps, state: ProviderState): Promise<MemoryProviderCapabilities> {
  let vectorRetrieval: MemoryProviderCapabilities["vectorRetrieval"] = "unavailable";
  if (deps.vector) {
    try { vectorRetrieval = state.vectorDegraded ? "degraded" : await deps.vector.status(); }
    catch { state.vectorDegraded = true; vectorRetrieval = "degraded"; }
  }
  return { providerId: "local", contractVersion: 1, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval, derivedMemoryRead: false };
}

async function retain(input: { deps: LocalMemoryProviderDeps; state: ProviderState; context: MemoryProviderCallContext; request: RetainRequest }): Promise<MemoryResult<RetainResult>> {
  const { deps, state, context, request } = input;
  const caps = await capabilities(deps, state);
  if (context.signal?.aborted) return failure({ context, caps, code: "MEMORY_OPERATION_CANCELLED", message: "memory operation cancelled" });
  const parsed = RetainRequestSchema.safeParse(request);
  if (!parsed.success) return failure({ context, caps, code: "MEMORY_INVALID_REQUEST", message: "memory retain request is invalid" });
  if (parsed.data.updateMode !== "replace" || parsed.data.strategy !== null) return failure({ context, caps, code: "MEMORY_CAPABILITY_UNSUPPORTED", message: "Local retain supports replace without strategy" });
  try {
    const epoch = deps.authority.activeEpoch(context.authorityEpochId); const bank = requireBank(deps, epoch.epochId, parsed.data.bankId);
    const layer = requirePolicy(bank, parsed.data); const built = buildRetain({ deps, context, request: parsed.data, layer });
    const result = deps.records.retain({ epochId: context.authorityEpochId, bankId: parsed.data.bankId, requestId: context.requestId, requestHash: stableRequestHash(parsed.data), ...built });
    const record = deps.records.record(context.authorityEpochId, parsed.data.bankId, result.memories[0]!.memoryId);
    if (record) scheduleVectorUpsert(deps, state, record);
    return success(context, await capabilities(deps, state), { status: "completed", ...result });
  } catch (error) { return mappedFailure({ context, caps, error, fallback: "memory retain failed" }); }
}

function buildRetain(input: { deps: LocalMemoryProviderDeps; context: MemoryProviderCallContext; request: RetainRequest; layer: MemoryLayerDefinition }) {
  const { deps, context, request, layer } = input;
  const capturedAt = request.provenance.capturedAt; const memoryId = randomUUID();
  const documentId = request.documentId ?? `local:${context.requestId}`;
  const source = { authorityEpochId: context.authorityEpochId, bankId: request.bankId, documentId, contentHash: createHash("sha256").update(request.content).digest("hex"), retainedText: request.content, context: request.context, tags: request.tags, metadata: request.metadata, observationScopes: request.observationScopes, provenance: request.provenance, revision: 1, createdAt: capturedAt, updatedAt: capturedAt };
  const policy = { authorityEpochId: context.authorityEpochId, bankId: request.bankId, memoryId, ...request.policy, updatedAt: capturedAt } as TakiMemoryPolicyProjection;
  const eventDate = request.timestamp === "unset" ? null : request.timestamp ?? now(deps);
  const tags = [...request.tags.filter((tag) => !tag.startsWith("taki-layer:")), `taki-layer:${layer.id}`];
  const unit = CanonicalMemoryUnitSchema.parse({ authorityEpochId: context.authorityEpochId, bankId: request.bankId, memoryId, documentId, chunkId: null, text: request.content, context: request.context, factType: "experience", state: "valid", revision: 1, tags, metadata: request.metadata, entities: request.entities, sourceMemoryIds: [], observationScopes: request.observationScopes, eventDate, occurredStart: null, occurredEnd: null, mentionedAt: capturedAt, createdAt: capturedAt, updatedAt: capturedAt, editedAt: null, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 });
  return { source, unit, policy, searchTerms: projectionTerms({ tokenizer: deps.tokenizer, text: unit.text, context: unit.context, disclosure: policy.disclosure }) };
}

async function recall(input: { deps: LocalMemoryProviderDeps; state: ProviderState; context: MemoryProviderCallContext; request: RecallRequest }): Promise<MemoryResult<RecallResult>> {
  const { deps, state, context, request } = input;
  let caps = await capabilities(deps, state);
  if (context.signal?.aborted) return failure({ context, caps, code: "MEMORY_OPERATION_CANCELLED", message: "memory operation cancelled" });
  const parsed = RecallRequestSchema.safeParse(request);
  if (!parsed.success) return failure({ context, caps, code: "MEMORY_INVALID_REQUEST", message: "memory recall request is invalid" });
  try {
    deps.authority.activeEpoch(context.authorityEpochId); requireBank(deps, context.authorityEpochId, parsed.data.bankId);
    const sparseRows = deps.sparse.search(parsed.data, deps.tokenizer, context.authorityEpochId);
    const candidates = new Map<string, RecallHit>();
    for (const row of sparseRows) addSparseHit({ deps, context, request: parsed.data, row, candidates });
    if (deps.vector) await addVectorHits({ deps, state, context, request: parsed.data, candidates });
    caps = await capabilities(deps, state);
    const fitted = fitHits([...candidates.values()], parsed.data.limit, parsed.data.maxTokens);
    return success(context, caps, { hits: fitted.hits, returned: fitted.hits.length, truncated: fitted.truncated, vectorState: caps.vectorRetrieval, partial: false, branchFailures: [] });
  } catch (error) { return mappedFailure({ context, caps, error, fallback: "memory recall failed" }); }
}

function addSparseHit(input: { deps: LocalMemoryProviderDeps; context: MemoryProviderCallContext; request: RecallRequest; row: SparseRow; candidates: Map<string, RecallHit> }): void {
  const { deps, context, request, row, candidates } = input;
  const record = deps.records.record(context.authorityEpochId, row.bankId, row.memoryId);
  if (!record || !eligible(record, request)) return;
  candidates.set(key(record), { record: fenceObserved(record), scores: [{ source: "sparse", value: row.rank, higherIsBetter: false }], confirmed: true });
}

async function addVectorHits(input: { deps: LocalMemoryProviderDeps; state: ProviderState; context: MemoryProviderCallContext; request: RecallRequest; candidates: Map<string, RecallHit> }): Promise<void> {
  const { deps, state, context, request, candidates } = input;
  try {
    if (await deps.vector!.status() !== "ready") return;
    for (const candidate of await deps.vector!.search(request)) {
      const record = deps.records.record(context.authorityEpochId, request.bankId, candidate.memoryId);
      if (!record || !eligible(record, request)) continue;
      const id = key(record); const existing = candidates.get(id);
      if (existing) existing.scores.push({ source: "vector", value: candidate.score, higherIsBetter: true });
      else candidates.set(id, { record: fenceObserved(record), scores: [{ source: "vector", value: candidate.score, higherIsBetter: true }], confirmed: true });
    }
  } catch { state.vectorDegraded = true; }
}

function eligible(record: CanonicalMemoryRecord, request: RecallRequest): boolean {
  return record.unit.bankId === request.bankId && record.unit.state === "valid" && request.factTypes.includes(record.unit.factType)
    && (request.layerIds.length === 0 || request.layerIds.includes(record.policy.layerId));
}

function fitHits(candidates: RecallHit[], limit: number, maxTokens: number): { hits: RecallHit[]; truncated: boolean } {
  const hits: RecallHit[] = []; let used = 0; let truncated = false;
  for (const hit of candidates) {
    const cost = estimateTokens(hit.record.unit.text);
    if (hits.length >= limit || used + cost > maxTokens) { truncated = true; continue; }
    hits.push(hit); used += cost;
  }
  return { hits, truncated };
}

async function mutate(input: { deps: LocalMemoryProviderDeps; state: ProviderState; context: MemoryProviderCallContext; request: MutationRequest }): Promise<MemoryResult<MutationResult>> {
  const { deps, state, context, request } = input;
  const caps = await capabilities(deps, state);
  if (context.signal?.aborted) return failure({ context, caps, code: "MEMORY_OPERATION_CANCELLED", message: "memory operation cancelled" });
  const parsed = MutationRequestSchema.safeParse(request);
  if (!parsed.success) return failure({ context, caps, code: "MEMORY_INVALID_REQUEST", message: "memory mutation request is invalid" });
  try {
    deps.authority.activeEpoch(context.authorityEpochId); const bank = requireBank(deps, context.authorityEpochId, parsed.data.bankId);
    const current = deps.records.record(context.authorityEpochId, parsed.data.bankId, parsed.data.memoryId);
    const result = mutateRecord({ deps, context, bank, request: parsed.data, current });
    scheduleMutationVector(deps, state, result.record);
    return success(context, await capabilities(deps, state), result);
  } catch (error) { return mappedFailure({ context, caps, error, fallback: "memory mutation failed" }); }
}

function mutateRecord(input: { deps: LocalMemoryProviderDeps; context: MemoryProviderCallContext; bank: CanonicalMemoryBank; request: MutationRequest; current: CanonicalMemoryRecord | undefined }): MutationResult {
  const { deps, context, bank, request, current } = input;
  const common = { epochId: context.authorityEpochId, bankId: request.bankId, memoryId: request.memoryId, expectedRevision: request.expectedRevision, requestId: context.requestId, requestHash: stableRequestHash(request), now: now(deps) };
  if (request.kind === "invalidate") return deps.records.invalidate({ ...common, reason: request.reason, searchTerms: current ? recordTerms(deps, current) : "" });
  if (request.kind === "restore") return deps.records.restore({ ...common, searchTerms: current ? recordTerms(deps, current) : "" });
  const { patch, policy } = editProjection({ bank, patch: request.patch, current, at: common.now });
  const text = patch.text ?? current?.unit.text ?? ""; const contextText = patch.context === undefined ? current?.unit.context ?? null : patch.context;
  const disclosure = current?.policy.disclosure ?? null;
  return deps.records.edit({ ...common, patch, policy, searchTerms: projectionTerms({ tokenizer: deps.tokenizer, text, context: contextText, disclosure }) });
}

function editProjection(input: { bank: CanonicalMemoryBank; patch: EditableMemoryPatch; current: CanonicalMemoryRecord | undefined; at: string }) {
  const { bank, patch, current, at } = input;
  const { layerId, ...unitPatch } = patch;
  if (!layerId) return { patch: unitPatch, policy: undefined };
  const layer = getLayer(layerId); if (!layer) throw new Error("MEMORY_INVALID_REQUEST: unknown memory layer");
  requireLayerOwnership(bank, layer);
  return { patch: unitPatch, policy: { layerId, visibility: layer.recallPolicy, retention: projectRetention(layer, current?.policy.retention, at) } };
}

function requireBank(deps: LocalMemoryProviderDeps, epochId: string, bankId: string): CanonicalMemoryBank {
  const bank = deps.authority.getBank(epochId, bankId); if (!bank) throw new Error("MEMORY_NOT_FOUND: memory Bank"); return bank;
}

function requirePolicy(bank: CanonicalMemoryBank, request: RetainRequest): MemoryLayerDefinition {
  const layer = getLayer(request.policy.layerId); if (!layer) throw new Error("MEMORY_INVALID_REQUEST: unknown memory layer");
  requireLayerOwnership(bank, layer);
  if (request.policy.visibility !== layer.recallPolicy || !retentionMatches(layer, request.policy.retention)) throw new Error("MEMORY_INVALID_REQUEST: layer policy projection mismatch");
  if (bank.scope.kind === "character" && request.provenance.characterId !== bank.scope.characterId) throw new Error("MEMORY_INVALID_REQUEST: character provenance mismatch");
  return layer;
}

function requireLayerOwnership(bank: CanonicalMemoryBank, layer: MemoryLayerDefinition): void {
  const expected = layer.ownership === "global" ? "global" : "character";
  if (bank.scope.kind !== expected) throw new Error("MEMORY_INVALID_REQUEST: layer and Bank scope mismatch");
}

function retentionMatches(layer: MemoryLayerDefinition, retention: TakiMemoryPolicyProjection["retention"]): boolean {
  if (layer.retention === "permanent") return retention.kind === "permanent";
  if (layer.retention === "expiring") return retention.kind === "expiring";
  if ("rollingDays" in layer.retention) return retention.kind === "rolling-window" && retention.days === layer.retention.rollingDays;
  return retention.kind === "importance-decay" && retention.archiveBelowImportance === layer.retention.archiveBelowImportance && retention.afterDays === layer.retention.afterDays;
}

function projectRetention(layer: MemoryLayerDefinition, previous: TakiMemoryPolicyProjection["retention"] | undefined, at: string): TakiMemoryPolicyProjection["retention"] {
  if (layer.retention === "permanent") return { kind: "permanent" };
  if (layer.retention === "expiring") return previous?.kind === "expiring" ? previous : { kind: "expiring", expiresAt: new Date(Date.parse(at) + DEFAULT_INTENTIONS_DAYS * 86_400_000).toISOString() };
  if ("rollingDays" in layer.retention) return { kind: "rolling-window", days: layer.retention.rollingDays };
  return { kind: "importance-decay", archiveBelowImportance: layer.retention.archiveBelowImportance, afterDays: layer.retention.afterDays };
}

function projectionTerms(input: { tokenizer: SearchTokenizer; text: string; context: string | null; disclosure: string | null }): string {
  return input.tokenizer.tokenize([input.text, input.context, input.disclosure].filter((value): value is string => value !== null).join(" ")).join(" ");
}
function recordTerms(deps: LocalMemoryProviderDeps, record: CanonicalMemoryRecord): string { return projectionTerms({ tokenizer: deps.tokenizer, text: record.unit.text, context: record.unit.context, disclosure: record.policy.disclosure }); }
function now(deps: LocalMemoryProviderDeps): string { return deps.now?.() ?? new Date().toISOString(); }
function key(record: CanonicalMemoryRecord): string { return `${record.unit.authorityEpochId}\u0000${record.unit.bankId}\u0000${record.unit.memoryId}`; }

function fenceObserved(record: CanonicalMemoryRecord): CanonicalMemoryRecord {
  if (record.policy.origin !== "observed") return record;
  return { ...record, unit: { ...record.unit, text: fenceUntrusted({ source: "memory", content: record.unit.text }), context: record.unit.context === null ? null : fenceUntrusted({ source: "memory-context", content: record.unit.context }) } };
}

function scheduleVectorUpsert(deps: LocalMemoryProviderDeps, state: ProviderState, record: CanonicalMemoryRecord): void {
  try { deps.vector?.scheduleUpsert(record); } catch { state.vectorDegraded = true; }
}
function scheduleMutationVector(deps: LocalMemoryProviderDeps, state: ProviderState, record: CanonicalMemoryRecord): void {
  try { if (record.unit.state === "valid") deps.vector?.scheduleUpsert(record); else deps.vector?.scheduleDelete({ authorityEpochId: record.unit.authorityEpochId, bankId: record.unit.bankId, memoryId: record.unit.memoryId }); }
  catch { state.vectorDegraded = true; }
}

function success<T>(context: MemoryProviderCallContext, caps: MemoryProviderCapabilities, data: T): MemoryResult<T> {
  return { ok: true, requestId: context.requestId, providerId: "local", authorityEpochId: context.authorityEpochId, capabilities: caps, data };
}

function mappedFailure<T>(input: { context: MemoryProviderCallContext; caps: MemoryProviderCapabilities; error: unknown; fallback: string }): MemoryResult<T> {
  const message = input.error instanceof Error ? input.error.message : "";
  if (message.includes("REQUEST_ID_CONFLICT")) return failure({ context: input.context, caps: input.caps, code: "MEMORY_REQUEST_ID_CONFLICT", message: "memory request identity was reused" });
  if (message.includes("REVISION_MISMATCH")) return failure({ context: input.context, caps: input.caps, code: "MEMORY_REVISION_MISMATCH", message: "memory revision is stale", currentRevision: Number(message.split(":").at(-1)) });
  if (message.includes("NOT_FOUND")) return failure({ context: input.context, caps: input.caps, code: "MEMORY_NOT_FOUND", message: "memory record was not found" });
  if (message.includes("OUTCOME_UNKNOWN")) return failure({ context: input.context, caps: input.caps, code: "MEMORY_OUTCOME_UNKNOWN", message: "memory operation outcome is unknown" });
  if (message.includes("AUTHORITY_MISMATCH")) return failure({ context: input.context, caps: input.caps, code: "MEMORY_AUTHORITY_MISMATCH", message: "memory authority is stale" });
  if (message.includes("INVALID_REQUEST")) return failure({ context: input.context, caps: input.caps, code: "MEMORY_INVALID_REQUEST", message: "memory request is invalid" });
  if (message.includes("CAPABILITY_UNSUPPORTED")) return failure({ context: input.context, caps: input.caps, code: "MEMORY_CAPABILITY_UNSUPPORTED", message: "memory operation unsupported" });
  if (message.includes("INTEGRITY_ERROR")) return failure({ context: input.context, caps: input.caps, code: "MEMORY_INTEGRITY_ERROR", message: "memory integrity check failed" });
  return failure({ context: input.context, caps: input.caps, code: "MEMORY_INTERNAL_ERROR", message: input.fallback });
}

function failure<T>(input: { context: MemoryProviderCallContext; caps: MemoryProviderCapabilities; code: MemoryErrorCode; message: string; currentRevision?: number }): MemoryResult<T> {
  const policies = { MEMORY_INVALID_REQUEST: ["validation", false, "fix-request"], MEMORY_NOT_FOUND: ["not-found", false, "refresh-memory"], MEMORY_REQUEST_ID_CONFLICT: ["conflict", false, "fix-request"], MEMORY_REVISION_MISMATCH: ["conflict", false, "refresh-memory"], MEMORY_CAPABILITY_UNSUPPORTED: ["capability", false, "none"], MEMORY_AUTHORITY_MISMATCH: ["authority", false, "check-provider"], MEMORY_OPERATION_CANCELLED: ["availability", false, "none"], MEMORY_OUTCOME_UNKNOWN: ["availability", false, "check-provider"], MEMORY_PROVIDER_UNAVAILABLE: ["availability", true, "check-provider"], MEMORY_INTEGRITY_ERROR: ["integrity", false, "check-provider"], MEMORY_INTERNAL_ERROR: ["internal", false, "check-provider"] } as const;
  const policy = policies[input.code];
  const [category, retryable, nextAction] = policy;
  const error = MemoryErrorSchema.parse({ code: input.code, category, message: input.message, retryable, nextAction, ...(input.currentRevision === undefined ? {} : { currentRevision: input.currentRevision }) });
  return { ok: false, requestId: input.context.requestId, providerId: "local", authorityEpochId: input.context.authorityEpochId, capabilities: input.caps, error };
}
