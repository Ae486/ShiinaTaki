/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <HomeIcon> — a house with a door.
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function HomeIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M3.6 11.3 12 4.4l8.4 6.9" />
      <path d="M5.9 9.9v8.6a1.5 1.5 0 0 0 1.5 1.5h9.2a1.5 1.5 0 0 0 1.5-1.5V9.9" />
      <path d="M9.9 20v-4.4h4.2V20" />
    </Glyph>
  );
}
