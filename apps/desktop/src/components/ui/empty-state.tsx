/**
 * INPUT:  a title (+ optional icon, hint and action slot).
 * OUTPUT: <EmptyState> — the ONE nothing-to-show block that replaces the bare empty <p>s: muted icon,
 *         title line, optional hint, optional action (usually an ActionButton).
 * POS:    ui/components — shared primitive (batch-2 C4/U5). Pages compose it inside their own cards so the
 *         card chrome stays theirs.
 */

import type { ReactNode } from "react";
import type { IconComponent } from "@/lib/icons/glyph.js";

export interface EmptyStateProps {
  icon?: IconComponent;
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
      {Icon && <Icon className="h-6 w-6 text-text-faint" />}
      <p className="text-sm text-text-secondary">{title}</p>
      {hint && <p className="max-w-sm text-xs leading-snug text-text-secondary">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
