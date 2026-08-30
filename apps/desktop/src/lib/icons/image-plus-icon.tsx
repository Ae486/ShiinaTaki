/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <ImagePlusIcon> — an image frame with a landscape (the composer attach affordance;
 *         promoted from the composer's inline SVG).
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function ImagePlusIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </Glyph>
  );
}
