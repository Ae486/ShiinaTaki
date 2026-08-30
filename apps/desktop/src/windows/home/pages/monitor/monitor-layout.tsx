/**
 * INPUT:  the run browser / ledger / inspector ReactNode slots plus the inspector's width state (page memory).
 * OUTPUT: the L1 DSH-shaped three-zone scaffold — browser | ledger as the shared MasterDetail row, with the inspector
 *         as an on-demand right column that stacks inline (browser → ledger → inspector) under a narrow container.
 * POS:    ui/windows/home/pages/monitor — presentation layout only; selection/inspector keys and generation guards
 *         stay in the controller. No filters, aggregates or metrics beyond the current projections.
 */

import { useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { TrajectoryInspector } from "@taki/shared";
import { MasterDetail } from "@/components/ui/master-detail.js";
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";
import { InspectorFields } from "./monitor-view.tsx";

// Inspector width is adjustable between these bounds when it sits beside the ledger (DSH uses a wider 320-720;
// the home window's 900x800 frame is served by the narrower clamp — a larger window can widen the constant).
export const INSPECTOR_WIDTH_MIN = 320;
export const INSPECTOR_WIDTH_MAX = 440;
export const INSPECTOR_WIDTH_DEFAULT = 360;

const clampWidth = (width: number): number =>
  Math.min(INSPECTOR_WIDTH_MAX, Math.max(INSPECTOR_WIDTH_MIN, width));

export function MonitorThreeZones({ browser, ledger, inspector }: {
  browser: ReactNode;
  ledger: ReactNode;
  inspector: ReactNode;
}) {
  return (
    <MasterDetail
      list={browser}
      detail={
        // Inner container query: the inspector joins the ledger as a right column only when the detail column is
        // wide enough (@3xl); below that it stacks after the ledger — an inline section, never a modal.
        <div className="@container flex flex-col gap-4 @3xl:flex-row @3xl:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-4">{ledger}</div>
          {inspector}
        </div>
      }
    />
  );
}

/** The inspector pane: closable, width-adjustable when side-by-side, full-width inline section when stacked.
 *  Width rides page memory only (survives close/reopen, resets with the page). */
export function InspectorPane({ inspector, width, onWidthChange, onClose }: {
  inspector: TrajectoryInspector;
  width: number;
  onWidthChange(next: number): void;
  onClose(): void;
}) {
  return (
    <aside
      className="relative w-full min-w-0 @3xl:w-(--inspector-w) @3xl:shrink-0"
      style={{ "--inspector-w": `${width}px` } as CSSProperties}
    >
      <ResizeDivider width={width} onWidthChange={onWidthChange} />
      <PageCard title={`开发检查器 · ${inspector.title}`} action={<ActionButton tone="ghost" onClick={onClose}>关闭</ActionButton>}>
        <p className="mb-3 text-xs text-text-secondary">{inspector.redactionNotice}</p>
        <InspectorFields inspector={inspector} />
      </PageCard>
    </aside>
  );
}

/** The inspector's left-edge drag handle, active only in the side-by-side row (stacked mode is full-width).
 *  Pointer-capture drag plus the separator keyboard contract (arrow keys step the width) keep it reachable. */
function ResizeDivider({ width, onWidthChange }: { width: number; onWidthChange(next: number): void }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    start.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    onWidthChange(clampWidth(start.current.width + start.current.x - event.clientX));
  };
  const endDrag = () => { start.current = null; };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowLeft" ? -24 : event.key === "ArrowRight" ? 24 : 0;
    if (step === 0) return;
    event.preventDefault();
    onWidthChange(clampWidth(width + step));
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整检查器宽度"
      aria-valuemin={INSPECTOR_WIDTH_MIN}
      aria-valuemax={INSPECTOR_WIDTH_MAX}
      aria-valuenow={width}
      tabIndex={0}
      className="absolute top-0 bottom-0 -left-2.5 hidden w-2.5 cursor-col-resize touch-none @3xl:block"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <span className="absolute top-1/2 left-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-border-strong" />
    </div>
  );
}
