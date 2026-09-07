/**
 * INPUT:  recorded Overview domain and local range/record-selection callbacks
 * OUTPUT: pointer-safe range selection, wheel zoom, right-drag pan, and cancellation cleanup
 * POS:    ui/monitor — DSH TrajectoryTimeline interaction adaptation; see third-party-notices.md (DeepSeek MIT)
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { orderedRange, panTimeline, timeAt, visibleDomain, zoomTimeline, type TimeRange, type TimelineModel } from "./trajectory-timing.ts";

interface Gesture {
  pointerId: number;
  button: number;
  x: number;
  time: number;
  domain: TimeRange;
  recordKey?: string;
  moved: boolean;
  pannable: boolean;
  target: HTMLDivElement;
}
interface OverviewActions {
  changeRange(range: TimeRange | null): void;
  selectRecord(key: string): void;
}

export function useOverviewGestures(model: TimelineModel | undefined, actions: OverviewActions, active = true) {
  const trackRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [viewport, setViewport] = useState<TimeRange | null>(null);
  const [draft, setDraft] = useState<TimeRange | null>(null);
  const [panning, setPanning] = useState(false);
  const domain = visibleDomain(model ?? { start: 0, end: 1 }, viewport);
  const cancel = (event?: { pointerId?: number }) => {
    if (event?.pointerId !== undefined && gesture.current?.pointerId !== event.pointerId) return;
    releaseGesture(gesture); setDraft(null); setPanning(false);
  };
  useOverviewWheel({ model: active ? model : undefined, domain, trackRef, setViewport });
  useEffect(() => { if (!active) cancel(); }, [active]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    const blur = () => cancel();
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", hidden);
    return () => { releaseGesture(gesture); window.removeEventListener("blur", blur); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  const context = { model: active ? model : undefined, domain, viewport, gesture, actions, setViewport, setDraft, setPanning };
  return {
    trackRef, domain, viewport, draft, panning,
    resetViewport: () => setViewport(null),
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => startGesture(context, event),
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => moveGesture(context, event),
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => endGesture(context, event),
    onPointerCancel: cancel, onLostPointerCapture: cancel,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => keyboardGesture(context, event),
  };
}

interface GestureContext {
  model: TimelineModel | undefined;
  domain: TimeRange;
  viewport: TimeRange | null;
  gesture: { current: Gesture | null };
  actions: OverviewActions;
  setViewport(value: TimeRange | null): void;
  setDraft(value: TimeRange | null): void;
  setPanning(value: boolean): void;
}

function fractionAt(event: PointerEvent<HTMLDivElement>): number {
  const rect = event.currentTarget.getBoundingClientRect();
  return (event.clientX - rect.left) / Math.max(1, rect.width);
}

function startGesture(context: GestureContext, event: PointerEvent<HTMLDivElement>): void {
  if (!context.model || context.gesture.current || (event.button !== 0 && event.button !== 2)) return;
  event.preventDefault();
  event.currentTarget.focus({ preventScroll: true });
  const recordKey = event.target instanceof Element
    ? event.target.closest<HTMLElement>("[data-span-key]")?.dataset.spanKey : undefined;
  const time = timeAt(context.domain, fractionAt(event));
  context.gesture.current = {
    pointerId: event.pointerId, button: event.button, x: event.clientX, time, domain: context.domain,
    recordKey, moved: false, pannable: context.viewport !== null, target: event.currentTarget,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  if (event.button === 2) context.setPanning(true); else context.setDraft({ start: time, end: time });
}

function moveGesture(context: GestureContext, event: PointerEvent<HTMLDivElement>): void {
  const gesture = context.gesture.current;
  if (!gesture || !context.model || gesture.pointerId !== event.pointerId) return;
  gesture.moved ||= Math.abs(event.clientX - gesture.x) >= 3;
  if (gesture.button === 2) {
    if (gesture.pannable) {
      const width = Math.max(1, event.currentTarget.getBoundingClientRect().width);
      context.setViewport(panTimeline(context.model, gesture.domain, (event.clientX - gesture.x) / width));
    }
  } else context.setDraft(orderedRange(gesture.time, timeAt(gesture.domain, fractionAt(event))));
}

function endGesture(context: GestureContext, event: PointerEvent<HTMLDivElement>): void {
  const gesture = context.gesture.current;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  releaseGesture(context.gesture);
  context.setDraft(null);
  context.setPanning(false);
  const moved = gesture.moved || Math.abs(event.clientX - gesture.x) >= 3;
  if (gesture.button === 2) { if (!moved) context.actions.changeRange(null); return; }
  if (!moved && gesture.recordKey) {
    context.actions.changeRange(null);
    context.actions.selectRecord(gesture.recordKey);
  } else context.actions.changeRange(orderedRange(gesture.time, timeAt(gesture.domain, fractionAt(event))));
}

function keyboardGesture(context: GestureContext, event: KeyboardEvent<HTMLDivElement>): void {
  if (!context.model) return;
  if (event.key === "Escape") { event.preventDefault(); context.actions.changeRange(null); context.setDraft(null); releaseGesture(context.gesture); context.setPanning(false); }
  if (event.key === "Home") { event.preventDefault(); context.setViewport(null); }
  if (event.key === "+" || event.key === "=" || event.key === "-") {
    event.preventDefault();
    context.setViewport(zoomTimeline(context.model, context.domain, { fraction: 0.5, delta: event.key === "-" ? 300 : -300 }));
  }
  if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && context.viewport) {
    event.preventDefault(); context.setViewport(panTimeline(context.model, context.domain, event.key === "ArrowLeft" ? 0.1 : -0.1));
  }
}

function releaseGesture(gesture: { current: Gesture | null }): void {
  const current = gesture.current;
  gesture.current = null;
  if (current?.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
}

function useOverviewWheel(input: {
  model: TimelineModel | undefined; domain: TimeRange;
  trackRef: { current: HTMLDivElement | null }; setViewport(value: TimeRange | null): void;
}) {
  useEffect(() => {
    const track = input.trackRef.current;
    if (!track) return;
    const wheel = (event: WheelEvent) => {
      if (!input.model) return;
      event.preventDefault();
      const rect = track.getBoundingClientRect();
      input.setViewport(zoomTimeline(input.model, input.domain, {
        fraction: (event.clientX - rect.left) / Math.max(1, rect.width), delta: event.deltaY,
      }));
    };
    track.addEventListener("wheel", wheel, { passive: false });
    return () => track.removeEventListener("wheel", wheel);
  }, [input.model, input.domain.start, input.domain.end, input.trackRef, input.setViewport]);
}
