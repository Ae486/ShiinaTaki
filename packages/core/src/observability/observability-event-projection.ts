/**
 * INPUT:  one validated committed Run Event with producer-owned identities and bounded semantic facts
 * OUTPUT: a Chinese trajectory row retaining machine-only exact correlation and captured display names
 * POS:    core/observability — pure projection; never infers a request or a tool target from time or routing keys
 */
import {
  getKnownToolDisplayName, observabilityLabel, observabilityLabels, TrajectoryRowSchema,
  type RunEvent, type TrajectoryRow,
} from "@taki/shared";

export function projectEvent(event: RunEvent): TrajectoryRow {
  const payload = event.payload;
  const base = projectBase(event);
  if (payload.kind === "usage.settled") return TrajectoryRowSchema.parse({
    ...base, kind: "usage", inputTokens: payload.inputTokens, inputTokenDetails: payload.inputTokenDetails,
    outputTokens: payload.outputTokens, outputTokenDetails: payload.outputTokenDetails,
    totalTokens: payload.totalTokens, quality: observabilityLabel(payload.quality),
  });
  if (payload.kind === "model.request.started" || payload.kind === "model.response.settled") {
    return TrajectoryRowSchema.parse({
      ...base, kind: "model", provider: payload.provider, modelId: payload.modelId,
      ...(payload.kind === "model.response.settled" ? {
        finishReason: payload.finishReason ? observabilityLabel(payload.finishReason) : undefined,
        timeToFirstOutputMs: payload.timeToFirstOutputMs,
      } : {}),
    });
  }
  if (payload.kind === "model.stream.first") return TrajectoryRowSchema.parse({ ...base, kind: "model", outputKind: payload.outputKind });
  if (payload.kind === "tool.call.started" || payload.kind === "tool.result.settled") {
    return TrajectoryRowSchema.parse({
      ...base, kind: "tool", toolName: payload.toolName, displayName: payload.displayName,
      ...(payload.kind === "tool.result.settled" && payload.errorClass ? { errorClass: observabilityLabel(payload.errorClass) } : {}),
    });
  }
  if (payload.kind === "context.snapshot") return TrajectoryRowSchema.parse({
    ...base, kind: "context", sourceCategories: observabilityLabels(payload.sourceCategories),
    accountingQuality: observabilityLabel(payload.accountingQuality),
  });
  if (payload.kind === "governance.evaluated") return TrajectoryRowSchema.parse({ ...base, kind: "governance", decision: observabilityLabel(payload.decision) });
  if (payload.kind === "approval.requested" || payload.kind === "approval.decided") {
    return TrajectoryRowSchema.parse({ ...base, kind: "governance", approvalState: observabilityLabel(payload.state) });
  }
  if (payload.kind === "run.retry" || payload.kind === "recovery.classified") return TrajectoryRowSchema.parse({
    ...base, kind: "recovery", classification: observabilityLabel(payload.kind === "run.retry" ? "retrying" : payload.classification),
  });
  if (isEffectPayload(payload)) return TrajectoryRowSchema.parse({ ...base, kind: "effect", effectKind: payload.effectKind });
  if (event.attemptId && "attemptOrdinal" in payload) {
    return TrajectoryRowSchema.parse({ ...base, kind: "attempt", attemptOrdinal: payload.attemptOrdinal });
  }
  return TrajectoryRowSchema.parse({ ...base, kind: "lifecycle" });
}

function projectBase(event: RunEvent) {
  const payload = event.payload;
  const surface = surfaceOf(event);
  return {
    rowKey: event.eventId, seq: event.seq, groupKey: event.attemptId, eventKind: event.kind,
    ...correlation(payload), label: observabilityLabel(event.kind),
    contextLabel: isEffectPayload(payload) ? effectContext(payload.sourceRef) : undefined,
    phase: phaseOf(event), category: event.category, categoryLabel: observabilityLabel(event.category),
    status: "state" in payload ? observabilityLabel(payload.state) : observabilityLabel(event.kind),
    outcome: "outcome" in payload && payload.outcome ? observabilityLabel(payload.outcome) : undefined,
    occurredAt: event.occurredAt,
    startedAt: "startedAt" in payload ? payload.startedAt : undefined,
    durationMs: "durationMs" in payload ? payload.durationMs : undefined,
    surface, surfaceLabel: observabilityLabel(surface),
    summary: "summary" in payload ? payload.summary : undefined,
    errorReason: "reason" in payload ? payload.reason : undefined,
  };
}

function correlation(payload: RunEvent["payload"]) {
  const modelEffectId = payload.kind === "usage.settled" || payload.kind.startsWith("model.")
    || (isEffectPayload(payload) && payload.effectKind === "model")
    ? ("effectId" in payload ? payload.effectId : undefined)
    : "modelEffectId" in payload ? payload.modelEffectId : undefined;
  return {
    effectId: "effectId" in payload ? payload.effectId : undefined,
    callId: "callId" in payload ? payload.callId : undefined,
    toolCallId: "toolCallId" in payload ? payload.toolCallId : undefined,
    invocationId: "invocationId" in payload ? payload.invocationId : undefined,
    modelEffectId,
  };
}

function surfaceOf(event: RunEvent): TrajectoryRow["surface"] {
  if (["attempt.prepared", "effect.intent_committed", "effect.waiting"].includes(event.kind)) return "log-only";
  if (event.payload.kind === "attempt.settled" && event.payload.retryability === "retryable") return "shadowed";
  return "current";
}

function phaseOf(event: RunEvent): TrajectoryRow["phase"] {
  if (event.kind === "run.admitted") return "trigger";
  if (event.kind.startsWith("attempt.")) return "attempt";
  if (event.kind.startsWith("effect.")) return "effect";
  if (event.kind === "recovery.classified") return "recovery";
  return event.category === "lifecycle" ? "run" : event.category;
}

type EffectPayload = Extract<RunEvent["payload"], { kind: "effect.intent_committed" | "effect.waiting" | "effect.settled" }>;
function isEffectPayload(payload: RunEvent["payload"]): payload is EffectPayload {
  return payload.kind === "effect.intent_committed" || payload.kind === "effect.waiting" || payload.kind === "effect.settled";
}

function effectContext(source: EffectPayload["sourceRef"]): string {
  switch (source.type) {
    case "model": return "模型请求";
    case "tool": return getKnownToolDisplayName(source.toolName) ?? "工具操作";
    case "approval": return "审批决定";
    case "host": return "主机操作";
    case "mcp": return "扩展工具";
    case "memory": return "记忆操作";
  }
}
