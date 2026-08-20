/**
 * INPUT:  async MemoryCoordinator, trusted scope-to-Bank router, and current layer registry
 * OUTPUT: capability-filtered dormant Hindsight-aligned canonical ToolSet
 * POS:    core/memory/canonical-tools — isolated factory; never assembled with legacy tools in Batch 1
 */
import { randomUUID } from "node:crypto";
import { MemoryErrorEnvelopeSchema, RecallEnvelopeSchema, type EditableMemoryPatch, type MemoryResult, type RecallResult, type TakiMemoryPolicyProjection } from "@taki/shared";
import type { ToolSet } from "ai";
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

export interface MemoryToolBankRouter { globalBankId(): string; characterBankId(): string; characterId(): string; }
interface ToolDeps { coordinator: MemoryCoordinator; router: MemoryToolBankRouter }
type RecallToolInput = { query: string; scope: "global" | "character" | "both"; limit: number; maxTokens: number };

export async function createCanonicalMemoryTools(deps: ToolDeps): Promise<ToolSet> {
  const caps = await deps.coordinator.capabilities(); const tools: ToolSet = {};
  // These user-approved Hindsight names intentionally omit Taki's usual family prefix; production activation must
  // still collision-check them and must never assemble this set beside the legacy memory tools.
  if (caps.retain) tools.retain = createRetainTool(WRITABLE_LAYER_IDS as [string, ...string[]], (input, signal) => safely(() => retain(deps, input, signal)));
  if (caps.recall) tools.recall = createRecallTool((input, signal) => safely(() => recall(deps, input, signal)));
  if (caps.edit) tools.update_memory = createUpdateMemoryTool(WRITABLE_LAYER_IDS as [string, ...string[]], (input, signal) => safely(() => updateMemory(deps, input, signal)));
  if (caps.invalidate) tools.invalidate_memory = createInvalidateMemoryTool((input, signal) => safely(() => invalidateMemory(deps, input, signal)));
  if (caps.restore) tools.restore_memory = createRestoreMemoryTool((input, signal) => safely(() => restoreMemory(deps, input, signal)));
  if (caps.reflect) tools.reflect = createReflectTool((input, signal) => safely(() => deps.coordinator.reflect({ bankId: bank(deps.router, input.scope), query: input.query, budget: input.budget, maxTokens: input.maxTokens }, { signal })));
  return tools;
}

async function retain(deps: ToolDeps, input: { content: string; layer: string; context: string | null }, signal?: AbortSignal) {
  const layer = getLayer(input.layer); if (!layer) throw new Error("invalid memory layer");
  const capturedAt = new Date().toISOString(); const bankId = layer.ownership === "global" ? deps.router.globalBankId() : deps.router.characterBankId();
  return deps.coordinator.retain({
    bankId, content: input.content, context: input.context, timestamp: null, tags: [], entities: [], metadata: {},
    observationScopes: null, documentId: null, strategy: null, updateMode: "replace",
    provenance: { actor: "agent", origin: "explicit-agent", characterId: deps.router.characterId(), timelineFromSeq: null, timelineToSeq: null, capturedAt, sanitized: true, sourceRef: null },
    policy: { layerId: input.layer, importance: 5, visibility: layer.recallPolicy, disclosure: null, origin: "self", emotionalWeight: null, retention: retentionFor(layer, capturedAt), policyVersion: 1 },
  }, { signal });
}

async function recall(deps: ToolDeps, input: RecallToolInput, signal?: AbortSignal): Promise<MemoryResult<RecallResult>> {
  const request = (bankId: string) => deps.coordinator.recall({ bankId, query: input.query, queryTimestamp: new Date().toISOString(), budget: "mid", limit: input.limit, maxTokens: input.maxTokens, factTypes: ["world", "experience", "observation"], layerIds: [], includeInvalidated: false }, { signal });
  if (input.scope !== "both") return request(bank(deps.router, input.scope));
  const [global, character] = await Promise.all([request(deps.router.globalBankId()), request(deps.router.characterBankId())]);
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

function updateMemory(deps: ToolDeps, input: UpdateMemoryToolInput & { patch: EditableMemoryPatch }, signal?: AbortSignal) {
  return deps.coordinator.mutate({ kind: "edit", bankId: bank(deps.router, input.scope), memoryId: input.memoryId, expectedRevision: input.expectedRevision, patch: input.patch }, { signal });
}
function invalidateMemory(deps: ToolDeps, input: InvalidateMemoryToolInput, signal?: AbortSignal) { return deps.coordinator.mutate({ kind: "invalidate", bankId: bank(deps.router, input.scope), memoryId: input.memoryId, expectedRevision: input.expectedRevision, reason: input.reason }, { signal }); }
function restoreMemory(deps: ToolDeps, input: RestoreMemoryToolInput, signal?: AbortSignal) { return deps.coordinator.mutate({ kind: "restore", bankId: bank(deps.router, input.scope), memoryId: input.memoryId, expectedRevision: input.expectedRevision }, { signal }); }
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
