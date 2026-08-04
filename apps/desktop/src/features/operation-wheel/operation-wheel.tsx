/**
 * INPUT:  the summon point (window-local px) plus the closers from the pet stage; the wheel item registry.
 * OUTPUT: <OperationWheel> — the radial shortcut wheel drawn at the right-click point, clamped on-window, dismissed
 *         by an outside click / Escape / blur; picking a row closes the wheel and runs that row's shortcut.
 * POS:    ui/features/operation-wheel — presentational; reaches the world only through WHEEL_ITEMS and the props.
 *         Carries the keep-interactive marker so the click-through poll leaves its own rect clickable. Neutral
 *         styling on purpose — icons + BANDORI-referenced polish land with the visual pass.
 */

import { useRef } from "react";
import type { CSSProperties } from "react";
import { KEEP_INTERACTIVE_ATTR } from "@/windows/pet/click-through-toggle.js";
import { WHEEL_ITEMS } from "./wheel-items.ts";
import { useWheelDismiss } from "./use-wheel-dismiss.ts";
import { placeWheel, WHEEL_SIZE_PX, type WheelPoint } from "./wheel-placement.ts";

const RING_RADIUS_PX = 62;

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
      className="pointer-events-auto absolute z-20"
      style={{ left: position.x, top: position.y, width: WHEEL_SIZE_PX, height: WHEEL_SIZE_PX }}
      // Keep wheel pointer events out of the pet drag/click seam (the host div behind it owns those handlers).
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {WHEEL_ITEMS.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          style={chipStyle(index, WHEEL_ITEMS.length)}
          onClick={() => {
            onClose();
            item.run();
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/95 px-3 py-1.5 text-xs text-slate-700 shadow-lg ring-1 ring-black/5 transition-colors hover:bg-rose-50 hover:text-rose-600"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
