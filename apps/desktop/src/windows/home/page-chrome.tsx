/**
 * INPUT:  a page's title (+ an optional hint line and a background-refresh flag), its body content, or one failure message.
 * OUTPUT: <PageHeader>, <PageBody> and <PageAlert> — the frame every home page renders inside: one header bar, one
 *         scrolling width-capped content column, and one look for "this page could not read/do something".
 * POS:    ui/windows/home — shared page frame, declared once so pages differ in content only. Purely presentational;
 *         the chat page opts out of PageBody because its timeline owns the scroll.
 */

import type { ReactNode } from "react";

export function PageHeader({ title, hint, busy }: { title: string; hint?: string; busy?: boolean }) {
  return (
    <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-3">
      <div className="flex items-baseline gap-2">
        <h1 className="text-[15px] font-semibold text-slate-800">{title}</h1>
        {/* Cached content is shown immediately, so the operator must be able to see that a fresher answer is coming. */}
        {busy && <span className="text-[11px] text-slate-400">刷新中…</span>}
      </div>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</p>}
    </header>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-5">{children}</div>
    </div>
  );
}

export function PageAlert({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-100">{children}</p>
  );
}
