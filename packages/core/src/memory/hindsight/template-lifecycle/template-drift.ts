/**
 * INPUT:  previous/current/desired definition projections and an explicitly reviewed user revision
 * OUTPUT: refusal unless every external Bank edit is retained as an explicit user choice
 * POS:    Core pure reconciliation guard; reviewing a hash alone never authorizes overwriting external edits
 */
import { HindsightTemplateLabelsSchema } from "@taki/shared";
import type { TemplateProjection } from "./template-projection.ts";
import type { TemplateUserRevision } from "./template-overlay-schema.ts";
import { templateEqual } from "./template-integrity.ts";

export function assertReviewedTemplateDrift(input: {
  previous: TemplateProjection; current: TemplateProjection; desired: TemplateProjection; user: TemplateUserRevision;
}): void {
  for (const current of input.current.config) {
    const previous = input.previous.config.find((item) => item.key === current.key);
    const desired = input.desired.config.find((item) => item.key === current.key);
    if (!previous || !desired || templateEqual(previous.stored, current.stored)) continue;
    if (current.key === "entity_labels") assertLabelDrift({ previous, current, desired, user: input.user });
    else if (!input.user.config.some((item) => item.key === current.key)
      || !templateEqual(current.stored, desired.stored)) conflict();
  }
  for (const kind of ["models", "directives"] as const) {
    for (const current of input.current[kind]) {
      const previous = input.previous[kind].find((item) => item.id === current.id);
      if (!previous || templateEqual(previous.definition, current.definition)) continue;
      const desired = input.desired[kind].find((item) => item.id === current.id);
      if (!input.user[kind].some((item) => item.id === current.id)
        || !desired || !templateEqual(desired.definition, current.definition)) conflict();
    }
  }
}

function assertLabelDrift(input: {
  previous: TemplateProjection["config"][number]; current: TemplateProjection["config"][number];
  desired: TemplateProjection["config"][number]; user: TemplateUserRevision;
}): void {
  const previous = labelGroups(input.previous); const current = labelGroups(input.current); const desired = labelGroups(input.desired);
  for (const key of new Set([...previous, ...current].map((item) => item.key))) {
    const old = previous.find((item) => item.key === key) ?? null; const actual = current.find((item) => item.key === key) ?? null;
    if (!templateEqual(old, actual) && (!input.user.labels.some((item) => item.key === key)
      || !templateEqual(actual, desired.find((item) => item.key === key) ?? null))) conflict();
  }
  const common = previous.map((item) => item.key).filter((key) => current.some((item) => item.key === key));
  const order = current.map((item) => item.key).filter((key) => common.includes(key));
  if (!templateEqual(common, order) && !templateEqual(current, desired)) conflict();
}
function labelGroups(entry: TemplateProjection["config"][number]) {
  const value = HindsightTemplateLabelsSchema.parse(entry.stored.kind === "value" ? entry.stored.value : entry.inherited);
  return value === null ? [] : Array.isArray(value) ? value : value.attributes;
}
function conflict(): never { throw new Error("HINDSIGHT_TEMPLATE_CONFLICT"); }
