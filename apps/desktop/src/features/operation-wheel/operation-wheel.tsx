/**
 * INPUT:  the summon point (window-local px) plus the closers from the pet stage; the wheel item registry.
 * OUTPUT: <OperationWheel> — the radial shortcut wheel drawn at the right-click point, clamped on-window, dismissed
 *         by an outside click / Escape / blur; picking a row closes the wheel and runs that row's shortcut.
 * POS:    ui/features/operation-wheel — presentational; reaches the world only through WHEEL_ITEMS and the props.
 *         Carries the keep-interactive marker so the click-through poll leaves its own rect clickable, and swallows
 *         its own right-clicks so the stage rule cannot re-place it under the cursor.
 */

import { useRef } from "react";
import type { CSSProperties } from "react";
import { KEEP_INTERACTIVE_ATTR } from "@/windows/pet/click-through-toggle.js";
import { WHEEL_ITEMS } from "./wheel-items.ts";
import { useWheelDismiss } from "./use-wheel-dismiss.ts";
import { suppressWheelSummon } from "./wheel-summon.ts";
import { placeWheel, WHEEL_SIZE_PX, type WheelPoint } from "./wheel-placement.ts";

// Ring radius + chip width are what WHEEL_SIZE_PX has to contain: 66 + half of a 56px chip leaves a ~10px margin.
const RING_RADIUS_PX = 66;

const CHIP_CLASS =
  "absolute flex w-14 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-2xl bg-white/95 px-1 py-2" +
  " text-[11px] text-slate-600 shadow-lg ring-1 ring-black/5 transition-colors hover:bg-rose-50 hover:text-rose-600";

// Rows sit on a ring starting at 12 o'clock, clockwise, so a row's angle only depends on its registry index.
function chipStyle(index: number, total: number): CSSProperties {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return {
    left: WHEEL_SIZE_PX / 2 + RING_RADIUS_PX * Math.cos(angle),
    top: WHEEL_SIZE_PX / 2 + RING_RADIUS_PX * Math.sin(angle),
  };
}

// The pet window fills the overlay, so its inner size IS the clamp box. Guarded for the static-render path.
function viewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY };
  return { width: window.innerWidth, height: window.innerHeight };
}

export interface OperationWheelProps {
  point: WheelPoint;
  onClose: () => void;
}

export function OperationWheel({ point, onClose }: OperationWheelProps) {
  const container = useRef<HTMLDivElement>(null);
  useWheelDismiss(container, onClose);
  const position = placeWheel(point, viewportSize());

  return (
    <div
      ref={container}
      role="menu"
      aria-label="操作轮盘"
      {...{ [KEEP_INTERACTIVE_ATTR]: "" }}
      className="pointer-events-auto absolute z-20 animate-wheel-appear"
      style={{ left: position.x, top: position.y, width: WHEEL_SIZE_PX, height: WHEEL_SIZE_PX }}
      // Keep wheel pointer events out of the pet drag/click seam (the host div behind it owns those handlers).
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onContextMenu={suppressWheelSummon}
    >
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 shadow"
      />
      {WHEEL_ITEMS.map((item, index) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            style={chipStyle(index, WHEEL_ITEMS.length)}
            onClick={() => {
              onClose();
              item.run();
            }}
            className={CHIP_CLASS}
          >
            <Icon className="h-5 w-5" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
