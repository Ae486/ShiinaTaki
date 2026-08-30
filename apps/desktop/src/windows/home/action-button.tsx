/**
 * INPUT:  a tone, the click handler and the label (plus the usual disabled flag).
 * OUTPUT: <ActionButton> — the one button look the pages share, in the four tones the surfaces actually need.
 * POS:    ui/windows/home — presentational. `danger` is reserved for the irreversible confirm (the D46 attachment
 *         purge); everything that merely opens a destructive step uses `danger-soft`.
 */

import type { ReactNode } from "react";

export type ButtonTone = "primary" | "secondary" | "danger" | "danger-soft";

const BASE =
  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";

const TONE: Record<ButtonTone, string> = {
  primary: "bg-slate-800 text-white hover:bg-slate-700",
  secondary: "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
  danger: "bg-danger text-white hover:bg-danger-hover",
  "danger-soft": "border border-danger-border bg-white text-danger hover:bg-danger-soft",
};

export interface ActionButtonProps {
  tone?: ButtonTone;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function ActionButton({ tone = "secondary", disabled, onClick, children }: ActionButtonProps) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${BASE} ${TONE[tone]}`}>
      {children}
    </button>
  );
}
