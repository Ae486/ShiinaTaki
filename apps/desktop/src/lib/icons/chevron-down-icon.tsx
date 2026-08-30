/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <ChevronDownIcon> — a down chevron (two-way disclosure toggles; rotate for "up").
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="m6 9 6 6 6-6" />
    </Glyph>
  );
}
