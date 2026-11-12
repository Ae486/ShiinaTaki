/**
 * INPUT:  a real pending signal and its accessible description.
 * OUTPUT: a fixed inline slot that reveals slow work without flashing for fast completions.
 * POS:    shared UI presentation only; its one-shot timer never delays data, changes authority or starts a read.
 */
import { useEffect, useState } from "react";

/** Presentation policy: fast operations need no visual interruption; their results still commit immediately. */
export const PENDING_INDICATOR_DELAY_MS = 250;

export interface PendingIndicatorProps {
  active: boolean;
  label: string;
  className?: string;
}

export function PendingIndicator({ active, label, className = "" }: PendingIndicatorProps) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) { setElapsed(false); return; }
    const timer = window.setTimeout(() => setElapsed(true), PENDING_INDICATOR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active]);
  const visible = active && elapsed;

  return (
    <span className={`inline-flex h-4 w-4 shrink-0 self-center items-center justify-center align-middle ${className}`} aria-busy={active || undefined}>
      {visible && (
        <span role="status" aria-label={label} title={label} className="inline-flex">
          <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="26 12" />
          </svg>
        </span>
      )}
    </span>
  );
}
