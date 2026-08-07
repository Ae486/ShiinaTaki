/**
 * INPUT:  one costume list row's view model plus its three page-level flags (worn / mid-switch / how to act on it).
 * OUTPUT: <CostumeRow> — the picker row, including the mid-switch shape: a busy indicator and an inline Cancel.
 * POS:    ui/windows/home/pages/costume — presentational. The mid-switch row is what makes a wedged switch visible and
 *         escapable (manual check #75); the accent marks the costume the PET confirmed, never the one just clicked (#74).
 */

import { ActionButton } from "../../action-button.tsx";
import { Badge } from "../../badge.tsx";
import type { CostumeRowView } from "./costume-view.ts";

export interface CostumeRowProps {
  row: CostumeRowView;
  current: boolean;
  pending: boolean;
  onSelect: () => void;
  onCancel: () => void;
}

const ROW = "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors";

export function CostumeRow({ row, current, pending, onSelect, onCancel }: CostumeRowProps) {
  if (pending) {
    return (
      <div className={`${ROW} bg-slate-100 text-slate-600`}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
          <span className="truncate font-medium">{row.id}</span>
          <span className="shrink-0 text-slate-400">切换中…</span>
        </span>
        <ActionButton onClick={onCancel}>取消</ActionButton>
      </div>
    );
  }

  const tone = current ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200/70" : "text-slate-600 hover:bg-slate-50";
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!row.renderable}
      aria-current={current ? "true" : undefined}
      className={`${ROW} ${tone} disabled:opacity-40`}
    >
      <span className="truncate font-medium">{row.id}</span>
      {row.badge && <Badge tone="warn">{row.badge}</Badge>}
    </button>
  );
}
