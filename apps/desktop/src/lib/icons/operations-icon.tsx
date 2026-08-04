/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <OperationsIcon> — three stacked layers (the memory/storage maintenance mark).
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function OperationsIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M12 3.4 3.8 7.5 12 11.6l8.2-4.1Z" />
      <path d="M3.8 11.9 12 16l8.2-4.1" />
      <path d="M3.8 16.3 12 20.4l8.2-4.1" />
    </Glyph>
  );
}
