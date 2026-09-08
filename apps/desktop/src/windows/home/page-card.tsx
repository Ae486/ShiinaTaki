/**
 * INPUT:  card content and label/value rows with optional stable internal identities.
 * OUTPUT: PageCard, LabeledRows and the common CARD_ROW spacing token.
 * POS:    ui/home — presentation primitives; row identity can survive label changes without becoming visible metadata.
 */

import type { ReactNode } from "react";

/** Batch-2 §1: knob rows and permission rows normalize onto this single card-content row padding. */
export const CARD_ROW = "px-5 py-3.5";

export interface LabeledRow {
  /** Internal stable identity for rows whose presentation label/position can change. Never rendered as content. */
  id?: string;
  label: string;
  value: string;
}

export function PageCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-strong">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function LabeledRows({ rows, empty }: { rows: LabeledRow[]; empty?: string }) {
  if (rows.length === 0) return empty === undefined ? null : <p className="text-xs text-text-secondary">{empty}</p>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
      {rows.map((row) => (
        <div key={row.id ?? row.label} className="contents">
          <dt className="text-text-secondary">{row.label}</dt>
          <dd className="min-w-0 truncate font-medium text-text-body">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
