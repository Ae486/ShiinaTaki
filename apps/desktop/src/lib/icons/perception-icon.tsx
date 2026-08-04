/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <PerceptionIcon> — an eye (observation + its privacy controls).
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function PerceptionIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.9 12c2.1-3.6 5.1-5.4 9.1-5.4s7 1.8 9.1 5.4c-2.1 3.6-5.1 5.4-9.1 5.4S5 15.6 2.9 12Z" />
      <circle cx="12" cy="12" r="2.7" />
    </Glyph>
  );
}
