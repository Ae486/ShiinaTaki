/**
 * INPUT:  raw operation results, provider mode and admission-captured Bank routes
 * OUTPUT: operation-specific fenced model text; raw validated envelopes remain with runtime consumers
 * POS:    core/memory/canonical-tools — SDK projection owner; D77 deep JSON and source fencing stay intact
 */
import { HindsightMemoryMutationEnvelopeV1Schema, HindsightMemoryRecallEnvelopeV1Schema,
  HindsightMemoryReflectEnvelopeV1Schema, HindsightMemoryRetainEnvelopeV1Schema,
  EditEnvelopeSchema, RecallEnvelopeSchema, ReflectEnvelopeSchema, RetainEnvelopeSchema,
  hindsightApplicationWireJson, type MutationResult, type RecallResult, type ReflectResult, type RetainResult } from "@taki/shared";
import { fenceUntrusted } from "../../agents/untrusted-fence.ts";
import { memoryModelScope, memoryPendingModelView, memoryRecordModelView,
  type MemoryModelRoutes } from "./memory-record-model-view.ts";

export function memoryToolModelOutput(output: unknown, context: {
  operation: string; hindsight: boolean; routes: MemoryModelRoutes; scope?: "global" | "character" | "both";
}) {
  const schema = operationSchema(context.operation, context.hindsight);
  const parsed = schema.safeParse(output);
  // A governed wrapper can return its own bounded refusal; never expose arbitrary unvalidated record fields.
  if (!parsed.success && !(typeof output === "object" && output !== null && "ok" in output && output.ok === false)) {
    throw new Error("invalid memory model output");
  }
  const result = parsed.success ? parsed.data : output;
  let view: unknown = boundedToolFailure(result);
  if (parsed.success) view = parsed.data.ok ? successModelView(parsed.data.data, context) : { ok: false,
    ...(context.scope ? { scope: context.scope } : {}), error: parsed.data.error };
  const json = context.hindsight ? hindsightApplicationWireJson(view) : JSON.stringify(view);
  const content = json.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return { type: "text" as const, value: fenceUntrusted({ source: `explicit-memory-${context.operation}`, content }) };
}

function boundedToolFailure(output: unknown) {
  if (typeof output !== "object" || output === null) return output;
  const allowed = new Set(["ok", "code", "message", "state", "retryable", "nextAction", "currentRevision"]);
  return Object.fromEntries(Object.entries(output).filter(([key]) => allowed.has(key)));
}

function operationSchema(operation: string, hindsight: boolean) {
  if (operation === "recall") return hindsight ? HindsightMemoryRecallEnvelopeV1Schema : RecallEnvelopeSchema;
  if (operation === "retain") return hindsight ? HindsightMemoryRetainEnvelopeV1Schema : RetainEnvelopeSchema;
  if (operation === "reflect") return hindsight ? HindsightMemoryReflectEnvelopeV1Schema : ReflectEnvelopeSchema;
  return hindsight ? HindsightMemoryMutationEnvelopeV1Schema : EditEnvelopeSchema;
}

function successModelView(data: RecallResult | RetainResult | ReflectResult | MutationResult,
  context: { operation: string; routes: MemoryModelRoutes; scope?: "global" | "character" | "both" }) {
  if ("hits" in data) return { ok: true, hits: data.hits.map((hit) => ({
    ...memoryRecordModelView(hit.record, context.routes), confirmed: hit.confirmed })),
    ...(data.pending !== undefined ? { pending: data.pending.map((entry) => memoryPendingModelView(entry, context.routes)) } : {}),
    returned: data.returned, truncated: data.truncated, vectorState: data.vectorState,
    partial: data.partial, branchFailures: data.branchFailures };
  if ("status" in data) return { ok: true, ...(context.scope ? { scope: context.scope } : {}), status: data.status, memories: data.memories,
    ...("zeroResult" in data && data.zeroResult !== undefined ? { zeroResult: data.zeroResult } : {}),
    ...(data.bankProgress ? { bankProgress: data.bankProgress.map((progress) => ({ scope: progress.scope,
      status: progress.status, memoryCount: progress.memoryCount, error: progress.error })) } : {}) };
  if ("text" in data) return { ok: true, text: data.text, structuredContent: data.structuredContent,
    evidence: data.evidence };
  if (data.outcome === "pending") {
    const { pending } = data; const request = pending.operation.request;
    return { ok: true, outcome: data.outcome, scope: memoryModelScope(context.routes, pending.bankId),
      confirmed: false, phase: pending.phase, kind: request.kind, memoryId: request.memoryId,
      expectedRevision: request.expectedRevision, originalAt: pending.originalAt };
  }
  // Mutation receipts must not become an alternate recall path for hidden or invalidated target text.
  const record = data.record;
  return { ok: true, outcome: data.outcome, ...(record ? {
    scope: memoryModelScope(context.routes, record.unit.bankId), memoryId: record.unit.memoryId,
    revision: record.unit.revision, state: record.unit.state, updatedAt: record.unit.updatedAt,
  } : {}) };
}
