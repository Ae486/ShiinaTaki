import { describe, expect, it, vi } from "vitest";
import type { TrajectoryRow } from "@taki/shared";
import { projectTrajectoryRecords } from "./trajectory-records.ts";
import type { LedgerItem } from "./trajectory-layout.ts";
import {
  focusRecord, holdAnchor, onLedgerScroll, pauseFollowing, positionLedgerRows, requestOlderPage, resumeFollowing,
  type LedgerPositionContext,
} from "./trajectory-scroll.ts";

function items(count: number, prefix = "record"): LedgerItem[] {
  const rows: TrajectoryRow[] = Array.from({ length: count }, (_, index) => ({
    kind: "lifecycle", seq: index + 1, rowKey: `${prefix}-${index}`, label: "记录", status: "已完成",
    occurredAt: "2026-09-06T01:00:00.000Z", phase: "run", category: "lifecycle", categoryLabel: "生命周期",
    surface: "current", surfaceLabel: "当前",
  }));
  return projectTrajectoryRecords(rows).map((record) => ({ type: "record", record, key: record.key, height: 30, requestChildren: 0, collapsed: false }));
}

function geometry(virtual = false) {
  let top = 0;
  const writes: number[] = [];
  const focused: string[] = [];
  const context = {
    input: { items: items(20), history: { hasOlder: false, loading: false, load: vi.fn(async () => undefined) }, suspended: false, active: true },
    enabled: virtual, state: { initialized: false, following: true, requesting: false, count: 0 },
    setFollowing: vi.fn(), setReady: vi.fn(),
  } as unknown as LedgerPositionContext;
  const prefix = () => context.input.history.hasOlder ? 30 : 0;
  const pane = {
    clientHeight: 90,
    get scrollHeight() { return prefix() + context.input.items.length * 30; },
    get scrollTop() { return top; },
    set scrollTop(value: number) { top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); writes.push(top); },
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => context.input.items.map((item, index) => ({
      dataset: { ledgerKey: item.key }, clientHeight: 30,
      getBoundingClientRect: () => ({ top: 100 + prefix() + index * 30 - top, bottom: 130 + prefix() + index * 30 - top }),
      focus: () => focused.push(item.key),
    })),
  };
  context.pane = { current: pane as unknown as HTMLDivElement };
  context.virtualizer = {
    scrollToEnd: vi.fn(() => { pane.scrollTop = pane.scrollHeight; }),
    getOffsetForIndex: (index) => [prefix() + index * 30, "start"],
    scrollToOffset: vi.fn((offset) => { pane.scrollTop = offset; }),
    scrollToIndex: vi.fn((index) => { pane.scrollTop = prefix() + index * 30 - 30; }),
  };
  return { context, pane, writes, focused };
}

describe("trajectory reading continuity", () => {
  it("positions the initial tail, follows actual appends, and performs no content-only scroll writes", () => {
    const { context, pane, writes } = geometry();
    positionLedgerRows(context);
    expect(context.setReady).toHaveBeenCalledWith(true);
    expect(pane.scrollTop).toBe(510);
    writes.length = 0;
    context.input.items = context.input.items.map((item) => ({ ...item }));
    positionLedgerRows(context);
    expect(writes).toEqual([]);
    context.input.items = [...context.input.items, ...items(1, "new")];
    positionLedgerRows(context);
    expect(writes).toEqual([540]);
  });

  it("pauses on historical reading, range/Inspector inspection, and explicit text selection", () => {
    const { context, pane, writes } = geometry();
    positionLedgerRows(context);
    pane.scrollTop = 180;
    onLedgerScroll(context);
    expect(context.state.following).toBe(false);
    writes.length = 0;
    context.input.items = [...context.input.items, ...items(1, "new")];
    positionLedgerRows(context);
    expect(writes).toEqual([]);
    expect(pane.scrollTop).toBe(180);
    resumeFollowing(context);
    expect(pane.scrollTop).toBe(540);
    context.input.suspended = true;
    writes.length = 0;
    context.input.items = [...context.input.items, ...items(1, "next")];
    positionLedgerRows(context);
    expect(writes).toEqual([]);
    pauseFollowing(context);
    expect(context.state.following).toBe(false);
  });

  it.each([false, true])("preserves a prepended reading anchor (virtual=%s), including disappearance of the history control", (virtual) => {
    const { context, pane } = geometry(virtual);
    context.input.history.hasOlder = true;
    positionLedgerRows(context);
    pane.scrollTop = 90;
    holdAnchor(context);
    const key = context.state.anchor!.key;
    expect(context.state.anchor!.offset).toBe(0);
    context.input.items = [...items(2, "older"), ...context.input.items];
    context.input.history.hasOlder = false;
    positionLedgerRows(context);
    expect(pane.scrollTop).toBe(120);
    expect(pane.querySelectorAll().find((row) => row.dataset.ledgerKey === key)!.getBoundingClientRect().top).toBe(100);
    expect(context.state.following).toBe(false);
  });

  it("holds one history request and its anchor across concurrent tail append and prepend", async () => {
    const { context, pane } = geometry(true);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    context.input.history = { hasOlder: true, loading: false, load: vi.fn(() => pending) };
    positionLedgerRows(context);
    pane.scrollTop = 30;
    onLedgerScroll(context); onLedgerScroll(context); requestOlderPage(context);
    expect(context.input.history.load).toHaveBeenCalledTimes(1);
    const anchor = context.state.anchor!.key;
    context.input.items = [...context.input.items, ...items(1, "live")];
    positionLedgerRows(context);
    expect(context.state.anchor?.key).toBe(anchor);
    context.input.items = [...items(4, "older"), ...context.input.items];
    positionLedgerRows(context);
    expect(pane.querySelectorAll().find((row) => row.dataset.ledgerKey === anchor)!.getBoundingClientRect().top).toBe(100);
    finish();
    await pending;
    await Promise.resolve();
    positionLedgerRows(context);
    expect(context.state.requesting).toBe(false);
    expect(context.state.anchor).toBeUndefined();
  });

  it("focuses the exact stable record and makes hidden pages inert to navigation and history reads", () => {
    const { context, pane, focused, writes } = geometry(true);
    positionLedgerRows(context);
    const key = context.input.items[5]!.key;
    focusRecord(context, key);
    expect(context.virtualizer.scrollToIndex).toHaveBeenCalledWith(5, { align: "center", behavior: "auto" });
    positionLedgerRows(context);
    expect(focused).toContain(key);
    context.input.active = false;
    context.input.history.hasOlder = true;
    writes.length = 0;
    const previousTop = pane.scrollTop;
    resumeFollowing(context); holdAnchor(context); onLedgerScroll(context); requestOlderPage(context); focusRecord(context, key);
    context.input.items = [...context.input.items, ...items(1, "hidden-live")];
    positionLedgerRows(context);
    expect(context.input.history.load).not.toHaveBeenCalled();
    expect(pane.scrollTop).toBe(previousTop);
    expect(writes).toEqual([]);
  });
});
