/**
 * INPUT: unwrapped historical manage_interaction_pattern tool output.
 * OUTPUT: allow-listed semantic results while retaining full canonical payloads outside rendering.
 * POS: Desktop tool presentation adapter; internal revisions, IDs and command bindings never become text.
 */
import { InteractionPatternViewSchema, InteractionPatternRevisionSchema, InteractionPatternRefusalReasonSchema,
  type InteractionPatternView } from "@taki/shared";
import { PATTERN_REFUSALS, PATTERN_STATES, describeOrigin, readablePatternDate } from "./pattern-labels.ts";
import { definitionRows } from "./pattern-definition-view.tsx";

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describePattern(pattern: InteractionPatternView): string {
  const revision = pattern.candidateRevision ?? pattern.effectiveRevision;
  if (!revision) return `状态：${PATTERN_STATES[pattern.state]}`;
  return [`状态：${PATTERN_STATES[pattern.state]}${pattern.candidateRevision ? "；有待确认提案" : ""}`,
    `来源：${describeOrigin(revision.origin)}`, ...definitionRows(revision.definition).map((row) => `${row.label}：${row.value}`)].join("\n");
}

export function patternToolDetails(input: unknown): string {
  let value: unknown = input;
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return "互动规则操作已返回，请查看规则列表核对当前状态。"; } }
  const output = record(value);
  const refusal = InteractionPatternRefusalReasonSchema.safeParse(output?.reason);
  if (refusal.success) return PATTERN_REFUSALS[refusal.data];
  if (output?.code === "PATTERN_REFUSED") return "未更改互动规则，请重新查看当前状态或补充你的要求。";
  if (output?.pattern === null) return "未找到对应的互动规则。";
  const single = InteractionPatternViewSchema.safeParse(output?.pattern);
  if (single.success) return describePattern(single.data);
  const list = InteractionPatternViewSchema.array().max(100).safeParse(output?.patterns);
  if (list.success) return list.data.length ? list.data.map(describePattern).join("\n\n") : "还没有互动规则。";
  const history = InteractionPatternRevisionSchema.array().max(100).safeParse(output?.revisions);
  if (history.success) return history.data.length ? history.data.map((revision) => [
    `${revision.acceptedAt ? "已确认" : "未确认"} · ${readablePatternDate(revision.createdAt, "未知")}`,
    ...definitionRows(revision.definition).map((row) => `${row.label}：${row.value}`),
  ].join("\n")).join("\n\n") : "暂无修改历史。";
  return "互动规则操作已返回，请查看规则列表核对当前状态。";
}
