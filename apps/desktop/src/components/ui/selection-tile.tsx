/**
 * INPUT:  selected/onSelect (+ disabled) plus the tile's layout, state attribute and emphasis variants.
 * OUTPUT: <SelectionTile> — the ONE selectable-row/tile recipe: selected = accent-soft fill + accent text +
 *         accent ring, idle = body text with a muted hover. stateAttr picks aria-pressed (toggle-like tiles)
 *         or aria-current ("this is the active one" rows).
 * POS:    ui/components — shared primitive (batch-2 C4). Every selection surface (nav, monitor tiles,
 *         permission levels, costume rows, KindPicker) renders through here so the recipes cannot drift again.
 */

import type { ReactNode } from "react";

export type TileLayout = "block" | "row";
export type TileStateAttr = "aria-pressed" | "aria-current";
export type TileEmphasis = "ring" | "border";

const BASE =
  "w-full rounded-lg px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40";

const LAYOUT: Record<TileLayout, string> = {
  block: "",
  row: "flex items-center",
};

const SELECTED: Record<TileEmphasis, string> = {
  ring: "bg-accent-soft text-accent-text ring-1 ring-accent-border",
  border: "border border-accent-border-strong bg-accent-soft text-accent-text",
};

const IDLE: Record<TileEmphasis, string> = {
  // ring-transparent keeps the ring variant layout-stable between idle and selected.
  ring: "ring-1 ring-transparent text-text-body hover:bg-surface-muted",
  border: "border border-border text-text-body hover:bg-surface-muted",
};

export interface SelectionTileProps {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  layout?: TileLayout;
  stateAttr?: TileStateAttr;
  emphasis?: TileEmphasis;
  /** Content + per-adopter extras (gap/text size/justify) — padding, radius and state stay owned here. */
  children: ReactNode;
  className?: string;
}

export function SelectionTile({
  selected,
  onSelect,
  disabled,
  layout = "block",
  stateAttr = "aria-pressed",
  emphasis = "ring",
  children,
  className,
}: SelectionTileProps) {
  const stateProps =
    stateAttr === "aria-pressed"
      ? { "aria-pressed": selected }
      : { "aria-current": selected ? ("true" as const) : undefined };
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      {...stateProps}
      className={`${BASE} ${LAYOUT[layout]} ${selected ? SELECTED[emphasis] : IDLE[emphasis]} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
