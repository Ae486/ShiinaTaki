/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <ToolIcon> — an open-end wrench (tool activity on a chat timeline row).
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function ToolIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      {/* Open-end jaw: the head arcs the long way round, leaving the top gap as the wrench mouth. */}
      <path d="M9 4.3a4.6 4.6 0 1 0 6 0" />
      {/* Handle: an outlined bar capped at the bottom, joined into the head. */}
      <path d="M10.7 12v7.2a1.3 1.3 0 0 0 2.6 0V12" />
    </Glyph>
  );
}
