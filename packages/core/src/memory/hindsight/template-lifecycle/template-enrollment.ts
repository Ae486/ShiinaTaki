/**
 * INPUT:  exact canonical Bank identity and coherent reviewed Native before-images
 * OUTPUT: immutable enrollment captures and bounded selectors; no legacy ownership inference
 * POS:    Core pure ownership boundary; an absent before-image proves creation only with a later Native receipt
 */
import { z } from "zod";
import { HindsightTemplateSnapshotSchema, HindsightTemplateSelectorsSchema,
  normalizeHindsightTemplateSelectors, type HindsightTemplateSnapshot, type HindsightTemplateSelectors } from "@taki/shared";
import { TemplateBankIdentitySchema, type TemplateBankIdentity, type TemplateUserRevision } from "./template-overlay-schema.ts";
import { type TemplateCatalogEntry } from "./template-catalog.ts";
import { templateEqual, verifyTemplateSnapshot } from "./template-integrity.ts";

export const TemplateEnrollmentSchema = z.strictObject({
  revision: z.int().min(1), identity: TemplateBankIdentitySchema,
  captures: z.array(z.strictObject({ mode: z.enum(["fresh", "reviewed-existing"]), snapshot: HindsightTemplateSnapshotSchema })).min(1).max(132),
});
export type TemplateEnrollment = z.infer<typeof TemplateEnrollmentSchema>;

export function captureTemplateEnrollment(input: {
  identity: TemplateBankIdentity; snapshot: HindsightTemplateSnapshot;
  mode: "fresh" | "reviewed-existing" | "untracked"; reviewedSnapshotHash?: string;
  previous?: TemplateEnrollment;
}): TemplateEnrollment {
  const identity = TemplateBankIdentitySchema.parse(input.identity);
  const snapshot = verifyTemplateSnapshot(input.snapshot);
  if (!templateEqual(identity.target, snapshot.target)) refuse("HINDSIGHT_STATE_CONFLICT");
  if (input.mode === "untracked") refuse("HINDSIGHT_TEMPLATE_CONFLICT");
  if (input.mode === "reviewed-existing" && input.reviewedSnapshotHash !== snapshot.snapshot_hash) refuse("HINDSIGHT_TEMPLATE_CONFLICT");
  const previous = input.previous ? verifyTemplateEnrollment(input.previous) : null;
  if (previous && !templateEqual(previous.identity, identity)) refuse("HINDSIGHT_STATE_CONFLICT");
  const covered = previous ? enrollmentSelectors(previous) : { config_keys: [], model_ids: [], directives: [] };
  validateCapture(snapshot, input.mode, covered);
  const result = TemplateEnrollmentSchema.parse({ identity, revision: (previous?.revision ?? 0) + 1,
    captures: [...(previous?.captures ?? []), { mode: input.mode, snapshot }] });
  enrollmentSelectors(result);
  return result;
}

export function verifyTemplateEnrollment(input: TemplateEnrollment): TemplateEnrollment {
  const value = TemplateEnrollmentSchema.parse(input);
  if (value.revision !== value.captures.length) refuse("HINDSIGHT_RESPONSE_INVALID");
  const prefix: TemplateEnrollment = { ...value, captures: [] };
  for (const capture of value.captures) {
    verifyTemplateSnapshot(capture.snapshot);
    if (!templateEqual(capture.snapshot.target, value.identity.target)) refuse("HINDSIGHT_RESPONSE_INVALID");
    validateCapture(capture.snapshot, capture.mode, enrollmentSelectors(prefix));
    prefix.captures.push(capture);
  }
  enrollmentSelectors(value);
  return value;
}

function validateCapture(snapshot: HindsightTemplateSnapshot, mode: "fresh" | "reviewed-existing", covered: HindsightTemplateSelectors): void {
  const models = snapshot.models.filter((item) => !covered.model_ids.includes(item.id));
  const directives = snapshot.directives.filter((item) => !covered.directives.some((old) => old.id === item.id));
  const config = snapshot.config.filter((item) => !covered.config_keys.includes(item.key));
  if (directives.some((item) => item.name_matches.length > 1 || item.name_matches.some((id) => id !== item.id))) refuse("HINDSIGHT_TEMPLATE_CONFLICT");
  if (mode === "fresh" && (models.some((item) => item.definition !== null) || directives.some((item) => item.definition !== null)
    || config.some((item) => item.stored.kind === "value"))) refuse("HINDSIGHT_TEMPLATE_CONFLICT");
  if (!models.length && !directives.length && !config.length) refuse("HINDSIGHT_TEMPLATE_CONFLICT");
}

export function enrollmentSelectors(value: TemplateEnrollment): HindsightTemplateSelectors {
  const config = new Set<HindsightTemplateSelectors["config_keys"][number]>();
  const models = new Set<string>(); const directives = new Map<string, { id: string; name: string }>();
  for (const capture of value.captures) {
    capture.snapshot.selectors.config_keys.forEach((key) => config.add(key));
    capture.snapshot.selectors.model_ids.forEach((id) => models.add(id));
    for (const directive of capture.snapshot.selectors.directives) {
      const old = directives.get(directive.id);
      if (old && old.name !== directive.name) refuse("HINDSIGHT_TEMPLATE_CONFLICT");
      directives.set(directive.id, directive);
    }
  }
  return normalizeHindsightTemplateSelectors(HindsightTemplateSelectorsSchema.parse({
    config_keys: [...config], model_ids: [...models], directives: [...directives.values()],
  }));
}

/** Caller mints directive UUIDs before the first snapshot; name matching never chooses an existing UUID. */
export function selectTemplateResources(input: {
  template: TemplateCatalogEntry | null; user: TemplateUserRevision;
  directiveIds: { id: string; name: string }[]; enrollment?: TemplateEnrollment;
}): HindsightTemplateSelectors {
  const previous = input.enrollment ? enrollmentSelectors(input.enrollment) : { config_keys: [], model_ids: [], directives: [] };
  const config = new Set(previous.config_keys); const models = new Set(previous.model_ids);
  const directives = new Map(previous.directives.map((item) => [item.id, item]));
  for (const item of input.directiveIds) directives.set(item.id, item);
  input.user.directives.forEach(({ id, name }) => directives.set(id, { id, name }));
  input.user.config.forEach(({ key }) => config.add(key));
  input.user.models.forEach(({ id }) => models.add(id));
  if (input.user.labels.length || input.template) config.add("entity_labels");
  if (input.template) {
    for (const key of ["retain_mission", "observations_instructions", "reflect_mission"] as const) config.add(key);
    input.template.models.forEach(({ id }) => models.add(id));
    for (const item of input.template.directives) {
      if ([...directives.values()].filter(({ name }) => name === item.name).length !== 1) refuse("HINDSIGHT_TEMPLATE_CONFLICT");
    }
  }
  return normalizeHindsightTemplateSelectors(HindsightTemplateSelectorsSchema.parse({
    config_keys: [...config], model_ids: [...models], directives: [...directives.values()],
  }));
}
function refuse(code: string): never { throw new Error(code); }
