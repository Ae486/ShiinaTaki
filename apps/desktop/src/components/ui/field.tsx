/**
 * INPUT:  a visible label (+ optional hint / invalid flag) and ONE control as children.
 * OUTPUT: <Field> — the labelled-control row: an explicit htmlFor/id pair (the id is generated here and
 *         injected into the control), hint wired via aria-describedby, invalid wired via aria-invalid,
 *         and the tokenized control class every editor field shares.
 * POS:    ui/components — shared primitive (batch-2 C4). Fixes the near-invisible MCP editor ring and the
 *         unassociated env/header pair; the keyboard focus ring itself is the global :focus-visible rule.
 */

import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

/** The control class adopters put on the input/select/textarea inside a Field. */
export const FIELD_CONTROL =
  "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text-body focus:border-accent-border-strong" +
  " disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-faint";

export interface FieldProps {
  label: string;
  hint?: string;
  invalid?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, invalid, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const child = Children.only(children);
  const control = isValidElement(child)
    ? cloneElement(child as ReactElement<Record<string, unknown>>, {
        id,
        "aria-invalid": invalid || undefined,
        "aria-describedby": hint ? hintId : undefined,
      })
    : child;
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs font-medium text-text-secondary">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-text-secondary">
          {hint}
        </p>
      )}
      {control}
    </div>
  );
}
