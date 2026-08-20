/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <McpIcon> — a plug and cord (external MCP servers the lifecycle page manages).
 * POS:    ui/lib/icons — one self-drawn glyph per file; see chat-icon.tsx for the rule.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function McpIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M9 3v4M15 3v4" />
      <path d="M7.5 7h9v4a4.5 4.5 0 0 1-9 0V7Z" />
      <path d="M12 15.5v2.2a3 3 0 0 0 3 3h4.2" />
      <circle cx="20.6" cy="20.7" r="1.1" />
    </Glyph>
  );
}
