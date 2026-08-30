/**
 * INPUT:  one costume list row's view model plus its three page-level flags (worn / mid-switch / how to act on it).
 * OUTPUT: <CostumeRow> — the picker row, including the mid-switch shape: a busy indicator and an inline Cancel.
 * POS:    ui/windows/home/pages/costume — presentational. The mid-switch row is what makes a wedged switch visible and
 *         escapable (manual check #75); the accent marks the costume the PET confirmed, never the one just clicked (#74).
 *         The selectable row rides SelectionTile (aria-current; batch-2 unified accent recipe).
 */

import { ActionButton } from "../../action-button.tsx";
import { Badge } from "../../badge.tsx";
import { SelectionTile } from "@/components/ui/selection-tile.js";
import type { CostumeRowView } from "./costume-view.ts";

export interface CostumeRowProps {
  row: CostumeRowView;
  current: boolean;
  pending: boolean;
  onSelect: () => void;
  onCancel: () => void;
}

export function CostumeRow({ row, current, pending, onSelect, onCancel }: CostumeRowProps) {
  if (pending) {
    return (
      <div className="flex w-full items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-left text-xs text-text-body">
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-text-secondary" />
          <span className="truncate font-medium">{row.id}</span>
          <span className="shrink-0 text-text-secondary">切换中…</span>
        </span>
        <ActionButton onClick={onCancel}>取消</ActionButton>
      </div>
    );
  }

  return (
    <SelectionTile
      selected={current}
      stateAttr="aria-current"
      layout="row"
      disabled={!row.renderable}
      onSelect={onSelect}
      className="justify-between gap-2 text-xs"
    >
      <span className="truncate font-medium">{row.id}</span>
      {row.badge && <Badge tone="warn">{row.badge}</Badge>}
    </SelectionTile>
  );
}
