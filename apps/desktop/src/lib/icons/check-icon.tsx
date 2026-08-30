/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <CheckIcon> — a single confirm stroke (transient copied feedback).
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function CheckIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M5 13l4 4L19 7" />
    </Glyph>
  );
}
