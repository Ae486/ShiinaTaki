/**
 * INPUT:  verified Native snapshots or a composed complete definition projection
 * OUTPUT: normalized definition-only state, independently of generated model content/history
 * POS:    Core preview/readback comparison; deletion still uses the complete Native deletion proof
 */
import { z } from "zod";
import { HindsightTemplateSnapshotSchema, normalizeHindsightTemplateSnapshot,
  type HindsightTemplateSnapshot } from "@taki/shared";
import { templateHash } from "./template-integrity.ts";

// Copy the Shared fields into the distinct projection schema: its objects have no
// Native proofs, so the wire proof/definition pairing refinement does not apply.
export const TemplateProjectionSchema = z.strictObject(HindsightTemplateSnapshotSchema.shape).omit({ snapshot_hash: true }).extend({
  models: z.array(z.strictObject(HindsightTemplateSnapshotSchema.shape.models.element.shape).omit({ proof: true })).max(64),
  directives: z.array(z.strictObject(HindsightTemplateSnapshotSchema.shape.directives.element.shape).omit({ proof: true })).max(64),
});
export type TemplateProjection = z.infer<typeof TemplateProjectionSchema>;

export function projectTemplateSnapshot(snapshot: HindsightTemplateSnapshot): TemplateProjection {
  const value = normalizeHindsightTemplateSnapshot(snapshot);
  return TemplateProjectionSchema.parse({ contract_version: value.contract_version, target: value.target,
    selectors: value.selectors, config: value.config,
    models: value.models.map(({ id, definition }) => ({ id, definition })),
    directives: value.directives.map(({ id, name, definition, name_matches }) => ({ id, name, definition, name_matches })),
  });
}
export function templateProjectionDigest(projection: TemplateProjection): string {
  return templateHash("definition", TemplateProjectionSchema.parse(projection));
}
