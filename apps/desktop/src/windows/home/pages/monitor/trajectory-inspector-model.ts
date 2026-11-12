/**
 * INPUT:  an authorized semantic Inspector and its exactly associated loaded record facts
 * OUTPUT: populated typed sections that follow the same record's observed settlement without another request
 * POS:    ui/monitor — disposable Inspector projection; no raw metadata, payload fallback, or new authority
 */
import { observabilityLabel, observabilityUsageDetails, type TrajectoryInspector } from "@taki/shared";
import type { TrajectoryRecord } from "./trajectory-records.ts";

type Section = NonNullable<TrajectoryInspector["sections"]>[number];
type Fields = Section["fields"];

export function inspectorSections(inspector: TrajectoryInspector, record?: TrajectoryRecord): Section[] {
  if (inspector.mode === "DISABLED") return [];
  const sections = new Map<Section["key"], Fields>();
  const existing = inspector.sections ?? (inspector.detail.length > 0 ? [{ key: "event" as const, fields: inspector.detail }] : []);
  for (const section of existing) if (section.fields.length > 0) sections.set(section.key, section.fields);
  if (record) {
    mergeSection(sections, { key: "event", fields: eventFields(record) });
    const operation = operationSection(record);
    if (operation) mergeSection(sections, operation);
    if (record.usage) mergeSection(sections, { key: "usage", fields: observabilityUsageDetails(record.usage) });
  }
  return [...sections].map(([key, fields]) => ({ key, fields }));
}

function mergeSection(sections: Map<Section["key"], Fields>, section: Section): void {
  const fields = new Map(sections.get(section.key)?.map((field) => [field.label, field]));
  for (const field of section.fields) fields.set(field.label, field);
  if (fields.size > 0) sections.set(section.key, [...fields.values()]);
}

function eventFields(record: TrajectoryRecord): Fields {
  const row = record.row;
  const fields: Fields = [{ label: "状态", value: row.status }];
  if (row.outcome) fields.push({ label: "结果", value: row.outcome });
  if (row.summary) fields.push({ label: "摘要", value: row.summary });
  if (row.errorReason) fields.push({ label: "原因", value: row.errorReason });
  return fields;
}

function operationSection(record: TrajectoryRecord): Section | undefined {
  const row = record.row;
  if (row.kind === "tool") {
    const fields: Fields = [{ label: "工具", value: record.name }];
    if (row.errorClass) fields.push({ label: "错误类型", value: row.errorClass });
    if (row.durationMs !== undefined) fields.push({ label: "处理耗时", value: `${row.durationMs} 毫秒（含审批等待）` });
    return { key: "tool", fields };
  }
  if (row.kind !== "model") return undefined;
  const fields: Fields = [];
  if (row.provider) fields.push({ label: "提供方", value: row.provider });
  if (row.modelId) fields.push({ label: "模型", value: row.modelId });
  if (row.finishReason) fields.push({ label: "结束原因", value: row.finishReason });
  if (row.durationMs !== undefined) fields.push({ label: "响应耗时", value: `${row.durationMs} 毫秒` });
  if (row.timeToFirstOutputMs !== undefined) fields.push({ label: "首次输出耗时", value: `${row.timeToFirstOutputMs} 毫秒` });
  const first = record.sources.find((source) => source.kind === "model" && source.outputKind);
  if (first?.kind === "model" && first.outputKind) fields.push({ label: "首次输出类型", value: observabilityLabel(first.outputKind) });
  return fields.length > 0 ? { key: "model", fields } : undefined;
}
