/**
 * INPUT:  original stored label presence, current inherited labels and explicit group choices
 * OUTPUT: whole-field Native label replacement preserving unrelated groups and final inheritance
 * POS:    Core pure composition; entity free-form behavior is outside this selector and stays untouched
 */
import { HindsightTemplateLabelsSchema, type HindsightTemplatePresence,
  type HindsightTemplateLabelGroup, type HindsightTemplateSnapshot } from "@taki/shared";
import { type TemplateUserRevision } from "./template-overlay-schema.ts";
import { templateEqual } from "./template-integrity.ts";

export function composeTemplateLabels(input: {
  base: HindsightTemplateSnapshot["config"][number];
  inherited: HindsightTemplateSnapshot["config"][number]["inherited"];
  template: HindsightTemplateLabelGroup | null; user: TemplateUserRevision["labels"];
}): HindsightTemplatePresence {
  const original = input.base.stored;
  const baseValue = HindsightTemplateLabelsSchema.parse(original.kind === "value" ? original.value : input.inherited);
  const baseGroups = groups(baseValue); let result = [...baseGroups];
  if (input.template) result = replaceGroup(result, input.template.key, input.template);
  for (const item of input.user) {
    if (item.choice.mode === "value") result = replaceGroup(result, item.key, item.choice.value);
    if (item.choice.mode === "suppress") result = replaceGroup(result, item.key, null);
  }
  // Equal explicit user values still remain in their immutable revision. Only the
  // physical Bank override may collapse when there is no semantic group difference.
  if (!input.template && input.user.every((item) => item.choice.mode === "inherit")
    && templateEqual(result, baseGroups)) return structuredClone(original);
  const value = baseValue !== null && !Array.isArray(baseValue) ? { attributes: result } : result;
  HindsightTemplateLabelsSchema.parse(value);
  return { kind: "value", value };
}

function groups(value: ReturnType<typeof HindsightTemplateLabelsSchema.parse>): HindsightTemplateLabelGroup[] {
  return value === null ? [] : Array.isArray(value) ? value : value.attributes;
}
function replaceGroup(groups: HindsightTemplateLabelGroup[], key: string, value: HindsightTemplateLabelGroup | null): HindsightTemplateLabelGroup[] {
  const index = groups.findIndex((item) => item.key === key);
  if (index < 0) return value ? [...groups, value] : groups;
  return value ? groups.map((item, position) => position === index ? value : item) : groups.filter((item) => item.key !== key);
}
