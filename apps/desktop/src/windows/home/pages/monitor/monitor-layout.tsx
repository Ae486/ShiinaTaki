/**
 * INPUT:  temporary Inspector selection/content plus local pane width and close actions
 * OUTPUT: conditional resizable side Inspector and the narrow closable drawer, with synchronized occupied space
 * POS:    ui/monitor — DSH Table Inspector adaptation; see third-party-notices.md (DeepSeek MIT)
 */
import { useEffect, useRef, type CSSProperties } from "react";
import type { TrajectoryInspector } from "@taki/shared";
import type { TrajectoryRecord } from "./trajectory-records.ts";
import { InspectorFields } from "./monitor-view.tsx";
import { useInspectorResize, INSPECTOR_WIDTH_MAX, INSPECTOR_WIDTH_MIN } from "./use-inspector-resize.ts";
import css from "./monitor-inspector.module.css";

interface InspectorActions {
  close(): void;
  resize(width: number): void;
  resizing(active: boolean): void;
}
export interface InspectorPaneProps {
  open: boolean;
  active: boolean;
  content: { inspector?: TrajectoryInspector; record?: TrajectoryRecord; loading: boolean; error: string | null; rowKey?: string };
  width: number;
  resizing: boolean;
  actions: InspectorActions;
}

export function InspectorPane(props: InspectorPaneProps) {
  return <div className={css.slot} data-open={props.open} data-resizing={props.resizing}
    inert={!props.open} aria-hidden={!props.open} style={{ "--inspector-width": `${props.width}px` } as CSSProperties}>
    {props.open && <OpenInspector {...props} />}
  </div>;
}

function OpenInspector(props: InspectorPaneProps) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(props.actions.close);
  close.current = props.actions.close;
  const resize = useInspectorResize({ width: props.width, change: props.actions.resize, resizing: props.actions.resizing, active: props.active });
  useEffect(() => {
    const previous = document.activeElement;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close.current(); } };
    const pane = ref.current;
    pane?.addEventListener("keydown", escape);
    return () => {
      pane?.removeEventListener("keydown", escape);
      if (previous instanceof HTMLElement && previous.isConnected && !previous.closest("[hidden], [inert]")) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);
  return <aside ref={ref} className={css.details} aria-label="记录详情">
    <div role="separator" aria-orientation="vertical" aria-label="调整详情宽度" tabIndex={0}
      aria-valuemin={INSPECTOR_WIDTH_MIN} aria-valuemax={INSPECTOR_WIDTH_MAX} aria-valuenow={props.width}
      className={css.resize} {...resize} />
    <div className={css.header}><h2 className={css.title}>{props.content.record?.name ?? props.content.inspector?.title ?? "记录详情"}</h2>
      <button type="button" className={css.close} aria-label="关闭详情" onClick={props.actions.close}>×</button>
    </div>
    {props.content.loading && <p className={css.pending} role="status">正在读取详情…</p>}
    {props.content.error && <p className={css.error} role="alert">{props.content.error}</p>}
    {props.content.inspector && <InspectorFields key={props.content.rowKey} inspector={props.content.inspector} record={props.content.record} />}
    {props.content.inspector && <p className={css.notice}>{props.content.inspector.redactionNotice}</p>}
  </aside>;
}
