/**
 * INPUT:  captured provider/Bank identity and a canonical recall request
 * OUTPUT: native candidates with exact hydration and published-byte reuse, or verified replica/Pending fallback
 * POS:    core/memory/hindsight — Hindsight remains authoritative in both paths; bad policy evidence never becomes an availability fallback
 */
import type { HindsightNativeRecallResponse, RecallRequest, RecallResult } from "@taki/shared";
import type { MemoryProviderCallContext } from "../memory-provider.ts";
import { selectMemoryRecall } from "../memory-recall-selection.ts";
import { hydrateHindsightApplication } from "./hindsight-application-bundle-loader.ts";
import { projectHindsightRecall } from "./hindsight-memory-read-projection.ts";
import { hindsightPendingRead } from "./hindsight-memory-pending-read.ts";
import { assertHindsightProviderScope, hindsightAvailabilityFailure, hindsightProviderBank, hindsightProviderCall,
  type HindsightMemoryProviderState } from "./hindsight-memory-provider-context.ts";

interface Input { context: MemoryProviderCallContext; request: RecallRequest; mode?: "foreground" }

export async function recallHindsightMemory(state: HindsightMemoryProviderState, input: Input): Promise<RecallResult> {
  const call = hindsightProviderCall(state, { context: input.context, bankId: input.request.bankId, mode: input.mode });
  const at = input.request.queryTimestamp ?? state.now();
  try {
    await state.deps.synchronize({ bankId: input.request.bankId, context: call(), mode: input.mode });
    const bound = hindsightProviderBank(state, { context: input.context, bankId: input.request.bankId });
    if (!state.client.recallNative) throw new Error("MEMORY_CAPABILITY_UNSUPPORTED");
    const native = await state.client.recallNative({ bankId: bound.bankId, context: call(), request: {
      query: input.request.query, query_timestamp: at, budget: input.request.budget, max_tokens: input.request.maxTokens,
      types: input.request.factTypes, trace: false, include: { entities: null, chunks: null, source_facts: null },
    } });
    let projection = await hydrateCandidates(state, { ...input, at, native, call });
    if (projection.needsBinding) {
      // A native writer may publish between the initial pull and candidate
      // retrieval. Install exact neutral/rebound policy without waiting on the curator.
      await state.deps.synchronize({ bankId: bound.bankId, context: call(), mode: input.mode });
      projection = await hydrateCandidates(state, { ...input, at, native, call });
    }
    assertHindsightProviderScope(state, { context: input.context, scope: bound });
    state.setVector("ready");
    return fit(state, { ...input, at, hits: projection.hits, degraded: false, truncated: projection.stale || projection.needsBinding });
  } catch (error) {
    if (!hindsightAvailabilityFailure(error)) throw error;
    state.assert(input.context, input.request.bankId);
    const bound = hindsightProviderBank(state, { context: input.context, bankId: input.request.bankId });
    const records = state.deps.replica.search({ ...bound, query: input.request.query, limit: 100,
      at, layerIds: input.request.layerIds, factTypes: input.request.factTypes });
    state.setVector("degraded");
    return fit(state, { ...input, at, hits: records.map((record) => ({ record, confirmed: true, scores: [] })), degraded: true, truncated: false });
  }
}

async function hydrateCandidates(state: HindsightMemoryProviderState, input: Input & {
  at: string; native: HindsightNativeRecallResponse; call: ReturnType<typeof hindsightProviderCall>;
}) {
  const bound = hindsightProviderBank(state, { context: input.context, bankId: input.request.bankId });
  const result: ReturnType<typeof projectHindsightRecall> = { hits: [], needsBinding: false, stale: false };
  const seen = new Set<string>();
  const candidates = input.native.results.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id); return true;
  });
  // Hydration includes artifact dependencies, but only explicitly selected
  // native heads. Reserve one of the protocol's 256 selectors for the Bank
  // version whose policy scope is verified together with every candidate.
  for (let offset = 0; offset < candidates.length; offset += 255) {
    const batch = candidates.slice(offset, offset + 255);
    const bundle = await hydrateHindsightApplication({ ...bound, client: state.client, context: input.call(), request: input.call,
      cachedBodies: (refs) => state.deps.replica.readSnapshot((replica) => new Map(refs.flatMap((ref) => {
        const body = replica.body({ ...bound, bodyId: ref.body_id });
        return body ? [[ref.body_id, body] as const] : [];
      }))),
      selectors: [{ object_kind: "bank", object_id: bound.bankId, expected_version: null },
        ...batch.map((candidate) => ({ object_kind: "memory_unit" as const, object_id: candidate.id, expected_version: null }))] });
    assertHindsightProviderScope(state, { context: input.context, scope: bound });
    const projection = projectHindsightRecall({ ...bound, bundle, authorityEpochId: state.epoch.epochId,
      candidates: batch, request: input.request, at: input.at });
    result.hits.push(...projection.hits); result.needsBinding ||= projection.needsBinding; result.stale ||= projection.stale;
  }
  return result;
}

function fit(state: HindsightMemoryProviderState, input: Input & {
  at: string; hits: RecallResult["hits"]; degraded: boolean; truncated: boolean;
}): RecallResult {
  const bound = hindsightProviderBank(state, { context: input.context, bankId: input.request.bankId });
  const pending = hindsightPendingRead(state, input);
  const vectorState = input.degraded ? "degraded" : "ready";
  const fitted = selectMemoryRecall({ branches: [{ scope: bound.route.scope, bankId: bound.bankId,
    data: { hits: input.hits, returned: input.hits.length, pending, truncated: input.truncated,
      vectorState, partial: false, branchFailures: [] } }], query: input.request.query, now: Date.parse(input.at),
  limit: input.request.limit, maxTokens: input.request.maxTokens });
  for (const hit of fitted.hits) state.deps.observeRecallEvidence?.(hit.record, input.request.query, input.context.requestId);
  return { hits: fitted.hits, returned: fitted.hits.length, pending: fitted.pending,
    truncated: input.truncated || fitted.truncated, vectorState, partial: input.degraded,
    branchFailures: input.degraded ? [{ scope: bound.route.scope, code: "MEMORY_PROVIDER_UNAVAILABLE", retryable: true, nextAction: "check-provider" }] : [] };
}
