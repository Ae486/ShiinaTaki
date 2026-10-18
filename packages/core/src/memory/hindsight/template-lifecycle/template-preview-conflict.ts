/**
 * INPUT:  the authenticated Native snapshot used by one rejected B1 composition/enrollment
 * OUTPUT: bounded actionable before-images, including exact same-name directive candidates
 * POS:    preview-only conflict evidence — returning this object neither adopts resources nor persists a user choice
 */
import { HindsightTemplateSnapshotSchema, type HindsightTemplateSnapshot } from "@taki/shared";

export class TemplatePreviewConflict extends Error {
  readonly snapshot: HindsightTemplateSnapshot;
  constructor(snapshot: HindsightTemplateSnapshot) {
    super("MEMORY_TEMPLATE_CONFLICT");
    this.name = "TemplatePreviewConflict";
    this.snapshot = HindsightTemplateSnapshotSchema.parse(snapshot);
  }
}

export function withTemplatePreviewReview<T>(snapshot: HindsightTemplateSnapshot, compose: () => T): T {
  try { return compose(); }
  catch (cause) {
    if (cause instanceof Error && ["HINDSIGHT_TEMPLATE_CONFLICT", "HINDSIGHT_STATE_CONFLICT"].includes(cause.message)) {
      throw new TemplatePreviewConflict(snapshot);
    }
    throw cause;
  }
}
