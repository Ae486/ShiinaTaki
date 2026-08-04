/**
 * INPUT:  a character.costumes result + the remembered last-worn costume.
 * OUTPUT: costumeListView(result, remembered) -> { rows (renderable first), missingPacks, current } — the page's model.
 * POS:    ui/windows/home/pages/costume — the node-testable core of the costume page. Same ordering/badging rules the
 *         retired pet-side panel used, kept pure so the page component stays presentational.
 */

import type { CharacterCostumesResult, CostumeAvailability } from "@taki/shared";

export interface CostumeRowView {
  id: string;
  /** false = the costume cannot render at all (its row is disabled under the import notice). */
  renderable: boolean;
  /** A degraded-but-wearable costume's missing-motion notice, or null. */
  badge: string | null;
}

export interface CostumeListView {
  rows: CostumeRowView[];
  /** The union of owners whose packs would unlock or complete costumes. */
  missingPacks: string[];
  current: string | null;
}

function badgeFor(meta: CostumeAvailability | undefined): string | null {
  return meta && meta.missingMotions > 0 ? `⚠ 缺 ${meta.missingMotions} 动作` : null;
}

export function costumeListView(result: CharacterCostumesResult, remembered: string | null): CostumeListView {
  const availability = result.availability ?? {};
  const rank = (id: string): number => (availability[id]?.renderable === false ? 1 : 0);
  const rows = [...result.costumes]
    .sort((a, b) => rank(a) - rank(b))
    .map((id) => ({ id, renderable: availability[id]?.renderable !== false, badge: badgeFor(availability[id]) }));
  return {
    rows,
    missingPacks: [...new Set(Object.values(availability).flatMap((entry) => entry.missingPacks))].sort(),
    // The highlight mirrors what the pet actually wears: the remembered costume, else the marker default (B7/B19).
    current: remembered !== null && result.costumes.includes(remembered) ? remembered : result.defaultCostume,
  };
}
