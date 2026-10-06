/**
 * INPUT: exact previous/final native payloads and the actual captured Local unit
 * OUTPUT: Local bookkeeping preserved only where native producer evidence proves no later change
 * POS: core/memory/transitions — clocks are values, never ownership or mutation-order proof
 */
import type { CanonicalMemoryUnit, HindsightSnapshotRecordWire } from "@taki/shared";
import { transitionLocalHash } from "./transition-local-encoding.ts";

export function preserveTransitionLocalTimestamps(input: { unit: CanonicalMemoryUnit; original: CanonicalMemoryUnit;
  before: HindsightSnapshotRecordWire | undefined; final: HindsightSnapshotRecordWire | undefined; reused: boolean }): void {
  const { unit, original, before, final } = input;
  if (!input.reused || !before || !final) return;
  const ignored = ["revision", "updated_at", "edited_at", "consolidated_at", "consolidation_failed_at"];
  const content = (row: HindsightSnapshotRecordWire) => Object.fromEntries(Object.entries(row.payload).filter(([key]) => !ignored.includes(key)));
  if (transitionLocalHash(content(before)) !== transitionLocalHash(content(final))) return;
  // A maintenance consolidation outcome owns its own fields. It does not undo
  // a policy-only Local edit unless the corresponding native writer changed
  // the edit field (or actual content/lifecycle), even under clock skew.
  if (before.payload.updated_at === final.payload.updated_at) unit.updatedAt = original.updatedAt;
  if (before.payload.edited_at === final.payload.edited_at) unit.editedAt = original.editedAt;
}
