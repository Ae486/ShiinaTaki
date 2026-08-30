/**
 * INPUT:  a label + the technical value (+ mono / compact variants).
 * OUTPUT: <CopyableRow> — the ONE copy-diagnostic row for opaque identifiers: min-w-0 + truncate so long
 *         values never blow the layout, an aria-labelled copy control, and a transient check-icon
 *         confirmation on success (clipboard rejection leaves the copy icon, the visible failure signal).
 * POS:    ui/components — shared primitive (batch-2 C4/U4). Adopters: monitor inspector technical fields,
 *         Skills 哈希/Owner/修订 rows, the extension-convergence shortId (compact). MCP cards wait for batch 4.
 */

import { useRef, useState } from "react";
import { CheckIcon } from "@/lib/icons/check-icon.js";
import { CopyIcon } from "@/lib/icons/copy-icon.js";

export interface CopyableRowProps {
  label: string;
  value: string;
  mono?: boolean;
  /** Border-less one-line shape (label + value side by side) for status strips. */
  compact?: boolean;
  /** What the copy control writes (defaults to value) — lets a short display carry the full id. */
  copyValue?: string;
  className?: string;
}

export function CopyableRow({ label, value, mono, compact, copyValue, className }: CopyableRowProps) {
  const [copied, setCopied] = useState(false);
  // The transient copied tick self-clears; the timer is DOM-bound and lives only while mounted.
  const timer = useRef<number | null>(null);
  const copy = () => {
    // Clipboard rejection (permissions/HTTPS-only API) must not surface as an unhandled rejection;
    // the check icon simply stays off, which IS the failure signal on this row.
    navigator.clipboard
      .writeText(copyValue ?? value)
      .then(() => {
        setCopied(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1_500);
      })
      .catch(() => undefined);
  };
  const copyButton = (
    <button
      type="button"
      onClick={copy}
      aria-label={`复制 ${label}`}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-strong"
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5 text-ok" /> : <CopyIcon className="h-3.5 w-3.5" />}
    </button>
  );

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
        <span className="shrink-0 text-text-secondary">{label}</span>
        <span className={`min-w-0 truncate text-text-body ${mono ? "font-mono" : ""}`}>{value}</span>
        {copyButton}
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-between gap-3 rounded-md border border-border-subtle px-2.5 py-1.5 ${className ?? ""}`}>
      <div className="min-w-0">
        {/* Spans, not dt/dd: the row renders standalone (no enclosing dl) and the label stays plain text. */}
        <span className="block text-text-secondary">{label}</span>
        <span className={`block truncate text-text-body ${mono ? "font-mono" : ""}`}>{value}</span>
      </div>
      {copyButton}
    </div>
  );
}
