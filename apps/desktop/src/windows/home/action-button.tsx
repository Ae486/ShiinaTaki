/**
 * INPUT:  a tone, the click handler and the label (plus the usual disabled flag, an optional pill shape,
 *         large size, and busy marker).
 * OUTPUT: <ActionButton> — the one button look the surfaces share: primary/secondary/ghost/link tones plus
 *         accent (the chat send family), danger-soft/danger; shape="pill" for the three send pills.
 * POS:    ui/windows/home — presentational. Base height is 32px (A7 hit target). `danger` is reserved for the
 *         irreversible confirm (the D46 attachment purge); everything that merely opens a destructive step
 *         uses `danger-soft`. The composer/bubble send pills ride tone="accent" + shape="pill".
 */

import type { ReactNode } from "react";
import { PendingIndicator } from "@/components/ui/pending-indicator.js";

export type ButtonTone = "primary" | "secondary" | "ghost" | "link" | "accent" | "danger" | "danger-soft";
export type ButtonShape = "square" | "pill";
export type ButtonSize = "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";

const SHAPE: Record<ButtonShape, string> = { square: "", pill: "rounded-full" };
const SIZE: Record<ButtonSize, string> = { md: "", lg: "px-4 py-2.5 text-sm" };

const TONE: Record<ButtonTone, string> = {
  primary: "bg-surface-strong text-white hover:bg-surface-strong/90",
  secondary: "border border-border bg-white text-text-body hover:bg-surface-muted",
  ghost: "text-text-body hover:bg-surface-sunken",
  link: "text-accent-text hover:text-accent-strong",
  accent: "bg-accent text-white hover:bg-accent-strong",
  danger: "bg-danger text-white hover:bg-danger-hover",
  "danger-soft": "border border-danger-border bg-white text-danger hover:bg-danger-soft",
};

export interface ActionButtonProps {
  tone?: ButtonTone;
  shape?: ButtonShape;
  size?: ButtonSize;
  disabled?: boolean;
  /** Actual pending work; keep the label stable and reserve the indicator slot for the control's lifetime. */
  busy?: boolean;
  "aria-expanded"?: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function ActionButton({ tone = "secondary", shape = "square", size = "md", disabled, busy, "aria-expanded": expanded, onClick, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-expanded={expanded}
      className={`${BASE} ${SHAPE[shape]} ${SIZE[size]} ${TONE[tone]}`}
    >
      {children}
      {busy !== undefined && <PendingIndicator active={busy} label="操作处理中" />}
    </button>
  );
}
