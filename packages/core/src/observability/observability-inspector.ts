/**
 * INPUT:  one authorized durable event and the active Monitor availability mode
 * OUTPUT: populated typed semantic sections; the compatibility technical array is always empty
 * POS:    core/observability — closed privacy projection, never a raw payload or bookkeeping inspector
 */
import {
  getCapabilityLabel, getKnownToolDisplayName, observabilityLabel, observabilityLabels, observabilityUsageDetails,
  TrajectoryInspectorSchema, type MonitorMode, type RunEvent, type TrajectoryInspector,
} from "@taki/shared";
import { initiativeLabel } from "./observability-event-projection.ts";

type Section = NonNullable<TrajectoryInspector["sections"]>[number];
type Fields = Section["fields"];
type Payload = RunEvent["payload"];

export function inspectEvent(event: RunEvent, mode: MonitorMode): TrajectoryInspector {
  if (event.schemaVersion === "run-event.v3") {
    const fields = [{ label: "状态", value: event.payload.state === "waiting" ? "等待后续输入" : "继续执行" }];
    return TrajectoryInspectorSchema.parse({ mode, title: "任务生命周期", sections: [{ key: "event", fields }],
      detail: fields, technical: [], technicalCollapsed: true,
      redactionNotice: "等待与继续是任务状态，不代表模型调用、工具执行或消息已发送。" });
  }
  if (event.schemaVersion === "run-event.v2") {
    const fields = [{ label: "状态", value: initiativeLabel(event.payload.state) }];
    if (event.payload.outcome) fields.push({ label: "决定", value: initiativeLabel(event.payload.outcome) });
    if (event.payload.consideredCount !== undefined) fields.push({ label: "考虑的候选", value: String(event.payload.consideredCount) });
    if (event.payload.selectedCount !== undefined) fields.push({ label: "采用的候选", value: String(event.payload.selectedCount) });
    if (event.payload.opportunityMs !== undefined) fields.push({ label: "已记录有效回应机会", value: `${event.payload.opportunityMs >= 120_000 ? "至少 " : ""}${event.payload.opportunityMs / 1_000} 秒` });
    if (event.payload.disposition) fields.push({ label: "互动观察", value: event.payload.disposition === "unknown"
      ? "回应机会证据不足" : initiativeLabel(event.payload.disposition) });
    return TrajectoryInspectorSchema.parse({ mode, title: initiativeLabel(event.kind), sections: [{ key: "event", fields }],
      detail: fields, technical: [], technicalCollapsed: true, redactionNotice: "执行完成、传输接受、实际呈现和回应机会是独立事实；呈现不代表已阅读。" });
  }
  const sections: Section[] = [{ key: "event", fields: eventFields(event.payload) }];
  const section = semanticSection(event.payload);
  if (section) sections.push(section);
  return TrajectoryInspectorSchema.parse({
    mode, title: observabilityLabel(event.kind), sections,
    detail: sections.flatMap((item) => item.fields), technical: [], technicalCollapsed: true,
    redactionNotice: "仅展示已记录的语义信息；原始提示词、凭据、授权材料、工具载荷及传感器媒体不在展示范围内。",
  });
}

function eventFields(payload: Payload): Fields {
  const fields: Fields = [{ label: "状态", value: observabilityLabel(payload.state) }];
  if ("outcome" in payload && payload.outcome) fields.push({ label: "结果", value: observabilityLabel(payload.outcome) });
  if ("summary" in payload && payload.summary) fields.push({ label: "摘要", value: payload.summary });
  if ("reason" in payload && payload.reason) fields.push({ label: "原因", value: payload.reason });
  return fields;
}

function semanticSection(payload: Payload): Section | undefined {
  switch (payload.kind) {
    case "model.request.started":
    case "model.stream.first":
    case "model.response.settled": return { key: "model", fields: modelFields(payload) };
    case "tool.call.started":
    case "tool.result.settled": return { key: "tool", fields: toolFields(payload) };
    case "usage.settled": return { key: "usage", fields: observabilityUsageDetails(payload) };
    case "context.snapshot": return { key: "context", fields: contextFields(payload) };
    case "governance.evaluated": return { key: "governance", fields: [
      { label: "能力", value: getCapabilityLabel(payload.capabilityId) },
      { label: "治理决定", value: observabilityLabel(payload.decision) },
    ] };
    case "approval.requested":
    case "approval.decided": return { key: "governance", fields: [
      { label: "能力", value: getCapabilityLabel(payload.capabilityId) },
      { label: "审批状态", value: observabilityLabel(payload.state) },
    ] };
    case "run.retry": return { key: "recovery", fields: [
      { label: "执行尝试", value: String(payload.attemptOrdinal) },
      { label: "重试次数", value: String(payload.retryOrdinal) },
    ] };
    case "recovery.classified": return { key: "recovery", fields: [{ label: "恢复分类", value: observabilityLabel(payload.classification) }] };
    default: return undefined;
  }
}

function modelFields(payload: Extract<Payload, { kind: `model.${string}` }>): Fields {
  if (payload.kind === "model.stream.first") return [{ label: "首次输出类型", value: observabilityLabel(payload.outputKind) }];
  const fields: Fields = [{ label: "提供方", value: payload.provider }, { label: "模型", value: payload.modelId }];
  if (payload.kind === "model.response.settled") {
    if (payload.finishReason) fields.push({ label: "结束原因", value: observabilityLabel(payload.finishReason) });
    if (payload.durationMs !== undefined) fields.push({ label: "响应耗时", value: `${payload.durationMs} 毫秒` });
    if (payload.timeToFirstOutputMs !== undefined) fields.push({ label: "首次输出耗时", value: `${payload.timeToFirstOutputMs} 毫秒` });
  }
  return fields;
}

function toolFields(payload: Extract<Payload, { kind: "tool.call.started" | "tool.result.settled" }>): Fields {
  const fields = [{ label: "工具", value: payload.displayName ?? getKnownToolDisplayName(payload.toolName) ?? "工具调用" }];
  if (payload.kind === "tool.call.started") fields.push({ label: "参数校验", value: observabilityLabel(payload.validationState) });
  if (payload.kind === "tool.result.settled") {
    if (payload.errorClass) fields.push({ label: "错误类型", value: observabilityLabel(payload.errorClass) });
    if (payload.durationMs !== undefined) fields.push({ label: "处理耗时", value: `${payload.durationMs} 毫秒` });
  }
  return fields;
}

function contextFields(payload: Extract<Payload, { kind: "context.snapshot" }>): Fields {
  const fields: Fields = [
    { label: "上下文来源", value: observabilityLabels(payload.sourceCategories).join("、") || "未提供" },
    { label: "计量质量", value: observabilityLabel(payload.accountingQuality) },
  ];
  if (payload.contextWindowTokens !== undefined) fields.push({ label: "上下文窗口令牌", value: String(payload.contextWindowTokens) });
  if (payload.inputTokens !== undefined) fields.push({ label: "输入令牌", value: String(payload.inputTokens) });
  return fields;
}
