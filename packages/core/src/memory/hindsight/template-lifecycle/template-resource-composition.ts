/**
 * INPUT:  first captured resource definitions, selected template and full explicit user values
 * OUTPUT: exact-ID effective model/directive definitions with collision refusal
 * POS:    Core pure composition; a name never substitutes for captured directive UUID ownership
 */
import type { HindsightTemplateSnapshot } from "@taki/shared";
import type { TemplateEnrollment } from "./template-enrollment.ts";
import type { TemplateCatalogEntry } from "./template-catalog.ts";
import type { TemplateUserRevision } from "./template-overlay-schema.ts";
import type { TemplateProjection } from "./template-projection.ts";

export function composeTemplateResources(input: {
  enrollment: TemplateEnrollment; snapshot: HindsightTemplateSnapshot;
  template: TemplateCatalogEntry | null; user: TemplateUserRevision;
}): Pick<TemplateProjection, "models" | "directives"> {
  const models = input.snapshot.models.map((current) => {
    const base = input.enrollment.captures.flatMap((capture) => capture.snapshot.models).find((item) => item.id === current.id);
    if (!base) throw new Error("HINDSIGHT_TEMPLATE_CONFLICT");
    const template = input.template?.models.find((item) => item.id === current.id);
    const user = input.user.models.find((item) => item.id === current.id)?.choice;
    const definition = user?.mode === "value" ? user.value : user?.mode === "suppress" ? null : template ?? base.definition;
    return { id: current.id, definition: structuredClone(definition) };
  });
  const directives = input.snapshot.directives.map((current) => {
    const base = input.enrollment.captures.flatMap((capture) => capture.snapshot.directives).find((item) => item.id === current.id);
    if (!base || current.name_matches.some((id) => id !== current.id)) throw new Error("HINDSIGHT_TEMPLATE_CONFLICT");
    const template = input.template?.directives.find((item) => item.name === current.name);
    const user = input.user.directives.find((item) => item.id === current.id)?.choice;
    const contribution = template ? { ...template, id: current.id } : base.definition;
    const definition = user?.mode === "value" ? user.value : user?.mode === "suppress" ? null : contribution;
    return { id: current.id, name: current.name, definition: structuredClone(definition),
      name_matches: definition?.name === current.name ? [current.id] : [] };
  });
  return { models, directives };
}
