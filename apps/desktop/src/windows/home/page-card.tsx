/**
 * INPUT:  a card title + children, or a list of label/value rows.
 * OUTPUT: <PageCard> and <LabeledRows> — the two layout primitives the settings-family pages share.
 * POS:    ui/windows/home — shared page chrome, so a page component stays its own content and nothing re-declares the
 *         card/definition-list markup. Purely presentational: restyling every card is an edit here, not in the pages.
 */

import type { ReactNode } from "react";

export interface LabeledRow {
  label: string;
  value: string;
}

export function PageCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-[13px] font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

export function LabeledRows({ rows, empty }: { rows: LabeledRow[]; empty?: string }) {
  if (rows.length === 0) return empty === undefined ? null : <p className="text-xs text-slate-400">{empty}</p>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-slate-500">{row.label}</dt>
          <dd className="truncate font-medium text-slate-700">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
