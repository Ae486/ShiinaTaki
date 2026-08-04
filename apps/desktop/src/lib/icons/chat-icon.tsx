/**
 * INPUT:  an optional className (size + colour belong to the caller).
 * OUTPUT: <ChatIcon> — a speech bubble with two text lines.
 * POS:    ui/lib/icons — one self-drawn glyph per file (our own artwork, no icon dependency and no imported asset),
 *         so swapping in the owner's hand-drawn art is a single-file edit.
 */

import { Glyph, type IconProps } from "./glyph.tsx";

export function ChatIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M6 4.5h12a3 3 0 0 1 3 3v5.5a3 3 0 0 1-3 3h-5.3l-4 3.4V16H6a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3Z" />
      <path d="M7.5 9.4h9M7.5 12.4h5.5" />
    </Glyph>
  );
}
