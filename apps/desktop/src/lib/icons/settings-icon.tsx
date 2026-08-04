/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <SettingsIcon> — a hub ringed by eight teeth (the knobs page mark).
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function SettingsIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 6.4V3.6M12 17.6v2.8M6.4 12H3.6M17.6 12h2.8" />
      <path d="M8.04 8.04 6.06 6.06M15.96 15.96l1.98 1.98M15.96 8.04l1.98-1.98M8.04 15.96l-1.98 1.98" />
    </Glyph>
  );
}
