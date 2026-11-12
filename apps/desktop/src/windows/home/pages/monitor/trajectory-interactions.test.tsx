import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KeyboardEvent, PointerEvent } from "react";
import type { TrajectoryRow } from "@taki/shared";
import { useOverviewGestures } from "./use-overview-gestures.ts";
import { clampInspectorWidth, useInspectorResize } from "./use-inspector-resize.ts";
import { useTrajectoryFollow } from "./use-trajectory-follow.ts";
import { projectTrajectoryRecords } from "./trajectory-records.ts";
import type { LedgerItem } from "./trajectory-layout.ts";

function capture<T>(useHook: () => T): T {
  const holder: { value?: T } = {};
  function Probe() { holder.value = useHook(); return null; }
  renderToStaticMarkup(<Probe />);
  return holder.value!;
}

class SpanTarget {
  key?: string;
  constructor(key?: string) { this.key = key; }
  closest() { return this.key ? { dataset: { spanKey: this.key } } : null; }
}

function track() {
  let held: number | undefined;
  return {
    getBoundingClientRect: () => ({ left: 10, width: 100 }),
    focus: vi.fn(), setPointerCapture: vi.fn((id: number) => { held = id; }),
    hasPointerCapture: (id: number) => id === held,
    releasePointerCapture: vi.fn(() => { held = undefined; }),
    parentElement: { getBoundingClientRect: () => ({ width: 360 }),
      parentElement: { parentElement: { getBoundingClientRect: () => ({ width: 900 }) } } },
  };
}

function pointer(target: ReturnType<typeof track>, input: { button?: number; x?: number; id?: number; key?: string } = {}) {
  return { currentTarget: target, target: new SpanTarget(input.key), button: input.button ?? 0,
    clientX: input.x ?? 10, pointerId: input.id ?? 7, preventDefault: vi.fn(),
  } as unknown as PointerEvent<HTMLDivElement>;
}

afterEach(() => vi.unstubAllGlobals());

describe("Overview pointer lifecycle", () => {
  function setup(active = true) {
    vi.stubGlobal("Element", SpanTarget);
    const actions = { changeRange: vi.fn(), selectRecord: vi.fn() };
    const handlers = capture(() => useOverviewGestures({ start: 0, end: 1000, spans: [] }, actions, active));
    return { handlers, actions, target: track() };
  }

  it("selects a recorded interval and treats a click on a span as exact record selection", () => {
    const { handlers, actions, target } = setup();
    handlers.onPointerDown(pointer(target));
    handlers.onPointerMove(pointer(target, { x: 60 }));
    handlers.onPointerUp(pointer(target, { x: 60 }));
    expect(actions.changeRange).toHaveBeenLastCalledWith({ start: 0, end: 500 });
    expect(target.releasePointerCapture).toHaveBeenCalledWith(7);
    handlers.onPointerDown(pointer(target, { key: "exact-record" }));
    handlers.onPointerUp(pointer(target, { key: "exact-record" }));
    expect(actions.changeRange).toHaveBeenLastCalledWith(null);
    expect(actions.selectRecord).toHaveBeenCalledWith("exact-record");
  });

  it.each(["onPointerCancel", "onLostPointerCapture"] as const)("%s discards the draft and ignores its later release", (cancel) => {
    const { handlers, actions, target } = setup();
    handlers.onPointerDown(pointer(target));
    handlers.onPointerMove(pointer(target, { x: 80 }));
    handlers[cancel](pointer(target));
    handlers.onPointerUp(pointer(target, { x: 80 }));
    expect(actions.changeRange).not.toHaveBeenCalled();
    expect(actions.selectRecord).not.toHaveBeenCalled();
    expect(target.releasePointerCapture).toHaveBeenCalledTimes(1);
  });

  it("ignores another pointer without replacing or cancelling the current selection", () => {
    const { handlers, actions, target } = setup();
    handlers.onPointerDown(pointer(target));
    handlers.onPointerDown(pointer(target, { id: 8, x: 90 }));
    handlers.onPointerCancel(pointer(target, { id: 8 }));
    handlers.onPointerUp(pointer(target, { id: 8, x: 90 }));
    handlers.onPointerUp(pointer(target, { x: 40 }));
    expect(actions.changeRange).toHaveBeenCalledExactlyOnceWith({ start: 0, end: 300 });
  });

  it("right click clears the range while a right drag does not change record or range selection", () => {
    const { handlers, actions, target } = setup();
    handlers.onPointerDown(pointer(target, { button: 2 }));
    handlers.onPointerUp(pointer(target, { button: 2 }));
    expect(actions.changeRange).toHaveBeenCalledExactlyOnceWith(null);
    actions.changeRange.mockClear();
    handlers.onPointerDown(pointer(target, { button: 2 }));
    handlers.onPointerMove(pointer(target, { button: 2, x: 70 }));
    handlers.onPointerUp(pointer(target, { button: 2, x: 70 }));
    expect(actions.changeRange).not.toHaveBeenCalled();
    expect(actions.selectRecord).not.toHaveBeenCalled();
  });

  it("Escape clears and releases an active gesture and a hidden view cannot start one", () => {
    const { handlers, actions, target } = setup();
    handlers.onPointerDown(pointer(target));
    handlers.onKeyDown({ key: "Escape", preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLDivElement>);
    handlers.onPointerUp(pointer(target, { x: 50 }));
    expect(actions.changeRange).toHaveBeenCalledExactlyOnceWith(null);
    expect(target.releasePointerCapture).toHaveBeenCalledWith(7);
    const hidden = setup(false);
    hidden.handlers.onPointerDown(pointer(hidden.target));
    hidden.handlers.onPointerUp(pointer(hidden.target));
    expect(hidden.target.setPointerCapture).not.toHaveBeenCalled();
    expect(hidden.actions.changeRange).not.toHaveBeenCalled();
  });
});

describe("temporary Inspector resizing", () => {
  it("tracks the pointer directly, clamps usable widths, and cleans up cancellation", () => {
    const actions = { width: 360, change: vi.fn(), resizing: vi.fn() };
    const handlers = capture(() => useInspectorResize(actions));
    const target = track();
    handlers.onPointerDown(pointer(target, { x: 200 }));
    handlers.onPointerMove(pointer(target, { x: 100 }));
    expect(actions.change).toHaveBeenLastCalledWith(460);
    handlers.onPointerMove(pointer(target, { x: -1000 }));
    expect(actions.change).toHaveBeenLastCalledWith(620);
    handlers.onPointerCancel(pointer(target));
    actions.change.mockClear();
    handlers.onPointerMove(pointer(target, { x: 50 }));
    expect(actions.change).not.toHaveBeenCalled();
    expect(actions.resizing).toHaveBeenLastCalledWith(false);
    expect(target.releasePointerCapture).toHaveBeenCalledTimes(1);
    expect(clampInspectorWidth(1, 900)).toBe(320);
  });

  it("keeps a foreign pointer from ending a resize and supports keyboard resizing", () => {
    const actions = { width: 360, change: vi.fn(), resizing: vi.fn() };
    const handlers = capture(() => useInspectorResize(actions));
    const target = track();
    handlers.onPointerDown(pointer(target, { x: 200 }));
    handlers.onLostPointerCapture(pointer(target, { id: 8 }));
    handlers.onPointerMove(pointer(target, { x: 180 }));
    expect(actions.change).toHaveBeenLastCalledWith(380);
    handlers.onPointerUp(pointer(target));
    handlers.onKeyDown({ key: "ArrowLeft", currentTarget: target, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLDivElement>);
    expect(actions.change).toHaveBeenLastCalledWith(376);
  });
});

describe("installed measured virtualizer integration", () => {
  const ledger = (count: number): LedgerItem[] => {
    const rows: TrajectoryRow[] = Array.from({ length: count }, (_, index) => ({
      kind: "lifecycle", rowKey: `stable-${index}`, seq: index + 1, label: "运行记录", status: "已完成", phase: "run",
      category: "lifecycle", categoryLabel: "生命周期", surface: "current", surfaceLabel: "当前", occurredAt: "2026-09-06T00:00:00.000Z",
    }));
    return projectTrajectoryRecords(rows).map((record) => ({ type: "record", key: record.key, record, requestChildren: 0, collapsed: false, height: 30 }));
  };

  it("enables measured mounting above 100 rows with stable keys and 12-row overscan", () => {
    const history = { hasOlder: false, loading: false, load: async () => undefined };
    const small = capture(() => useTrajectoryFollow({ items: ledger(100), history, suspended: false, active: true }));
    expect(small.enabled).toBe(false);
    const items = ledger(101);
    const large = capture(() => useTrajectoryFollow({ items, history, suspended: false, active: true }));
    expect(large.enabled).toBe(true);
    expect(large.virtualizer.options.overscan).toBe(12);
    expect(large.virtualizer.options.getItemKey(25)).toBe(items[25]!.key);
    expect(large.virtualizer.options.anchorTo).toBe("end");
    expect(large.virtualizer.options.followOnAppend).toBe(false);
  });

  it("keeps the existing reading offset when mounted rows cross the virtualization threshold", () => {
    const history = { hasOlder: false, loading: false, load: async () => undefined };
    const hook = capture(() => useTrajectoryFollow({ items: ledger(100), history, suspended: true, active: true }));
    const pane = { scrollTop: 600, ownerDocument: { defaultView: null } };
    hook.scrollRef.current = pane as unknown as HTMLDivElement;
    const virtualizer = hook.virtualizer;
    // Exercise the installed virtualizer's actual disable/enable lifecycle with deterministic DOM measurements.
    // React's SSR hook capture alone cannot establish scrolling or component-mount behavior.
    virtualizer.setOptions({ ...virtualizer.options, onChange: () => undefined,
      observeElementRect: (_instance, publish) => { publish({ width: 800, height: 90 }); return () => undefined; },
      observeElementOffset: () => () => undefined,
      scrollToFn: (offset) => { pane.scrollTop = offset; },
    });
    virtualizer._willUpdate();
    virtualizer.setOptions({ ...virtualizer.options, enabled: true, count: 101 });
    virtualizer.getVirtualItems();
    virtualizer._willUpdate();
    expect(pane.scrollTop).toBe(600);
    virtualizer.setOptions({ ...virtualizer.options, enabled: false, count: 100 });
    virtualizer._willUpdate();
    pane.scrollTop = 750;
    virtualizer.setOptions({ ...virtualizer.options, enabled: true, count: 101 });
    virtualizer.getVirtualItems();
    virtualizer._willUpdate();
    expect(pane.scrollTop).toBe(750);
    virtualizer._didMount()();
  });
});
