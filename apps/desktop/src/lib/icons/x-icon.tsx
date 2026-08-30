/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <XIcon> — an X/close cross (dialog close, toast dismiss, thumbnail remove).
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function XIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </Glyph>
  );
}
