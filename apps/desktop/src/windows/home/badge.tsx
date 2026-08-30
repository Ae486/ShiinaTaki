/**
 * INPUT:  a tone + the badge text.
 * OUTPUT: <Badge> — the small status chip the pages label rows with (restart-to-apply, env-locked, set/unset…).
 * POS:    ui/windows/home — the one badge look, so a tone always means the same thing: warn = needs the operator's
 *         attention, ok = already in effect, neutral/muted = a plain fact about the row.
 */

import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "warn" | "ok" | "muted";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-600 ring-slate-200/70",
  warn: "bg-warn-soft text-warn-strong ring-warn-border/70",
  ok: "bg-ok-soft text-ok-strong ring-ok-border/70",
  muted: "bg-white text-slate-400 ring-slate-200/70",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${TONE[tone]}`}>{children}</span>
  );
}
