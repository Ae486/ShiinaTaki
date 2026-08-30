/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <ExternalLinkIcon> — an arrow leaving a box ("open the full chat page"; promoted from the
 *         chat-bubble inline SVG so the only entry to the full chat page can never render invisibly).
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function ExternalLinkIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M15 3h6v6" />
      <path d="m10 14 11-11" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Glyph>
  );
}
