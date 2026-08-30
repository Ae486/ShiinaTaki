/**
 * INPUT:  a page's title (+ an optional hint line and a background-refresh flag), its body content, or one failure message
 *         (+ an optional retry action).
 * OUTPUT: <PageHeader>, <PageBody> and <PageAlert> — the frame every home page renders inside: one header bar, one
 *         scrolling width-capped content column, and one look for "this page could not read/do something" (a
 *         FeedbackLine in the danger tone — A8: role=alert, inline retry action).
 * POS:    ui/windows/home — shared page frame, declared once so pages differ in content only. Purely presentational;
 *         the chat page opts out of PageBody because its timeline owns the scroll.
 */

import type { ReactNode } from "react";
import { FeedbackLine, type FeedbackAction } from "@/components/ui/feedback-line.js";

export function PageHeader({ title, hint, busy }: { title: string; hint?: string; busy?: boolean }) {
  return (
    <header className="shrink-0 border-b border-border bg-surface px-6 py-3">
      <div className="flex items-baseline gap-2">
        <h1 className="text-md font-semibold text-text-strong">{title}</h1>
        {/* Cached content is shown immediately, so the operator must be able to see that a fresher answer is coming. */}
        {busy && <span className="text-xs text-text-faint">刷新中…</span>}
      </div>
      {hint && <p className="mt-0.5 text-xs leading-snug text-text-secondary">{hint}</p>}
    </header>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  // A8: tabIndex=0 makes the scroll column keyboard-scrollable (the global focus-visible rule shows the ring).
  return (
    <div tabIndex={0} className="min-h-0 flex-1 overflow-y-auto bg-surface-muted">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-5">{children}</div>
    </div>
  );
}

export function PageAlert({ children, action }: { children: ReactNode; action?: FeedbackAction }) {
  return (
    <FeedbackLine tone="danger" action={action}>
      {children}
    </FeedbackLine>
  );
}
