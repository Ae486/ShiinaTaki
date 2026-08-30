/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <CopyIcon> — two overlapping sheets (copy-diagnostic affordances on inspector rows).
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function CopyIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      {/* Front sheet. */}
      <rect x="9" y="9" width="11" height="11" rx="2" />
      {/* Back sheet peeking out top-left. */}
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </Glyph>
  );
}
