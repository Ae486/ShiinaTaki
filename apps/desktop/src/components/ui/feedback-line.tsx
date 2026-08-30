/**
 * INPUT:  a tone (danger/warn/ok/info), the message, and an optional inline action (the retry affordance).
 * OUTPUT: <FeedbackLine> — the ONE inline outcome line: danger renders role="alert", every other tone
 *         role="status"; the action renders as an inline ghost button (ErrorState-with-retry = danger + action).
 * POS:    ui/components — shared primitive (batch-2 C4/A8). Absorbs PageAlert internals, the bare coloured
 *         notice <p>s, and the MCP three-tone banner; failed reads gain their retry through `action`.
 */

import type { ReactNode } from "react";

export type FeedbackTone = "danger" | "warn" | "ok" | "info";

export interface FeedbackAction {
  label: string;
  onClick: () => void;
}

const TONE: Record<FeedbackTone, string> = {
  danger: "bg-danger-soft text-danger-strong ring-1 ring-danger-border/60",
  warn: "bg-warn-soft text-warn-strong ring-1 ring-warn-border/70",
  ok: "bg-ok-soft text-ok-strong ring-1 ring-ok-border/70",
  info: "bg-surface-sunken text-text-body ring-1 ring-border-subtle",
};

export interface FeedbackLineProps {
  tone: FeedbackTone;
  action?: FeedbackAction;
  children: ReactNode;
}

export function FeedbackLine({ tone, action, children }: FeedbackLineProps) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${TONE[tone]}`}>
      <span className="min-w-0">{children}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium underline-offset-2 hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
