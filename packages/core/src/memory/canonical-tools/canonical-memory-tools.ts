/**
 * INPUT:  async MemoryCoordinator, trusted scope-to-Bank router, and current layer registry
 * OUTPUT: capability-filtered Hindsight-aligned canonical ToolSet
 * POS:    core/memory/canonical-tools — marker-selected canonical runtime; never assembled beside legacy tools
 */
import { randomUUID } from "node:crypto";
import { HindsightMemoryMutationEnvelopeV1Schema, HindsightMemoryRecallEnvelopeV1Schema, MemoryErrorEnvelopeSchema, RecallEnvelopeSchema, hindsightApplicationWireJson,
  type EditableMemoryPatch, type MemoryProviderCapabilities, type MemoryResult, type RecallResult, type TakiMemoryPolicyProjection } from "@taki/shared";
import type { ToolSet } from "ai";
import type { MemoryAuthorityEpoch } from "@taki/shared";
import { DEFAULT_INTENTIONS_DAYS } from "../../config/memory-config.ts";
import { fenceUntrusted } from "../../agents/untrusted-fence.ts";
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
import { freezeMemoryCapabilities, memoryCapabilityDigest, sameStableMemoryCapabilities } from "../memory-capability-snapshot.ts";
import { recallMatchesNamespace, selectMemoryRecall } from "../memory-recall-selection.ts";

export interface MemoryToolBankRouter { globalBankId(): string; characterBankId(): string; characterId(): string; }
interface ToolDeps { coordinator: MemoryCoordinator; router: MemoryToolBankRouter; authority?: MemoryAuthorityEpoch; capabilityDigest?: string }
interface CapturedToolDeps extends ToolDeps { capabilities: MemoryProviderCapabilities }
type RecallToolInput = { query: string; scope: "global" | "character" | "both"; limit: number; maxTokens: number };
interface RecallBranch { scope: "global" | "character"; bankId: string; result: MemoryResult<RecallResult> }

export async function createCanonicalMemoryTools(deps: ToolDeps): Promise<ToolSet> {
  return createCanonicalMemoryToolsWithCapabilities(deps, await deps.coordinator.capabilities());
}

export function createCanonicalMemoryToolsWithCapabilities(input: ToolDeps, capabilities: Awaited<ReturnType<MemoryCoordinator["capabilities"]>>): ToolSet {
  const caps = Object.isFrozen(capabilities) ? capabilities : freezeMemoryCapabilities(capabilities);
  const global = input.router.globalBankId(); const character = input.router.characterBankId(); const characterId = input.router.characterId();
  // Capture routes as values, not live selection callbacks: a queued Run must keep its original Character banks.
  const deps: CapturedToolDeps = Object.freeze({ ...input, capabilities: caps, authority: input.authority ? Object.freeze({ ...input.authority }) : undefined,
    router: Object.freeze({ globalBankId: () => global, characterBankId: () => character, characterId: () => characterId }),
    capabilityDigest: memoryCapabilityDigest(caps) });
  const tools: ToolSet = {};
  // These user-approved Hindsight names intentionally omit Taki's usual family prefix; production activation must
  // still collision-check them and must never assemble this set beside the legacy memory tools.
  if (caps.retain) tools.retain = memoryTool(createRetainTool(WRITABLE_LAYER_IDS as [string, ...string[]], (input, options) => safely(() => retain(deps, input, options))), "retain", deps, caps);
  if (caps.recall) {
    const recallTool = createRecallTool((input, options) => safely(() => recall(deps, input, options)));
    recallTool.toModelOutput = ({ output }: { output: unknown }) => ({ type: "text", value: fencedRecallOutput(output, caps.providerId === "hindsight") });
    tools.recall = memoryTool(recallTool, "recall", deps, caps);
  }
  if (caps.edit) tools.update_memory = memoryTool(createUpdateMemoryTool(WRITABLE_LAYER_IDS as [string, ...string[]], (input, options) => safely(() => updateMemory(deps, input, options))), "edit", deps, caps);
  if (caps.invalidate) tools.invalidate_memory = memoryTool(createInvalidateMemoryTool((input, options) => safely(() => invalidateMemory(deps, input, options))), "invalidate", deps, caps);
  if (caps.restore) tools.restore_memory = memoryTool(createRestoreMemoryTool((input, options) => safely(() => restoreMemory(deps, input, options))), "restore", deps, caps);
  if (caps.reflect) tools.reflect = memoryTool(createReflectTool((input, options) => safely(() => deps.coordinator.reflect({ bankId: bank(deps.router, input.scope), query: input.query, budget: input.budget, maxTokens: input.maxTokens }, callOptions(deps, options)))), "reflect", deps, caps);
  if (caps.providerId === "hindsight") {
    // The SDK's default JSON output is recursively serialized by the model client and Timeline. Keep the
    // complete execute result, but supply those consumers a text model view. A mutation receipt does not authorize
    // recall of its target: hidden/mood-gated/invalidated records and Pending patches must not re-enter the prompt.
    for (const [name, value] of Object.entries(tools)) {
      if (name !== "recall") value.toModelOutput = ({ output }: { output: unknown }) => ({ type: "text" as const,
        value: fencedHindsightOutput(name === "reflect" || name === "retain" ? output : hindsightMutationModelView(output),
          `explicit-memory-${name}`) });
    }
  }
  for (const value of Object.values(tools)) Object.freeze(value);
  return Object.freeze(tools);
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

async function recall(deps: CapturedToolDeps, input: RecallToolInput, options?: unknown): Promise<MemoryResult<RecallResult>> {
  const effect = effectExecutionContext(options); const outer = effect?.effectId;
  const now = Date.now();
  const scopes = input.scope === "both" ? ["global", "character"] as const : [input.scope];
  const branches = await Promise.all(scopes.map(async (scope): Promise<RecallBranch> => {
    const bankId = bank(deps.router, scope);
    try {
      const result = await deps.coordinator.recall({ bankId, query: input.query, queryTimestamp: new Date(now).toISOString(),
        budget: "mid", limit: input.limit, maxTokens: input.maxTokens, factTypes: ["world", "experience", "observation"],
        layerIds: [], includeInvalidated: false }, callOptions(deps, options, outer ? deriveMemoryBranchRequestId(outer, scope) : undefined));
      return { scope, bankId, result: validateRecallBranch(deps, bankId, result) };
    } catch { return { scope, bankId, result: fallbackEnvelope() }; }
  }));
  return combineRecall(branches, { ...input, now }, deps.capabilities.providerId === "hindsight");
}

function validateRecallBranch(deps: CapturedToolDeps, bankId: string, value: MemoryResult<RecallResult>): MemoryResult<RecallResult> {
  const schema = deps.capabilities.providerId === "hindsight" ? HindsightMemoryRecallEnvelopeV1Schema : RecallEnvelopeSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) return fallbackEnvelope();
  const result = parsed.data;
  if (!result.ok) return result;
  if ((deps.authority && (result.providerId !== deps.authority.providerId || result.authorityEpochId !== deps.authority.epochId))
    || !sameStableMemoryCapabilities(result.capabilities, deps.capabilities)
    || result.capabilities.vectorRetrieval !== result.data.vectorState
    || !recallMatchesNamespace(result.data, { bankId, authorityEpochId: result.authorityEpochId })) return recallAuthorityFailure(result);
  return result;
}

function combineRecall(branches: RecallBranch[], input: RecallToolInput & { now: number }, hindsight: boolean): MemoryResult<RecallResult> {
  const successes = branches.flatMap((branch) => branch.result.ok ? [{ ...branch, result: branch.result }] : []);
  const first = successes[0]?.result;
  if (!first) return branches[0]?.result ?? fallbackEnvelope();
  if (successes.some(({ result }) => result.providerId !== first.providerId || result.authorityEpochId !== first.authorityEpochId
    || !sameStableMemoryCapabilities(result.capabilities, first.capabilities))) return recallAuthorityFailure(first);
  const fitted = selectMemoryRecall({ ...input, branches: successes.map(({ scope, bankId, result }) => ({ scope, bankId, data: result.data })) });
  const failures = branches.flatMap(({ scope, result }) => result.ok ? result.data.branchFailures
    : [{ scope, code: result.error.code, retryable: result.error.retryable, nextAction: result.error.nextAction }]);
  const branchFailures = [...new Map(failures.map((failure) => [failure.scope, failure])).values()];
  const vectorState = successes.map(({ result }) => result.data.vectorState).reduce(combineVectorState);
  const schema = hindsight ? HindsightMemoryRecallEnvelopeV1Schema : RecallEnvelopeSchema;
  return schema.parse({ ...first, capabilities: { ...first.capabilities, vectorRetrieval: vectorState }, data: {
    hits: fitted.hits, returned: fitted.hits.length,
    ...(successes.some(({ result }) => result.data.pending !== undefined) ? { pending: fitted.pending } : {}),
    truncated: fitted.truncated || successes.some(({ result }) => result.data.truncated), vectorState,
    partial: branchFailures.length > 0, branchFailures,
  } });
}

function recallAuthorityFailure(result: MemoryResult<RecallResult>): MemoryResult<never> {
  return MemoryErrorEnvelopeSchema.parse({ ok: false, requestId: result.requestId, providerId: result.providerId,
    authorityEpochId: result.authorityEpochId, capabilities: result.capabilities,
    error: { code: "MEMORY_AUTHORITY_MISMATCH", category: "authority", message: "memory recall identity is stale",
      retryable: false, nextAction: "check-provider" } });
}

function fencedRecallOutput(output: unknown, hindsight: boolean): string {
  // Execute retains the canonical structured result; only model-facing text is escaped and fenced.
  // The D77 serializer preserves deep values that JSON.stringify cannot traverse. Invalid data throws;
  // emitting an empty string would falsely present a successful but missing memory result.
  if (hindsight) return fencedHindsightOutput(output, "explicit-memory-recall");
  const json = JSON.stringify(output) ?? "";
  const content = json.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return fenceUntrusted({ source: "explicit-memory-recall", content });
}

function fencedHindsightOutput(output: unknown, source: string): string {
  const content = hindsightApplicationWireJson(output).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return fenceUntrusted({ source, content });
}

function hindsightMutationModelView(output: unknown): unknown {
  const parsed = HindsightMemoryMutationEnvelopeV1Schema.safeParse(output);
  if (!parsed.success) {
    // The outer governance wrapper can return a bounded denial instead of a MemoryResult. Preserve its
    // real error disposition without serializing arbitrary additional fields from an unvalidated result.
    if (typeof output === "object" && output !== null && "ok" in output && output.ok === false
      && "code" in output && typeof output.code === "string" && "message" in output && typeof output.message === "string") {
      return { ok: false, code: output.code, message: output.message };
    }
    return fallbackEnvelope();
  }
  const result = parsed.data;
  if (!result.ok) return result;
  const data = result.data;
  if (data.outcome === "pending") {
    const { pending } = data; const request = pending.operation.request;
    return { ...result, data: { outcome: data.outcome, operationId: pending.operationId, phase: pending.phase,
      kind: request.kind, bankId: pending.bankId, memoryId: request.memoryId, expectedRevision: request.expectedRevision } };
  }
  const unit = data.record?.unit;
  return { ...result, data: { outcome: data.outcome,
    ...(unit ? { bankId: unit.bankId, memoryId: unit.memoryId, revision: unit.revision, state: unit.state } : {}) } };
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
    expectedCapabilityDigest: source?.capabilityDigest ?? deps.capabilityDigest,
    signal: typeof options === "object" && options !== null && "abortSignal" in options
      ? (options as { abortSignal?: AbortSignal }).abortSignal : undefined,
  };
}
