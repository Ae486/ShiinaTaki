/**
 * INPUT: a Shared Pattern definition and optional previously effective definition.
 * OUTPUT: complete semantic review fields and explicit before/after differences.
 * POS: reusable Desktop review content; no IDs, CAS versions or raw metadata disclosures.
 */
import type { InteractionPatternDefinition } from "@taki/shared";
import { CONTEXT_LABELS, OUTCOME_LABELS, describeCondition, readablePatternDate } from "./pattern-labels.ts";

export function definitionRows(definition: InteractionPatternDefinition) {
  return [
    { label: "名称", value: definition.title },
    { label: "目的", value: definition.purpose },
    { label: "同时满足的条件", value: definition.conditions.all.map(describeCondition).join("；") },
    { label: "可参考的信息", value: definition.contextSelectors.map((key) => CONTEXT_LABELS[key]).join("、") || "不额外选择信息" },
    { label: "允许的回应", value: definition.allowedOutcomes.map((key) => OUTCOME_LABELS[key]).join("、") },
    { label: "考虑互动的最短间隔", value: `${definition.timing.minimumGapMinutes} 分钟（包括保持安静的判断）` },
    { label: "每次符合条件的机会", value: `${Math.round(definition.timing.chance * 10000) / 100}% 概率考虑互动；等待不会重复抽取` },
    { label: "有效期", value: `${readablePatternDate(definition.lifetime.startsAt, "确认后开始")} → ${readablePatternDate(definition.lifetime.expiresAt, "不设结束时间")}` },
  ];
}

export function PatternDefinitionView({ definition, previous }: { definition: InteractionPatternDefinition; previous?: InteractionPatternDefinition }) {
  const before = previous ? definitionRows(previous) : [];
  return <dl className="space-y-3 text-sm">
    {definitionRows(definition).map((row, index) => <div key={row.label}>
      <dt className="text-xs text-text-secondary">{row.label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-text-strong">{row.value}</dd>
      {before[index] && before[index].value !== row.value && <dd className="mt-1 text-xs text-text-secondary">原来：{before[index].value}</dd>}
    </div>)}
  </dl>;
}
