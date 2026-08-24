/**
 * INPUT:  async MemoryCoordinator, trusted scope-to-Bank router, and current layer registry
 * OUTPUT: capability-filtered Hindsight-aligned canonical ToolSet
 * POS:    core/memory/canonical-tools — marker-selected canonical runtime; never assembled beside legacy tools
 */
import { randomUUID } from "node:crypto";
import { MemoryErrorEnvelopeSchema, RecallEnvelopeSchema, type EditableMemoryPatch, type MemoryResult, type RecallResult, type TakiMemoryPolicyProjection } from "@taki/shared";
import type { ToolSet } from "ai";
import type { MemoryAuthorityEpoch } from "@taki/shared";
import { DEFAULT_INTENTIONS_DAYS } from "../../config/memory-config.ts";
import { estimateTokens } from "../token-estimator.ts";
import type { MemoryCoordinator } from "../memory-coordinator.ts";
import { WRITABLE_LAYER_IDS, getLayer, type MemoryLayerDefinition } from "../layer-registry.ts";
import { createInvalidateMemoryTool, type InvalidateMemoryToolInput } from "./invalidate-memory-tool.ts";
import { createRecallTool } from "./recall-tool.ts";
import { createReflectTool } from "./reflect-tool.ts";
import { createRestoreMemoryTool, type RestoreMemoryToolInput } from "./restore-memory-tool.ts";
import { createRetainTool } from "./retain-tool.ts";
import { createUpdateMemoryTool, type UpdateMemoryToolInput } from "./update-memory-tool.ts";
import { attachMemoryEffectMetadata, deriveMemoryBranchRequestId } from "./memory-effect-tool.ts";
import { effectExecutionContext } from "../../governance/governed-tool.ts";

export interface MemoryToolBankRouter { globalBankId(): string; characterBankId(): string; characterId(): string; }
interface ToolDeps { coordinator: MemoryCoordinator; router: MemoryToolBankRouter; authority?: MemoryAuthorityEpoch }
type RecallToolInput = { query: string; scope: "global" | "character" | "both"; limit: number; maxTokens: number };

export async function createCanonicalMemoryTools(deps: ToolDeps): Promise<ToolSet> {
  return createCanonicalMemoryToolsWithCapabilities(deps, await deps.coordinator.capabilities());
}

export function createCanonicalMemoryToolsWithCapabilities(deps: ToolDeps, caps: Awaited<ReturnType<MemoryCoordinator["capabilities"]>>): ToolSet {
  const tools: ToolSet = {};
  // These user-approved Hindsight names intentionally omit Taki's usual family prefix; production activation must
  // still collision-check them and must never assemble this set beside the legacy memory tools.
  if (caps.retain) tools.retain = memoryTool(createRetainTool(WRITABLE_LAYER_IDS as [string, ...string[]], (input, options) => safely(() => retain(deps, input, options))), "retain", deps, caps);
  if (caps.recall) tools.recall = memoryTool(createRecallTool((input, options) => safely(() => recall(deps, input, options))), "recall", deps, caps);
  if (caps.edit) tools.update_memory = memoryTool(createUpdateMemoryTool(WRITABLE_LAYER_IDS as [string, ...string[]], (input, options) => safely(() => updateMemory(deps, input, options))), "edit", deps, caps);
  if (caps.invalidate) tools.invalidate_memory = memoryTool(createInvalidateMemoryTool((input, options) => safely(() => invalidateMemory(deps, input, options))), "invalidate", deps, caps);
  if (caps.restore) tools.restore_memory = memoryTool(createRestoreMemoryTool((input, options) => safely(() => restoreMemory(deps, input, options))), "restore", deps, caps);
  if (caps.reflect) tools.reflect = memoryTool(createReflectTool((input, options) => safely(() => deps.coordinator.reflect({ bankId: bank(deps.router, input.scope), query: input.query, budget: input.budget, maxTokens: input.maxTokens }, callOptions(deps, options)))), "reflect", deps, caps);
  return tools;
}

async function retain(deps: ToolDeps, input: { content: string; layer: string; context: string | null }, options?: unknown) {
  const layer = getLayer(input.layer); if (!layer) throw new Error("invalid memory layer");
  const capturedAt = new Date().toISOString(); const bankId = layer.ownership === "global" ? deps.router.globalBankId() : deps.router.characterBankId();
  return deps.coordinator.retain({
    bankId, content: input.content, context: input.context, timestamp: null, tags: [], entities: [], metadata: {},
    observationScopes: null, documentId: null, strategy: null, updateMode: "replace",
    provenance: { actor: "agent", origin: "explicit-agent", characterId: deps.router.characterId(), timelineFromSeq: null, timelineToSeq: null, capturedAt, sanitized: true, sourceRef: null },
    policy: { layerId: input.layer, importance: 5, visibility: layer.recallPolicy, disclosure: null, origin: "self", emotionalWeight: null, retention: retentionFor(layer, capturedAt), policyVersion: 1 },
  }, callOptions(deps, options));
}

async function recall(deps: ToolDeps, input: RecallToolInput, options?: unknown): Promise<MemoryResult<RecallResult>> {
  const effect = effectExecutionContext(options); const outer = effect?.effectId;
  const request = (bankId: string, scope: "global" | "character") => deps.coordinator.recall({ bankId, query: input.query, queryTimestamp: new Date().toISOString(), budget: "mid", limit: input.limit, maxTokens: input.maxTokens, factTypes: ["world", "experience", "observation"], layerIds: [], includeInvalidated: false }, callOptions(deps, options, outer ? deriveMemoryBranchRequestId(outer, scope) : undefined));
  if (input.scope !== "both") return request(bank(deps.router, input.scope), input.scope);
  const [global, character] = await Promise.all([request(deps.router.globalBankId(), "global"), request(deps.router.characterBankId(), "character")]);
  return combineRecall(global, character, input);
}

function combineRecall(global: MemoryResult<RecallResult>, character: MemoryResult<RecallResult>, input: RecallToolInput): MemoryResult<RecallResult> {
  if (!global.ok && !character.ok) return global;
  if (global.ok && !character.ok) return partialRecall({ success: global, scope: "character", failed: character, input });
  if (!global.ok && character.ok) return partialRecall({ success: character, scope: "global", failed: global, input });
  if (!global.ok || !character.ok) return fallbackEnvelope();
  if (global.providerId !== character.providerId || global.authorityEpochId !== character.authorityEpochId) return fallbackEnvelope();
  const fitted = fitRecall([...global.data.hits, ...character.data.hits], input.limit, input.maxTokens);
  return RecallEnvelopeSchema.parse({ ...global, data: { hits: fitted.hits, returned: fitted.hits.length, truncated: global.data.truncated || character.data.truncated || fitted.truncated, vectorState: combineVectorState(global.data.vectorState, character.data.vectorState), partial: false, branchFailures: [] } });
}

function partialRecall(input: { success: Extract<MemoryResult<RecallResult>, { ok: true }>; scope: "global" | "character"; failed: Extract<MemoryResult<RecallResult>, { ok: false }>; input: RecallToolInput }): MemoryResult<RecallResult> {
  const fitted = fitRecall(input.success.data.hits, input.input.limit, input.input.maxTokens);
  const branchFailures = [{ scope: input.scope, code: input.failed.error.code, retryable: input.failed.error.retryable, nextAction: input.failed.error.nextAction }];
  return RecallEnvelopeSchema.parse({ ...input.success, data: { ...input.success.data, hits: fitted.hits, returned: fitted.hits.length, truncated: input.success.data.truncated || fitted.truncated, partial: true, branchFailures } });
}

function fitRecall(candidates: RecallResult["hits"], limit: number, maxTokens: number): { hits: RecallResult["hits"]; truncated: boolean } {
  const hits: RecallResult["hits"] = []; const seen = new Set<string>(); let used = 0; let truncated = false;
  for (const hit of candidates) {
    const id = `${hit.record.unit.authorityEpochId}\u0000${hit.record.unit.bankId}\u0000${hit.record.unit.memoryId}`;
    if (seen.has(id)) continue; seen.add(id);
    const cost = estimateTokens(hit.record.unit.text);
    if (hits.length >= limit || used + cost > maxTokens) { truncated = true; continue; }
    hits.push(hit); used += cost;
  }
  return { hits, truncated };
}

function updateMemory(deps: ToolDeps, input: UpdateMemoryToolInput & { patch: EditableMemoryPatch }, options?: unknown) {
  return deps.coordinator.mutate({ kind: "edit", bankId: bank(deps.router, input.scope), memoryId: input.memoryId, expectedRevision: input.expectedRevision, patch: input.patch }, callOptions(deps, options));
}
function invalidateMemory(deps: ToolDeps, input: InvalidateMemoryToolInput, options?: unknown) { return deps.coordinator.mutate({ kind: "invalidate", bankId: bank(deps.router, input.scope), memoryId: input.memoryId, expectedRevision: input.expectedRevision, reason: input.reason }, callOptions(deps, options)); }
function restoreMemory(deps: ToolDeps, input: RestoreMemoryToolInput, options?: unknown) { return deps.coordinator.mutate({ kind: "restore", bankId: bank(deps.router, input.scope), memoryId: input.memoryId, expectedRevision: input.expectedRevision }, callOptions(deps, options)); }
function bank(router: MemoryToolBankRouter, scope: "global" | "character"): string { return scope === "global" ? router.globalBankId() : router.characterBankId(); }

function retentionFor(layer: MemoryLayerDefinition, capturedAt: string): TakiMemoryPolicyProjection["retention"] {
  if (layer.retention === "permanent") return { kind: "permanent" };
  if (layer.retention === "expiring") return { kind: "expiring", expiresAt: new Date(Date.parse(capturedAt) + DEFAULT_INTENTIONS_DAYS * 86_400_000).toISOString() };
  if ("rollingDays" in layer.retention) return { kind: "rolling-window", days: layer.retention.rollingDays };
  return { kind: "importance-decay", archiveBelowImportance: layer.retention.archiveBelowImportance, afterDays: layer.retention.afterDays };
}

function combineVectorState(left: RecallResult["vectorState"], right: RecallResult["vectorState"]): RecallResult["vectorState"] {
  if (left === "degraded" || right === "degraded") return "degraded";
  if (left === "building" || right === "building") return "building";
  if (left === "ready" || right === "ready") return "ready";
  return "unavailable";
}

async function safely<T>(operation: () => Promise<T>): Promise<T | ReturnType<typeof fallbackEnvelope>> {
  try { return await operation(); } catch { return fallbackEnvelope(); }
}
function fallbackEnvelope() {
  return MemoryErrorEnvelopeSchema.parse({ ok: false, requestId: randomUUID(), providerId: "unknown", authorityEpochId: null, capabilities: null, error: { code: "MEMORY_INTERNAL_ERROR", category: "internal", message: "memory tool failed", retryable: false, nextAction: "check-provider" } });
}

// eslint-disable-next-line max-params
function memoryTool(tool: ToolSet[string], operation: Parameters<typeof attachMemoryEffectMetadata>[1]["operation"], deps: ToolDeps, capabilities: Awaited<ReturnType<MemoryCoordinator["capabilities"]>>) {
  const authority = deps.authority ?? { epochId: "test-epoch", providerId: capabilities.providerId, providerLineageId: "test-lineage" };
  return attachMemoryEffectMetadata(tool, { operation, authorityEpochId: authority.epochId,
    providerId: authority.providerId, providerLineageId: authority.providerLineageId, capabilities,
    replayPosture: operation === "recall" ? "safe" : "never" });
}

function callOptions(deps: ToolDeps, options?: unknown, requestId?: string) {
  const effect = effectExecutionContext(options);
  const source = effect?.sourceRef.type === "memory" ? effect.sourceRef : undefined;
  return {
    requestId: requestId ?? source?.requestId,
    expectedAuthorityEpochId: deps.authority?.epochId,
    expectedProviderId: deps.authority?.providerId,
    expectedProviderLineageId: deps.authority?.providerLineageId,
    expectedCapabilityDigest: source?.capabilityDigest,
    signal: typeof options === "object" && options !== null && "abortSignal" in options
      ? (options as { abortSignal?: AbortSignal }).abortSignal : undefined,
  };
}
