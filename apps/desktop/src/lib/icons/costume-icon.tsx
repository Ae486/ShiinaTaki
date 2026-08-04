/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <CostumeIcon> — a clothes hanger.
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function CostumeIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M12 8.4V7.2a2 2 0 1 1 2-2" />
      <path d="M12 8.4 4.3 14.6a1.5 1.5 0 0 0 .93 2.68h13.54a1.5 1.5 0 0 0 .93-2.68L12 8.4Z" />
    </Glyph>
  );
}
