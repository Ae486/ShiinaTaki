/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <ImageOffIcon> — a slashed image frame (the expired-attachment placeholder: the bytes are
 *         gone, the text description stays authoritative).
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function ImageOffIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
      <path d="M3 3l18 18" />
    </Glyph>
  );
}
