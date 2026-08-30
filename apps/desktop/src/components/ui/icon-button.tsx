/**
 * INPUT:  a required accessible label, the glyph children, and the size/tone variants.
 * OUTPUT: <IconButton> — the ONE glyph-button: 32px hit target by default (28px where the pet overlay
 *         constrains), ghost/solid/onDark tones, so icon-only controls are never unlabelled or unclickable.
 * POS:    ui/components — shared primitive (batch-2 C4/A7). Adopters: composer attach + thumbnail remove,
 *         chat-bubble open/close, toast dismiss, dialog close, CopyableRow.
 */

import type { ReactNode } from "react";

export type IconButtonSize = "sm" | "md";
export type IconButtonTone = "ghost" | "solid" | "onDark";

const SIZE: Record<IconButtonSize, string> = { sm: "h-7 w-7", md: "h-8 w-8" };

const TONE: Record<IconButtonTone, string> = {
  ghost: "text-text-secondary hover:bg-surface-sunken hover:text-text-strong",
  solid: "bg-surface-strong text-white hover:bg-surface-strong/90",
  onDark: "text-white/80 hover:bg-white/15 hover:text-white",
};

const BASE =
  "inline-flex items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40";

export interface IconButtonProps {
  /** Required: an icon-only button with no accessible name is an a11y defect, not a style choice. */
  label: string;
  onClick: () => void;
  children: ReactNode;
  size?: IconButtonSize;
  tone?: IconButtonTone;
  disabled?: boolean;
  className?: string;
}

export function IconButton({ label, onClick, children, size = "md", tone = "ghost", disabled, className }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`${BASE} ${SIZE[size]} ${TONE[tone]} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
