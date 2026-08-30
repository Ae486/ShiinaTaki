/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <AlertTriangleIcon> — a warning triangle with an exclamation (empty/error state headers).
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function AlertTriangleIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      {/* Triangle: flat base, apex top-centre (stroke joins round the corners). */}
      <path d="M12 4.5 21 19.5H3Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </Glyph>
  );
}
