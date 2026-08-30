/**
 * INPUT:  a tone + the badge text.
 * OUTPUT: <Badge> — the small status chip the pages label rows with (restart-to-apply, env-locked, set/unset…).
 * POS:    ui/windows/home — the one badge look, so a tone always means the same thing: warn = needs the operator's
 *         attention, ok = already in effect, neutral/muted = a plain fact about the row. Small text rides the
 *         token scale (xs = 12px absorbs the old 10px; batch-2 §1).
 */

import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "warn" | "ok" | "muted";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-text-body ring-border/70",
  warn: "bg-warn-soft text-warn-strong ring-warn-border/70",
  ok: "bg-ok-soft text-ok-strong ring-ok-border/70",
  muted: "bg-surface text-text-faint ring-border/70",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${TONE[tone]}`}>{children}</span>
  );
}
