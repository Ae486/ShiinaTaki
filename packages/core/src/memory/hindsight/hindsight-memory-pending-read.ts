/**
 * INPUT:  a verified Hindsight replica and durable original source/mutation intents
 * OUTPUT: separate unconfirmed overlays, gated by exact scope and current known target policy
 * POS:    core/memory/hindsight — display only; neither deduplication nor overlay admission advances a write receipt
 */
import type { RecallPendingOverlayEntry, RecallRequest, PendingMemoryRecord } from "@taki/shared";
import { selectMemoryRecall } from "../memory-recall-selection.ts";
import { hindsightApplicationEvidenceReader, hindsightApplicationPolicyContext } from "./hindsight-application-binding-context.ts";
import { readHindsightApplicationNative } from "./hindsight-application-projection.ts";
import { hindsightPolicyAdmission } from "./hindsight-policy-admission.ts";
import { hindsightProviderBank, type HindsightMemoryProviderState } from "./hindsight-memory-provider-context.ts";
import type { MemoryProviderCallContext } from "../memory-provider.ts";

export function hindsightPendingRead(state: HindsightMemoryProviderState, input: {
  context: MemoryProviderCallContext; request: RecallRequest; at: string;
}): RecallPendingOverlayEntry[] {
  const bound = hindsightProviderBank(state, { context: input.context, bankId: input.request.bankId });
  const result: RecallPendingOverlayEntry[] = []; let afterSequence = 0;
  for (;;) {
    state.assert(input.context, bound.bankId);
    const page = state.deps.pending.list({ authorityEpochId: state.epoch.epochId, bankId: bound.bankId,
      phases: ["queued", "submitted", "awaiting_derived", "awaiting_pull", "outcome_unknown"], afterSequence, limit: 100 });
    if (page.length === 0) break;
    for (const row of page) {
      afterSequence = row.sequence;
      if (row.intent.providerLineageId !== bound.namespace.provider_lineage || row.intent.bankGeneration !== bound.namespace.bank_generation
        || row.intent.bank.scope !== bound.route.scope || row.intent.bank.characterId !== bound.route.characterId) continue;
      if (state.deps.writes.ownsPendingOperation?.(row.intent.operationId)) continue;
      // A partially produced document can contain restricted or not-yet-bound
      // sibling facts. A single visible hit cannot authorize its whole source.
      if (row.intent.operation.kind === "retain" && row.documentId !== null && state.deps.replica.nativeHead({ ...bound,
        objectKind: "document", objectId: row.documentId }) !== undefined) continue;
      const overlay = admitOverlay(state, { ...input, entry: originalOverlay(row) });
      if (overlay) result.push(overlay);
    }
  }
  for (const entry of state.deps.writes.mutationOverlays?.(bound.bankId) ?? []) {
    const overlay = admitOverlay(state, { ...input, entry });
    if (overlay) result.push(overlay);
  }
  return result;
}

function originalOverlay(row: PendingMemoryRecord): RecallPendingOverlayEntry {
  if (!["queued", "submitted", "awaiting_derived", "awaiting_pull", "outcome_unknown"].includes(row.phase)) throw new Error("MEMORY_INTEGRITY_ERROR");
  return { authorityEpochId: row.intent.authorityEpochId, bankId: row.intent.bank.bankId, operationId: row.intent.operationId,
    originalAt: row.intent.originalAt, confirmed: false, phase: row.phase as RecallPendingOverlayEntry["phase"], operation: row.intent.operation };
}

function admitOverlay(state: HindsightMemoryProviderState, input: {
  context: MemoryProviderCallContext; request: RecallRequest; at: string; entry: RecallPendingOverlayEntry;
}): RecallPendingOverlayEntry | undefined {
  const bound = hindsightProviderBank(state, { context: input.context, bankId: input.request.bankId });
  let entry = input.entry;
  if (entry.authorityEpochId !== state.epoch.epochId || entry.bankId !== bound.bankId || entry.operation.request.bankId !== bound.bankId) {
    throw new Error("MEMORY_AUTHORITY_MISMATCH");
  }
  if (entry.operation.kind === "mutation") {
    const head = state.deps.replica.nativeHead({ ...bound, objectKind: "memory_unit", objectId: entry.operation.request.memoryId });
    if (!head?.version || head.binding_state !== "bound" || !head.bound_artifact) return undefined;
    const evidence = hindsightApplicationEvidenceReader(state.deps.replica, bound);
    const native = readHindsightApplicationNative({ ...bound, head, evidence });
    const context = hindsightApplicationPolicyContext({ ...bound, authorityEpochId: state.epoch.epochId }, native);
    const artifact = evidence.artifact(head.bound_artifact); const body = evidence.body(artifact.body_ref).content;
    if (body.body_schema !== "application-memory.v1") throw new Error("MEMORY_INTEGRITY_ERROR");
    if (!hindsightPolicyAdmission({ context, state: { status: "present", ...bound, native: native.version,
      artifact: head.bound_artifact, body: body.value }, query: input.request.query, at: input.at, layerIds: input.request.layerIds }).eligible) return undefined;
    const targetRecord = state.deps.replica.record({ ...bound, memoryId: entry.operation.request.memoryId });
    if (!targetRecord || targetRecord.unit.revision !== entry.operation.request.expectedRevision) return undefined;
    entry = { ...entry, targetRecord };
  } else if (input.request.layerIds.length > 0 && !input.request.layerIds.includes(entry.operation.request.policy.layerId)) return undefined;
  return selectMemoryRecall({ branches: [{ scope: bound.route.scope, bankId: bound.bankId,
    data: { hits: [], returned: 0, pending: [entry], truncated: false, vectorState: "degraded", partial: false, branchFailures: [] } }],
  query: input.request.query, now: Date.parse(input.at), limit: 1, maxTokens: input.request.maxTokens }).pending[0];
}
