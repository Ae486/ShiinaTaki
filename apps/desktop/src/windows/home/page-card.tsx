/**
 * INPUT:  a card title + children, or a list of label/value rows.
 * OUTPUT: <PageCard> and <LabeledRows> — the two layout primitives the settings-family pages share.
 * POS:    ui/windows/home — shared page chrome, so a page component stays its own content and nothing re-declares the
 *         card/definition-list markup. Purely presentational (the batch-5 style pass restyles here, once).
 */

import type { ReactNode } from "react";

export interface LabeledRow {
  label: string;
  value: string;
}

export function PageCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-xs font-semibold text-slate-700">{title}</h2>
      {children}
    </section>
  );
}

export function LabeledRows({ rows, empty }: { rows: LabeledRow[]; empty?: string }) {
  if (rows.length === 0) return empty === undefined ? null : <p className="text-xs text-slate-400">{empty}</p>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-slate-500">{row.label}</dt>
          <dd className="truncate text-slate-700">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
